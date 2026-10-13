"""Single-command execution report for the 26-question golden QA suite.

Usage (from ``backend/``, with LLM_* and LINGSIGHT_RO_PASSWORD configured):

    uv run python scripts/run_eval.py
    uv run python scripts/run_eval.py --ids 15,17,19   # one class of traps
    uv run python scripts/run_eval.py --output-dir ../docs/evidence/m1-t6

Runs every docs/09 question through the real pipeline (real model, real
``water_maze`` via ``lingsight_ro``), executes each golden SQL live, grades
with ``app.text_to_sql.eval.grading`` and writes a dated JSON report plus a
console table (logging only — this is a report tool, not a print script).
Exit code 0 iff every question passed.

The archived report under ``docs/evidence/m1-t6/`` is the CI pass-rate
baseline referenced by the M1 wrap-up; the pytest structure layer keeps the
question set itself honest in CI without any database or model.
"""

import argparse
import json
import logging
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.text_to_sql.eval.grading import (  # noqa: E402
    INFRA_REASON_CODES,
    Verdict,
    grade_question,
    summarize,
)
from app.text_to_sql.eval.questions import QUESTIONS, question_by_id  # noqa: E402
from app.text_to_sql.executor import (  # noqa: E402
    QueryExecutionError,
    ResearchQueryExecutor,
)
from app.text_to_sql.gateway import OpenAICompatProvider, ProviderError  # noqa: E402
from app.text_to_sql.pipeline import (  # noqa: E402
    ResearchQueryAnswer,
    ResearchQueryPipeline,
    ResearchQueryRejection,
)
from app.text_to_sql.settings import get_research_settings  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("run_eval")

DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parents[2] / "docs/evidence/m1-t6"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--ids",
        default="",
        help=f"comma-separated question ids to run (default: all {len(QUESTIONS)})",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"directory for the dated JSON report (default: {DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--llm-timeout",
        type=float,
        default=120.0,
        help="per-call LLM timeout in seconds (default: 120; the eval asks "
        "longer questions than interactive use)",
    )
    return parser.parse_args(argv)


def selected_questions(ids_arg: str) -> list[Any]:
    if not ids_arg.strip():
        return list(QUESTIONS)
    wanted = [int(part) for part in ids_arg.split(",") if part.strip()]
    return [question_by_id(qid) for qid in wanted]


def run_one(
    pipeline: ResearchQueryPipeline,
    executor: ResearchQueryExecutor,
    question: Any,
) -> tuple[Verdict, dict[str, Any], float]:
    """Run one question end-to-end and grade it; returns verdict + payload."""
    started = time.monotonic()
    outcome = pipeline.run(question.question)
    golden = None
    if question.golden_sql:
        golden = executor.run(question.golden_sql)
    verdict = grade_question(question, outcome, golden)
    elapsed = round(time.monotonic() - started, 2)
    payload: dict[str, Any] = {"question": question.question, "elapsed_s": elapsed}
    if isinstance(outcome, ResearchQueryRejection):
        payload["reason_code"] = outcome.reason_code
    elif isinstance(outcome, ResearchQueryAnswer):
        payload["columns"] = list(outcome.columns)
        payload["caliber_note"] = outcome.caliber_note
    return verdict, payload, elapsed


def build_report(
    settings: Any, verdict_rows: list[dict[str, Any]], summary: dict[str, Any]
) -> dict[str, Any]:
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "model": settings.LLM_MODEL,
        "database": {
            "host": settings.RESEARCH_DB_HOST,
            "name": settings.RESEARCH_DB_NAME,
            "user": settings.RESEARCH_DB_USER,
        },
        "pipeline": {
            "repair_attempts": settings.RESEARCH_QUERY_REPAIR_ATTEMPTS,
            "row_cap": settings.RESEARCH_QUERY_MAX_ROWS,
            "timeout_ms": settings.RESEARCH_QUERY_TIMEOUT_MS,
            "llm_timeout_s": settings.LLM_TIMEOUT_SECONDS,
        },
        "summary": summary,
        "questions": verdict_rows,
    }


def log_table(summary: dict[str, Any], verdict_rows: list[dict[str, Any]]) -> None:
    logger.info("=" * 72)
    logger.info(
        "eval suite: %d/%d passed (%.1f%%)",
        summary["passed"],
        summary["total"],
        summary["pass_rate"] * 100,
    )
    for category, bucket in summary["by_category"].items():
        logger.info(
            "  class %s: %d/%d passed",
            category,
            bucket["passed"],
            bucket["total"],
        )
    logger.info("=" * 72)
    for row in verdict_rows:
        verdict: Verdict = row["verdict"]
        flag = "PASS" if verdict.passed else "FAIL"
        logger.info(
            "%s Q%-2d [%s] %-6s %-12s %ss %s",
            flag,
            verdict.qid,
            verdict.category,
            verdict.outcome,
            f"a={verdict.attempts}",
            row["elapsed_s"],
            verdict.detail[:90],
        )
        if verdict.golden_drift:
            drifted = [c for c in verdict.golden_drift if not c.ok]
            if drifted:
                logger.warning(
                    "     Q%d golden drift vs docs/09 anchors: %s",
                    verdict.qid,
                    [
                        f"{c.cell.column}@{c.cell.where}={c.actual} "
                        f"(docs {c.cell.value})"
                        for c in drifted
                    ],
                )


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    settings = get_research_settings()
    if not (settings.LLM_BASE_URL and settings.LLM_API_KEY):
        logger.error(
            "LLM_BASE_URL/LLM_API_KEY are not configured; the execution layer "
            "needs a reachable model endpoint"
        )
        return 2
    if args.llm_timeout != settings.LLM_TIMEOUT_SECONDS:
        settings = settings.model_copy(update={"LLM_TIMEOUT_SECONDS": args.llm_timeout})
    questions = selected_questions(args.ids)
    try:
        provider = OpenAICompatProvider.from_settings(settings)
        provider.probe()
        executor = ResearchQueryExecutor(settings)
        executor.run("SELECT 1")
    except (ProviderError, QueryExecutionError) as error:
        logger.error("environment not ready: %s", error)
        return 2
    pipeline = ResearchQueryPipeline(
        settings=settings, provider=provider, executor=executor
    )

    verdict_rows: list[dict[str, Any]] = []
    for question in questions:
        try:
            verdict, payload, elapsed = run_one(pipeline, executor, question)
            if verdict.reason_code in INFRA_REASON_CODES:
                # One infrastructure retry: a provider timeout says nothing
                # about the model's answer, and the baseline should not be
                # skewed by transport hiccups.
                logger.warning(
                    "Q%d hit %s — one infrastructure retry",
                    question.id,
                    verdict.reason_code,
                )
                verdict, payload, elapsed = run_one(pipeline, executor, question)
        except QueryExecutionError as error:
            logger.error("Q%d golden execution failed: %s", question.id, error)
            return 2
        verdict_rows.append(
            {"verdict": verdict, "payload": payload, "elapsed_s": elapsed}
        )
        logger.info(
            "Q%-2d [%s] %s — %s (%ss, %d attempt(s))",
            question.id,
            question.category,
            "PASS" if verdict.passed else "FAIL",
            verdict.detail[:80],
            elapsed,
            verdict.attempts,
        )

    summary = summarize([row["verdict"] for row in verdict_rows])
    report = build_report(
        settings,
        [{**row["verdict"].to_dict(), **row["payload"]} for row in verdict_rows],
        summary,
    )
    args.output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    report_path = args.output_dir / f"eval-report-{stamp}.json"
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    log_table(summary, verdict_rows)
    logger.info("report written to %s", report_path)
    return 0 if summary["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
