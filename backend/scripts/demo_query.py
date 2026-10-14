"""Live demo: ask the real water_maze database one natural-language question.

Usage (from ``backend/``, after configuring LLM_* in the environment or .env):

    uv run python scripts/demo_query.py "一共有多少只动物"

The endpoint itself is already verified end-to-end in the pytest suite with a
FakeProvider and the real ``lingsight_ro`` account; this script additionally
drives a real LLM through the same pipeline once API keys are configured.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.text_to_sql.executor import ResearchQueryExecutor  # noqa: E402
from app.text_to_sql.gateway import build_provider  # noqa: E402
from app.text_to_sql.pipeline import ResearchQueryPipeline  # noqa: E402
from app.text_to_sql.settings import get_research_settings  # noqa: E402

DEMO_QUESTION = "一共有多少只动物"


def main() -> int:
    question = sys.argv[1] if len(sys.argv) > 1 else DEMO_QUESTION
    settings = get_research_settings()
    if not settings.LLM_BASE_URL:
        print("LLM_BASE_URL is not set; configure LLM_* env vars first.")
        return 2
    pipeline = ResearchQueryPipeline(
        settings=settings,
        provider=build_provider(settings),
        executor=ResearchQueryExecutor(settings),
    )
    outcome = pipeline.run(question)
    print(json.dumps(outcome.model_dump(), ensure_ascii=False, indent=2))
    return 0 if outcome.status == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
