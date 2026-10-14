"""The explicit query pipeline: generate → validate → typed repair → execute.

Pure Python orchestration, no agent framework (ADR-0001): each stage is a
plain function call, failures are typed values, and the answer carries a
deterministic caliber note (口径声明) rendered from the semantic layer —
never invented by the model.

Repair policy (issue #8): one shared, bounded retry budget (default 2) spent
only on generation/validation failures; the strategy per error family:

* syntax/parse (``parse_error``, fenced or malformed output) — feed the
  error back as context and retry, counted against the budget;
* whitelist/permission (``whitelist_violation`` / ``db_not_allowed`` /
  ``non_select``) — the model may rewrite against the *same* frozen
  whitelist and validator settings; the constraints are never relaxed, and
  exhaustion ends in a typed rejection (ADR-0001 / docs/09 D-class);
* execution (``execution_error`` / ``timeout``) — never retried; the
  timeout message names the server-side time budget explicitly;
* empty result — not an error: the empty set is returned verbatim with a
  deterministic suggestion; the SQL is never rewritten to "loosen"
  conditions.

Every attempt and its typed failure is recorded in an audit ``trace`` that
travels with both the answer and the rejection; each failure and the final
verdict are also written to the server-side audit log (AGENTS.md §3 — the
in-response trace alone is not a log).
"""

import logging
import re
from datetime import UTC, datetime
from functools import lru_cache
from typing import Literal

from pydantic import BaseModel, Field

from app.text_to_sql.executor import (
    ExecutionResult,
    QueryExecutionError,
    ResearchQueryExecutor,
)
from app.text_to_sql.gateway import Message, Provider, ProviderError
from app.text_to_sql.semantic import AstWhitelist, SemanticLayer, load
from app.text_to_sql.settings import ResearchQuerySettings
from app.text_to_sql.validator import (
    PERMISSION_REASON_CODES,
    ReasonCode,
    ValidatedSql,
    ValidationFailure,
    validate_sql,
)

JsonScalar = str | int | float | bool | None

logger = logging.getLogger(__name__)

AttemptStage = Literal["generation", "validation", "execution"]


class AttemptTrace(BaseModel):
    """One failed attempt, for evaluation and audit (issue #8)."""

    attempt: int = Field(ge=1, description="1-based generation attempt index")
    stage: AttemptStage
    reason_code: ReasonCode
    message: str


class DataSource(BaseModel):
    database: str
    tables: list[str]
    queried_at: str
    row_limit: int
    truncated: bool


class ResearchQueryAnswer(BaseModel):
    status: Literal["ok"] = "ok"
    question: str
    sql: str
    columns: list[str]
    rows: list[list[JsonScalar]]
    row_count: int
    caliber_note: str = Field(description="口径声明：聚合口径与陷阱纠正（语义层渲染）")
    data_source: DataSource
    attempts: int = Field(ge=1, description="生成调用次数（含修复重试）")
    trace: list[AttemptTrace] = Field(
        default_factory=list, description="成功前各次尝试的类型化失败轨迹"
    )
    empty: bool = Field(
        default=False, description="True 当结果集为空；空结果不是错误，SQL 原样返回"
    )
    suggestion: str | None = Field(
        default=None, description="仅空结果时给出的确定性改写建议（不自动改写）"
    )


class ResearchQueryRejection(BaseModel):
    status: Literal["rejected"] = "rejected"
    reason_code: ReasonCode
    message: str
    sql: str | None = None
    attempts: int = Field(ge=1, description="生成调用次数（含修复重试）")
    trace: list[AttemptTrace] = Field(
        default_factory=list, description="各次尝试的类型化失败轨迹（含终局失败）"
    )


SYSTEM_PROMPT_TEMPLATE = """你是一个 MySQL 分析型 SQL 生成器，只访问水迷宫科研数据库（water_maze）。

{semantic_context}

## 输出规则（必须遵守）
1. 只输出一条只读 SELECT 语句（MySQL 方言），不要任何解释文字或 Markdown 代码块。
2. 只能使用上面白名单中的表和列；禁止任何库名前缀（如 water_maze. 或其他库.）。
3. 严格遵守「陷阱纠正口径」：例如动物数必须用 COUNT(DISTINCT CONCAT(group_name, '|', mouse_id))，绝不用 animal_code。
4. 需要限制行数时使用 LIMIT；服务端会强制行数上限。
5. 聚合统计必须声明阶段（phase）口径，并优先采用「逐鼠-逐日」推荐口径。
6. SELECT 输出列名必须与语义层白名单/标准表达式里的名称逐字一致（如 dist_px、speed_px、session_no、group_name），禁止自造同义别名（如 mean_speed_px、avg_dist_px）；除非用户明确要求，不要附加问题未问的额外列。
"""

_FENCE_RE = re.compile(r"^```[a-zA-Z]*\s*|\s*```$")

#: Repair feedback must state constraints stay frozen for these reasons
#: (ADR-0001 hard boundary: no relaxation on permission errors).
_PERMISSION_REASON_CODES = PERMISSION_REASON_CODES


@lru_cache(maxsize=1)
def _cached_semantic_layer() -> SemanticLayer:
    return load()


def extract_sql(raw: str) -> str:
    """Strip Markdown fences the model may wrap around the statement."""
    text = raw.strip()
    if text.startswith("```"):
        text = _FENCE_RE.sub("", text).strip()
    return text


def _repair_instruction(failure: ValidationFailure) -> str:
    """Typed feedback for the next generation attempt (issue #8)."""
    head = f"上面的 SQL 被安全校验拒绝：{failure.reason_code} — {failure.message}。"
    if failure.reason_code in _PERMISSION_REASON_CODES:
        return (
            head + "安全约束与表/列白名单不会放宽；请只依据系统消息中的白名单表/列"
            "与陷阱纠正口径改写（如改用允许的表/列、去掉库名前缀、改为只读 "
            "SELECT），重新输出一条修正后的单条 SELECT（不要解释、不要代码块）。"
        )
    return (
        head + "请修正语法或列歧义等问题，只输出一条合法的 MySQL 单条 SELECT"
        "（只用白名单表/列；不要解释、不要代码块）。"
    )


def _empty_result_suggestion() -> str:
    """Deterministic rewrite hint for empty results (never a rewrite).

    An empty set is not an error (issue #8): the SQL ran verbatim, and the
    pipeline never loosens conditions on its own — it only suggests what the
    user could re-ask.
    """
    return (
        "查询已按原 SQL 执行，结果为空；系统不会自动修改或放宽查询条件重查。"
        "改写建议：检查 WHERE 过滤条件是否过窄或取值不匹配"
        "（如 phase（training_day/probe 各变体）、group_name、date_dir、session_no），"
        "并确认所问数据的阶段口径后重新提问。"
    )


def _trace_failure(
    trace: list[AttemptTrace],
    *,
    attempt: int,
    stage: AttemptStage,
    reason_code: ReasonCode,
    message: str,
) -> None:
    """Record one typed failure in the trace and the server-side audit log."""
    trace.append(
        AttemptTrace(
            attempt=attempt, stage=stage, reason_code=reason_code, message=message
        )
    )
    logger.info(
        "research_query attempt=%d stage=%s reason_code=%s", attempt, stage, reason_code
    )


def _reject(
    trace: list[AttemptTrace],
    *,
    reason_code: ReasonCode,
    message: str,
    sql: str | None,
    attempts: int,
) -> ResearchQueryRejection:
    """Build the terminal typed rejection and log the verdict for audit."""
    logger.info(
        "research_query rejected reason_code=%s attempts=%d", reason_code, attempts
    )
    return ResearchQueryRejection(
        reason_code=reason_code,
        message=message,
        sql=sql,
        attempts=attempts,
        trace=trace,
    )


class ResearchQueryPipeline:
    """One question → one structured answer or one typed rejection."""

    def __init__(
        self,
        *,
        settings: ResearchQuerySettings,
        provider: Provider,
        semantic: SemanticLayer | None = None,
        executor: ResearchQueryExecutor | None = None,
    ) -> None:
        self._settings = settings
        self._provider = provider
        self._semantic = semantic if semantic is not None else _cached_semantic_layer()
        self._executor = executor or ResearchQueryExecutor(settings)

    def run(self, question: str) -> ResearchQueryAnswer | ResearchQueryRejection:
        messages: list[Message] = [
            {
                "role": "system",
                "content": SYSTEM_PROMPT_TEMPLATE.format(
                    semantic_context=self._semantic.render_prompt_context()
                ),
            },
            {"role": "user", "content": question},
        ]
        max_attempts = 1 + max(0, self._settings.RESEARCH_QUERY_REPAIR_ATTEMPTS)
        # Frozen for the whole run: every attempt (and every retry) validates
        # against the identical whitelist and row cap — never relaxed.
        whitelist: AstWhitelist = self._semantic.ast_whitelist()
        trace: list[AttemptTrace] = []
        last_sql: str | None = None

        for attempt in range(1, max_attempts + 1):
            try:
                raw = self._provider.chat(messages)
            except ProviderError as error:
                _trace_failure(
                    trace,
                    attempt=attempt,
                    stage="generation",
                    reason_code="provider_error",
                    message=str(error),
                )
                return _reject(
                    trace,
                    reason_code="provider_error",
                    message=str(error),
                    sql=last_sql,
                    attempts=attempt,
                )
            candidate = extract_sql(raw)
            last_sql = candidate
            try:
                validated = validate_sql(
                    candidate,
                    whitelist,
                    max_rows=self._settings.RESEARCH_QUERY_MAX_ROWS,
                )
            except ValidationFailure as failure:
                _trace_failure(
                    trace,
                    attempt=attempt,
                    stage="validation",
                    reason_code=failure.reason_code,
                    message=failure.message,
                )
                if attempt < max_attempts:
                    messages = messages + [
                        {"role": "assistant", "content": raw},
                        {
                            "role": "user",
                            "content": _repair_instruction(failure),
                        },
                    ]
                    continue
                return _reject(
                    trace,
                    reason_code=failure.reason_code,
                    message=failure.message,
                    sql=last_sql,
                    attempts=attempt,
                )

            # Execution failures are terminal: the budget is spent on
            # generation/validation only, never on re-running MySQL.
            try:
                result = self._executor.run(validated.sql)
            except QueryExecutionError as error:
                _trace_failure(
                    trace,
                    attempt=attempt,
                    stage="execution",
                    reason_code=error.reason_code,
                    message=error.message,
                )
                return _reject(
                    trace,
                    reason_code=error.reason_code,
                    message=error.message,
                    sql=validated.sql,
                    attempts=attempt,
                )
            return self._answer(
                question, validated, result, attempt=attempt, trace=trace
            )

        # Unreachable: the loop always returns inside its body.
        raise AssertionError("pipeline loop exhausted without a verdict")

    def _answer(
        self,
        question: str,
        validated: ValidatedSql,
        result: ExecutionResult,
        *,
        attempt: int,
        trace: list[AttemptTrace],
    ) -> ResearchQueryAnswer:
        empty = result.row_count == 0
        logger.info(
            "research_query answered rows=%d attempts=%d truncated=%s",
            result.row_count,
            attempt,
            result.truncated,
        )
        return ResearchQueryAnswer(
            status="ok",
            question=question,
            sql=validated.sql,
            columns=list(result.columns),
            rows=[list(row) for row in result.rows],
            row_count=result.row_count,
            caliber_note=self._caliber_note(validated.sql),
            data_source=DataSource(
                database=self._settings.RESEARCH_DB_NAME,
                tables=list(validated.tables),
                queried_at=datetime.now(UTC).isoformat(),
                row_limit=self._settings.RESEARCH_QUERY_MAX_ROWS,
                truncated=result.truncated,
            ),
            attempts=attempt,
            trace=trace,
            empty=empty,
            suggestion=_empty_result_suggestion() if empty else None,
        )

    def _caliber_note(self, sql: str) -> str:
        """Deterministic 口径声明 rendered from the semantic layer + SQL."""
        low = sql.lower()
        parts: list[str] = []
        corrections = self._semantic.corrections
        rules = self._semantic.aggregation_rules

        if "group_name" in low and "mouse_id" in low:
            correction = corrections.get("animal_code")
            if correction:
                parts.append(
                    f"动物口径：{correction.canonical}"
                    f"（标准表达 {correction.canonical_sql}；"
                    "animal_code 是组-鼠-试次编码，不能当动物数）"
                )
        if "session_label" in low or "session_no" in low:
            correction = corrections.get("session_label")
            if correction:
                parts.append(f"区块口径：{correction.canonical}")
        if "trial_no" in low:
            correction = corrections.get("trial_no")
            if correction:
                parts.append(f"试次口径：{correction.canonical}")

        aggregating = any(
            token in low
            for token in ("count(", "sum(", "avg(", "min(", "max(", "group by")
        )
        if aggregating:
            grain_rule = next((r for r in rules if "逐鼠-逐日" in r), None)
            if grain_rule:
                parts.append(f"聚合口径：{grain_rule}")
        if "phase" in low or "training_day" in low or "probe" in low:
            phase_rule = next((r for r in rules if "phase" in r), None)
            if phase_rule:
                parts.append(f"阶段口径：{phase_rule}")

        if not parts:
            parts.append(
                "本查询为白名单表直查，未触发聚合口径规则；结果行数受服务端上限约束。"
            )
        return "\n".join(parts)
