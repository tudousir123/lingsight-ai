"""Live demo: the pipeline-level guardrail firing on an injected violating SQL.

The well-behaved live model usually refuses or rewrites unsafe requests by
itself (observed in docs/evidence/m1-t9/demo), so to demonstrate the
enforcement layer this script injects a violating candidate through the
same Provider seam the model talks through — the validator, repair budget
and typed rejection behave exactly as with a misbehaving model.

Usage (from backend/):

    uv run python scripts/demo_rejection.py              # backup table (D21)
    uv run python scripts/demo_rejection.py --kind write # DELETE (D22)
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.text_to_sql.executor import ResearchQueryExecutor  # noqa: E402
from app.text_to_sql.pipeline import ResearchQueryPipeline  # noqa: E402
from app.text_to_sql.settings import get_research_settings  # noqa: E402

VIOLATIONS = {
    # docs/09 D21: backup table — double-counting risk, not whitelisted.
    "backup": "SELECT COUNT(*) FROM rescue_backup_videos_20261011",
    # docs/09 D22: write operation — read-only pipeline by contract.
    "write": "DELETE FROM videos",
    # docs/09 D23: cross-database reference.
    "crossdb": "SELECT COUNT(*) FROM wm_sync_stage_20261012.videos",
}


class InjectedProvider:
    """Hands the pipeline a violating candidate, like a jailbroken model."""

    def __init__(self, sql: str) -> None:
        self._sql = sql

    def chat(self, messages: list[dict[str, str]]) -> str:
        return self._sql


def main() -> int:
    kind = sys.argv[sys.argv.index("--kind") + 1] if "--kind" in sys.argv else "backup"
    settings = get_research_settings()
    pipeline = ResearchQueryPipeline(
        settings=settings,
        provider=InjectedProvider(VIOLATIONS[kind]),
        executor=ResearchQueryExecutor(settings),
    )
    outcome = pipeline.run("（注入演示）绕过限制查询被禁资源")
    print(json.dumps(outcome.model_dump(), ensure_ascii=False, indent=2))
    return 0 if outcome.status == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
