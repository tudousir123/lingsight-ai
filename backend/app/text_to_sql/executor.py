"""Read-only execution against `water_maze` as `lingsight_ro` (ticket #5).

Each query gets its own short-lived connection (connect + read timeouts), a
server-side ``MAX_EXECUTION_TIME`` for SELECT statements, and a hard row cap
fetched with one lookahead so truncation is observable. Execution errors are
typed and are never retried by the pipeline — repair is a validation-stage
concern (full repair loop is ticket #8).
"""

import math
from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any, Literal

# pymysql ships no type stubs; adding types-PyMySQL would exceed this
# ticket's dependency budget, so the two imports are locally untyped instead.
import pymysql  # type: ignore[import-untyped]
from pymysql.err import (  # type: ignore[import-untyped]
    DatabaseError,
    OperationalError,
    ProgrammingError,
)

from app.text_to_sql.settings import ResearchQuerySettings

#: MySQL error codes that mean "statement exceeded its time budget".
_TIMEOUT_ERRNOS = {3024, 1969, 3006, 1317}

ExecutionReasonCode = Literal["execution_error", "timeout"]


@dataclass(frozen=True)
class QueryExecutionError(Exception):
    """MySQL-side failure; reason_code distinguishes timeout from others."""

    reason_code: ExecutionReasonCode
    message: str

    def __str__(self) -> str:
        return f"[{self.reason_code}] {self.message}"


@dataclass(frozen=True)
class ExecutionResult:
    columns: tuple[str, ...]
    rows: tuple[tuple[Any, ...], ...]
    row_count: int
    truncated: bool


def _json_safe(value: Any) -> Any:
    if isinstance(value, datetime | date | time):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, bytes | bytearray):
        return f"<{len(value)} bytes>"
    return value


class ResearchQueryExecutor:
    """Executes one validated statement on the research database."""

    def __init__(self, settings: ResearchQuerySettings) -> None:
        self._settings = settings

    def run(self, sql: str) -> ExecutionResult:
        settings = self._settings
        try:
            connection = pymysql.connect(
                host=settings.RESEARCH_DB_HOST,
                port=settings.RESEARCH_DB_PORT,
                user=settings.RESEARCH_DB_USER,
                password=settings.LINGSIGHT_RO_PASSWORD,
                database=settings.RESEARCH_DB_NAME,
                connect_timeout=5,
                read_timeout=math.ceil(settings.read_timeout_seconds),
                charset="utf8mb4",
            )
        except pymysql.MySQLError as error:
            msg = f"could not connect to {settings.RESEARCH_DB_NAME} as {settings.RESEARCH_DB_USER}"
            raise QueryExecutionError("execution_error", msg) from error

        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SET SESSION MAX_EXECUTION_TIME = %s",
                    (settings.RESEARCH_QUERY_TIMEOUT_MS,),
                )
                cursor.execute(sql)
                description = cursor.description or ()
                columns = tuple(str(d[0]) for d in description)
                fetched = cursor.fetchmany(settings.RESEARCH_QUERY_MAX_ROWS + 1)
                truncated = len(fetched) > settings.RESEARCH_QUERY_MAX_ROWS
                rows = tuple(fetched[: settings.RESEARCH_QUERY_MAX_ROWS])
        except (OperationalError, ProgrammingError, DatabaseError) as error:
            raise _to_execution_error(error) from error
        finally:
            connection.close()

        return ExecutionResult(
            columns=columns,
            rows=tuple(tuple(_json_safe(v) for v in row) for row in rows),
            row_count=len(rows),
            truncated=truncated,
        )


def _to_execution_error(error: pymysql.MySQLError) -> QueryExecutionError:
    errno = error.args[0] if error.args and isinstance(error.args[0], int) else None
    text = str(error)
    if errno in _TIMEOUT_ERRNOS or "maximum statement execution time" in text:
        return QueryExecutionError(
            "timeout", "statement exceeded MAX_EXECUTION_TIME and was aborted"
        )
    lowered = text.lower()
    if "timed out" in lowered or "timeout" in lowered:
        return QueryExecutionError("timeout", text)
    if errno in (1142, 1143, 1227, 1698):
        # ER_TABLEACCESS_DENIED_ERROR / access-denied family: never relaxed.
        return QueryExecutionError("execution_error", f"database refused: {text}")
    return QueryExecutionError("execution_error", text)
