"""Bounded, read-only trial catalog over the research database.

This is separate from Text-to-SQL: every statement and exposed column is fixed
here, while the shared research account retains database-level read-only access.
"""

from pathlib import Path
from typing import Any

import pymysql  # type: ignore[import-untyped]
import pymysql.cursors  # type: ignore[import-untyped]

from app.core.research import ResearchDatabaseSettings
from app.trials.media import ResearchTrialMedia
from app.trials.settings import TrialsSettings, get_trials_settings


class CatalogUnavailable(Exception):
    """Research database could not serve a catalog request."""


def read_rows(
    settings: ResearchDatabaseSettings, sql: str, params: tuple[Any, ...]
) -> list[dict[str, Any]]:
    """One bounded read via the shared read-only account (lingsight_ro).

    Raises CatalogUnavailable on any connection/execution error so routes
    turn it into an explicit 503 instead of guessing.
    """
    try:
        connection = pymysql.connect(
            host=settings.RESEARCH_DB_HOST,
            port=settings.RESEARCH_DB_PORT,
            user=settings.RESEARCH_DB_USER,
            password=settings.LINGSIGHT_RO_PASSWORD,
            database=settings.RESEARCH_DB_NAME,
            connect_timeout=5,
            read_timeout=settings.read_timeout_seconds,
            charset="utf8mb4",
            cursorclass=pymysql.cursors.DictCursor,
        )
    except pymysql.MySQLError as error:
        raise CatalogUnavailable from error
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "SET SESSION MAX_EXECUTION_TIME = %s",
                (settings.RESEARCH_QUERY_TIMEOUT_MS,),
            )
            cursor.execute(sql, params)
            return list(cursor.fetchall())
    except pymysql.MySQLError as error:
        raise CatalogUnavailable from error
    finally:
        connection.close()


TRIAL_SELECT = (
    "SELECT v.video_id, v.dataset_id, v.source_video_path, v.group_name, "
    "v.mouse_id, v.phase, v.date_dir, v.session_no, v.session_label, "
    "v.trial_no, v.processed_frame_count, q.video_id AS result_video_id "
    "FROM videos v LEFT JOIN qc_summary q ON q.video_id = v.video_id "
)


class TrialCatalog:
    def __init__(
        self, settings: ResearchDatabaseSettings, trials: TrialsSettings | None = None
    ) -> None:
        self.settings = settings
        self.media = ResearchTrialMedia(
            trials if trials is not None else get_trials_settings()
        )

    def _read(self, sql: str, params: tuple[Any, ...]) -> list[dict[str, Any]]:
        return read_rows(self.settings, sql, params)

    def list_experiments(self, allowed_ids: set[str] | None) -> list[dict[str, Any]]:
        if allowed_ids is not None and not allowed_ids:
            return []
        restriction = ""
        params: tuple[Any, ...] = ()
        if allowed_ids is not None:
            restriction = (
                f"WHERE d.dataset_id IN ({','.join(['%s'] * len(allowed_ids))})"
            )
            params = tuple(sorted(allowed_ids))
        rows = self._read(
            "SELECT d.dataset_id, d.dataset_name, COUNT(v.video_id) AS trial_count "
            "FROM datasets d LEFT JOIN videos v ON v.dataset_id = d.dataset_id "
            f"{restriction} GROUP BY d.dataset_id, d.dataset_name ORDER BY d.dataset_id",
            params,
        )
        return [
            {
                "id": row["dataset_id"],
                "name": row["dataset_name"],
                "trial_count": row["trial_count"],
            }
            for row in rows
        ]

    def list_trials(
        self,
        experiment_id: str,
        *,
        group_name: str | None,
        mouse_id: str | None,
        phase: str | None,
        date_dir: str | None,
        skip: int,
        limit: int,
    ) -> tuple[list[dict[str, Any]], int]:
        where = ["v.dataset_id = %s"]
        params: list[Any] = [experiment_id]
        for column, value in (
            ("group_name", group_name),
            ("mouse_id", mouse_id),
            ("phase", phase),
            ("date_dir", date_dir),
        ):
            if value is not None:
                where.append(f"v.{column} = %s")
                params.append(value)
        restriction = " AND ".join(where)
        count = self._read(
            f"SELECT COUNT(*) AS count FROM videos v WHERE {restriction}", tuple(params)
        )[0]["count"]
        rows = self._read(
            TRIAL_SELECT + f"WHERE {restriction} "
            "ORDER BY v.date_dir, v.session_no, v.group_name, v.mouse_id, "
            "CAST(v.trial_no AS UNSIGNED), v.video_id LIMIT %s OFFSET %s",
            (*params, limit, skip),
        )
        return [self._trial(row) for row in rows], count

    def get_trial(self, experiment_id: str, trial_id: str) -> dict[str, Any] | None:
        rows = self._read(
            TRIAL_SELECT + "WHERE v.dataset_id = %s AND v.video_id = %s LIMIT 1",
            (experiment_id, trial_id),
        )
        return self._trial(rows[0]) if rows else None

    def _trial(self, row: dict[str, Any]) -> dict[str, Any]:
        source_path = row["source_video_path"]
        date_dir = str(row["date_dir"])
        training_day = None
        if row["phase"] == "training_day" and date_dir in {
            "0804",
            "0805",
            "0806",
            "0807",
            "0808",
        }:
            training_day = int(date_dir[-2:]) - 3
        return {
            "id": row["video_id"],
            "experiment_id": row["dataset_id"],
            "video_name": Path(source_path).name
            if source_path
            else str(row["video_id"]),
            "group_name": row["group_name"],
            "mouse_id": row["mouse_id"],
            "phase": row["phase"],
            "date_dir": date_dir,
            "training_day": training_day,
            "session_no": row["session_no"],
            "session_label": row["session_label"],
            "trial_no": row["trial_no"],
            "media_available": self.media.available(source_path, str(row["video_id"])),
            "result_available": bool(row["result_video_id"]),
        }
