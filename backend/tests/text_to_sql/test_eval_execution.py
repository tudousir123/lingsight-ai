"""Execution layer of the golden QA suite (ticket #9 / M1-T6) — env-gated.

Runs the **real** model and the **real** ``water_maze`` database through the
research query endpoint (the single test seam, ticket #5) and grades every
docs/09 question with the same logic ``scripts/run_eval.py`` uses. These
tests are skipped unless the environment provides both:

* ``LLM_BASE_URL`` / ``LLM_API_KEY`` / ``LLM_MODEL`` (a reachable
  OpenAI-compatible endpoint), and
* the research DB with ``LINGSIGHT_RO_PASSWORD``.

CI has neither, so it runs the structure layer only
(``tests/text_to_sql/test_eval_suite.py``); this file is the local /
operator run that produces and guards the pass-rate baseline.

Ordering discipline: the FakeProvider smoke test below proves the grading
path end-to-end (endpoint → executor → grader) with a scripted model before
any real LLM call happens.
"""

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api.routes.research import get_query_provider
from app.main import app
from app.text_to_sql.eval.grading import grade_question
from app.text_to_sql.eval.questions import QUESTIONS, question_by_id
from app.text_to_sql.executor import (
    QueryExecutionError,
    ResearchQueryExecutor,
)
from app.text_to_sql.gateway import OpenAICompatProvider, ProviderError
from app.text_to_sql.pipeline import (
    ResearchQueryAnswer,
    ResearchQueryRejection,
)
from app.text_to_sql.settings import (
    ResearchQuerySettings,
    get_research_settings,
)

pytestmark = [pytest.mark.env_gated]

_SKIP_LLM = (
    "execution layer needs a real LLM endpoint: set LLM_BASE_URL, LLM_API_KEY "
    "and LLM_MODEL in the environment (see backend/.env)"
)
_SKIP_LLM_DOWN = (
    "the configured LLM endpoint did not respond — start the local proxy "
    "to run the execution layer"
)
_SKIP_DB = (
    "execution layer needs the water_maze research DB with LINGSIGHT_RO_PASSWORD "
    "(reachable as lingsight_ro); CI runs the structure layer only"
)


class FakeProvider:
    """Scripted stand-in for the Model Gateway (same pattern as #5's tests)."""

    def __init__(self, responses: list[str]) -> None:
        self.responses = list(responses)

    def chat(self, messages: list[dict[str, str]]) -> str:
        if not self.responses:
            raise AssertionError("FakeProvider exhausted")
        return self.responses.pop(0)


@pytest.fixture(autouse=True)
def _clear_overrides() -> Iterator[None]:
    yield
    app.dependency_overrides.pop(get_query_provider, None)


@pytest.fixture(scope="module")
def settings() -> ResearchQuerySettings:
    return get_research_settings()


@pytest.fixture(scope="module")
def db_available(settings: ResearchQuerySettings) -> ResearchQueryExecutor:
    try:
        ResearchQueryExecutor(settings).run("SELECT 1")
    except QueryExecutionError:
        pytest.skip(_SKIP_DB)
    return ResearchQueryExecutor(settings)


@pytest.fixture(scope="module")
def _llm_available(settings: ResearchQuerySettings) -> None:
    if not (settings.LLM_BASE_URL and settings.LLM_API_KEY):
        pytest.skip(_SKIP_LLM)
    # Liveness, not configuration presence: a configured-but-down proxy
    # must skip these tests, not fail them as if the code were broken.
    try:
        OpenAICompatProvider.from_settings(settings).probe()
    except ProviderError as error:
        pytest.skip(f"{_SKIP_LLM_DOWN} ({error})")


def _golden(executor: ResearchQueryExecutor, qid: int) -> Any:
    question = question_by_id(qid)
    if not question.golden_sql:
        return None
    return executor.run(question.golden_sql)


def _ask(
    client: TestClient,
    headers: dict[str, str],
    question_text: str,
) -> ResearchQueryAnswer | ResearchQueryRejection:
    response = client.post(
        "/api/v1/research/query", json={"question": question_text}, headers=headers
    )
    body = response.json()
    if response.status_code == 200:
        return ResearchQueryAnswer.model_validate(body)
    return ResearchQueryRejection.model_validate(body)


# --- smoke: grading path with a scripted model (DB-gated only) ------------------


def test_fake_provider_golden_path_smoke(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_available: ResearchQueryExecutor,
) -> None:
    # The golden SQL, delivered verbatim by a scripted model through the
    # real endpoint, must grade as a pass — proving endpoint → executor →
    # grader wiring before the first real LLM call.
    question = question_by_id(1)
    app.dependency_overrides[get_query_provider] = lambda: FakeProvider(
        [question.golden_sql or ""]
    )
    outcome = _ask(client, normal_user_token_headers, question.question)
    verdict = grade_question(question, outcome, _golden(db_available, 1))
    assert verdict.passed, verdict.detail


# --- the real run: 26 questions through the real model --------------------------


@pytest.mark.parametrize("question", QUESTIONS, ids=lambda q: f"Q{q.id}-{q.category}")
def test_real_model_question(
    question: Any,
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    _llm_available: None,
    db_available: ResearchQueryExecutor,
) -> None:
    outcome = _ask(client, normal_user_token_headers, question.question)
    verdict = grade_question(question, outcome, _golden(db_available, question.id))
    assert verdict.passed, (
        f"Q{question.id} [{question.category}] {question.question}\n"
        f"verdict: {verdict.outcome} — {verdict.detail}\n"
        f"sql: {verdict.sql}\nattempts: {verdict.attempts}"
    )
