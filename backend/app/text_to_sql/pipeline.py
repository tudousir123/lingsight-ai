"""The explicit query pipeline: generate → validate → (repair once) → execute.

Pure Python orchestration, no agent framework (ADR-0001): each stage is a
plain function call, failures are typed values, and the answer carries a
deterministic caliber note (口径声明) rendered from the semantic layer —
never invented by the model.
"""

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
from app.text_to_sql.semantic import SemanticLayer, load
from app.text_to_sql.settings import ResearchQuerySettings
from app.text_to_sql.validator import (
    ReasonCode,
    ValidatedSql,
    ValidationFailure,
    validate_sql,
)

JsonScalar = str | int | float | bool | None


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


class ResearchQueryRejection(BaseModel):
    status: Literal["rejected"] = "rejected"
    reason_code: ReasonCode
    message: str
    sql: str | None = None


SYSTEM_PROMPT_TEMPLATE = """你是一个 MySQL 分析型 SQL 生成器，只访问水迷宫科研数据库（water_maze）。

{semantic_context}

## 输出规则（必须遵守）
1. 只输出一条只读 SELECT 语句（MySQL 方言），不要任何解释文字或 Markdown 代码块。
2. 只能使用上面白名单中的表和列；禁止任何库名前缀（如 water_maze. 或其他库.）。
3. 严格遵守「陷阱纠正口径」：例如动物数必须用 COUNT(DISTINCT CONCAT(group_name, '|', mouse_id))，绝不用 animal_code。
4. 需要限制行数时使用 LIMIT；服务端会强制行数上限。
5. 聚合统计必须声明阶段（phase）口径，并优先采用「逐鼠-逐日」推荐口径。
"""

_FENCE_RE = re.compile(r"^```[a-zA-Z]*\s*|\s*```$")


@lru_cache(maxsize=1)
def _cached_semantic_layer() -> SemanticLayer:
    return load()


def extract_sql(raw: str) -> str:
    """Strip Markdown fences the model may wrap around the statement."""
    text = raw.strip()
    if text.startswith("```"):
        text = _FENCE_RE.sub("", text).strip()
    return text


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
        attempts = 1 + max(0, self._settings.RESEARCH_QUERY_REPAIR_ATTEMPTS)
        last_sql: str | None = None

        for attempt in range(attempts):
            try:
                raw = self._provider.chat(messages)
            except ProviderError as error:
                return ResearchQueryRejection(
                    reason_code="provider_error", message=str(error), sql=last_sql
                )
            candidate = extract_sql(raw)
            last_sql = candidate
            try:
                validated = validate_sql(
                    candidate,
                    self._semantic.ast_whitelist(),
                    max_rows=self._settings.RESEARCH_QUERY_MAX_ROWS,
                )
            except ValidationFailure as failure:
                if attempt + 1 < attempts:
                    messages = messages + [
                        {"role": "assistant", "content": raw},
                        {
                            "role": "user",
                            "content": (
                                "上面的 SQL 被安全校验拒绝："
                                f"{failure.reason_code} — {failure.message}。"
                                "请只依据系统消息中的白名单表/列与陷阱纠正口径，"
                                "重新输出一条修正后的单条 SELECT（不要解释、不要代码块）。"
                            ),
                        },
                    ]
                    continue
                return ResearchQueryRejection(
                    reason_code=failure.reason_code,
                    message=failure.message,
                    sql=last_sql,
                )

            # Execution failures are terminal (repair is ticket #8).
            try:
                result = self._executor.run(validated.sql)
            except QueryExecutionError as error:
                return ResearchQueryRejection(
                    reason_code=error.reason_code,
                    message=error.message,
                    sql=validated.sql,
                )
            return self._answer(question, validated, result)

        # Unreachable: the loop always returns inside its body.
        raise AssertionError("pipeline loop exhausted without a verdict")

    def _answer(
        self, question: str, validated: ValidatedSql, result: ExecutionResult
    ) -> ResearchQueryAnswer:
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
