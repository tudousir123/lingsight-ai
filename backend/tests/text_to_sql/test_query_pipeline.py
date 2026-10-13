"""Research query endpoint: the single test seam for the Text-to-SQL tracer.

Everything is exercised through `POST /api/v1/research/query` (ticket #5 /
parent #1 Testing Decisions): the LLM is replaced by a FakeProvider test
double, but the SQL it returns is validated and executed against the real
`water_maze` database with the real `lingsight_ro` account — the seam proves
the pipeline, not the model.
"""

import logging
from collections.abc import Iterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.api.routes.research import get_query_provider, get_research_settings
from app.main import app
from app.text_to_sql.gateway import OpenAICompatProvider, ProviderError
from app.text_to_sql.settings import ResearchQuerySettings

DEMO_QUESTION = "一共有多少只动物"
# docs/09 C15 golden answer: 6 animals via (group_name, mouse_id).
CANONICAL_SQL = (
    "SELECT COUNT(DISTINCT CONCAT(group_name, '|', mouse_id)) AS animal_count "
    "FROM videos WHERE phase = 'training_day'"
)
# docs/09 C15 trap: animal_code is a group-mouse-trial code (26 fake animals).
TRAP_SQL = (
    "SELECT COUNT(DISTINCT animal_code) AS animal_count FROM videos "
    "WHERE phase = 'training_day'"
)


class FakeProvider:
    """Scripted stand-in for the Model Gateway: returns queued completions."""

    def __init__(self, responses: list[str]) -> None:
        self.responses = list(responses)
        self.calls: list[list[dict[str, str]]] = []

    def chat(self, messages: list[dict[str, str]]) -> str:
        self.calls.append(list(messages))
        if not self.responses:
            raise AssertionError("FakeProvider exhausted")
        return self.responses.pop(0)


@pytest.fixture
def client_no_auth() -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


def ask(
    client: TestClient,
    provider: FakeProvider,
    *,
    question: str = DEMO_QUESTION,
    headers: dict[str, str] | None = None,
    settings: ResearchQuerySettings | None = None,
) -> Any:
    app.dependency_overrides[get_query_provider] = lambda: provider
    if settings is not None:
        app.dependency_overrides[get_research_settings] = lambda: settings
    return client.post(
        "/api/v1/research/query",
        json={"question": question},
        headers=headers,
    )


@pytest.fixture(autouse=True)
def _clear_overrides() -> Iterator[None]:
    yield
    app.dependency_overrides.pop(get_query_provider, None)
    app.dependency_overrides.pop(get_research_settings, None)


def test_canonical_animal_count_returns_6_with_caliber_note(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    # C15 demo question: the answer must be 6 — the (group_name, mouse_id)
    # grain — never the animal_code trap value 26.
    provider = FakeProvider([CANONICAL_SQL])
    response = ask(client, provider, headers=normal_user_token_headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "ok"
    assert body["row_count"] == 1
    assert body["columns"] == ["animal_count"]
    assert body["rows"] == [[6]]
    # The caliber note must surface the canonical animal grain.
    assert "(group_name, mouse_id)" in body["caliber_note"]
    # LIMIT is enforced even though the model omitted it.
    assert "LIMIT" in body["sql"].upper()
    assert body["data_source"]["tables"] == ["videos"]
    assert body["data_source"]["database"] == "water_maze"
    assert body["data_source"]["truncated"] is False


def test_animal_code_trap_sql_is_rejected_not_executed(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    # The trap SQL never reaches the database: the AST whitelist rejects the
    # excluded column, the bounded repair budget (2 retries) is exhausted,
    # then rejection.
    provider = FakeProvider([TRAP_SQL, TRAP_SQL, TRAP_SQL])
    response = ask(client, provider, headers=normal_user_token_headers)
    assert response.status_code == 403, response.text
    body = response.json()
    assert body["status"] == "rejected"
    assert body["reason_code"] == "whitelist_violation"
    assert "animal_code" in body["message"]
    assert body["attempts"] == 3
    # Bounded repair: initial attempt + at most 2 retries.
    assert len(provider.calls) == 3
    assert "animal_code" in provider.calls[1][-1]["content"]


def test_attempts_and_verdict_are_written_to_the_server_audit_log(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    caplog: pytest.LogCaptureFixture,
) -> None:
    # AGENTS.md §3: the audit trail must be enforced server-side — the
    # in-response trace alone is not a log. Every failed attempt and the
    # final verdict must reach the pipeline logger.
    provider = FakeProvider([TRAP_SQL, TRAP_SQL, TRAP_SQL])
    with caplog.at_level(logging.INFO, logger="app.text_to_sql.pipeline"):
        response = ask(client, provider, headers=normal_user_token_headers)
    assert response.status_code == 403, response.text
    attempt_records = [
        r for r in caplog.records if r.getMessage().startswith("research_query attempt=")
    ]
    verdict_records = [r for r in caplog.records if " rejected " in r.getMessage()]
    assert len(attempt_records) == 3
    assert len(verdict_records) == 1
    assert "whitelist_violation" in verdict_records[0].getMessage()


def test_d21_backup_table_rejected(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    # docs/09 D21: querying the backup table must be refused.
    provider = FakeProvider(
        [
            "SELECT COUNT(*) AS n FROM rescue_backup_videos_20261011",
            "SELECT COUNT(*) AS n FROM rescue_backup_videos_20261011",
            "SELECT COUNT(*) AS n FROM rescue_backup_videos_20261011",
        ]
    )
    response = ask(client, provider, headers=normal_user_token_headers)
    assert response.status_code == 403, response.text
    body = response.json()
    assert body["reason_code"] == "whitelist_violation"
    assert "rescue_backup_videos_20261011" in body["message"]
    assert body["attempts"] == 3


def test_d22_delete_rejected(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    # docs/09 D22: write operations must be refused before execution. The
    # bounded repair rounds happen too — the model stays wrong, so the final
    # verdict is still a typed rejection.
    provider = FakeProvider(["DELETE FROM videos"] * 3)
    response = ask(client, provider, headers=normal_user_token_headers)
    assert response.status_code == 400, response.text
    body = response.json()
    assert body["reason_code"] == "non_select"
    assert body["attempts"] == 3


def test_d23_cross_database_rejected(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    # docs/09 D23: schema-qualified (cross-database) references must be
    # refused even though the table name itself looks familiar.
    provider = FakeProvider(
        ["SELECT COUNT(*) AS n FROM wm_sync_stage_20261012.videos"] * 3
    )
    response = ask(client, provider, headers=normal_user_token_headers)
    assert response.status_code == 403, response.text
    body = response.json()
    assert body["reason_code"] == "db_not_allowed"
    assert body["attempts"] == 3


def test_frame_query_runs_through_the_view(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    # Ticket #7 (M1-T8): the AST whitelist now points at
    # v_query_frame_predictions, and the account layer granted exactly that
    # view (docs/evidence/m1-t8/02-ro-view-probe.log) — so a frame query
    # executes for real. 788,088 = the docs/09 Q10 golden decomposition
    # (783,790 ok + 4,292 miss + 6 coord).
    provider = FakeProvider(["SELECT COUNT(*) AS n FROM v_query_frame_predictions"])
    response = ask(client, provider, headers=normal_user_token_headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["rows"] == [[788088]]
    assert body["data_source"]["tables"] == ["v_query_frame_predictions"]


def test_d24_mask_rle_counts_readable_through_the_view(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    # docs/09 D24, reversed by user decision 2026-10-13 (ADR-0007, ticket
    # #15): the mask family is open on the query surface. A small-range RLE
    # read through the view succeeds — one row, capped by the row limit;
    # the row cap (200) is what bounds the longtext payload now.
    provider = FakeProvider(
        ["SELECT mask_rle_counts FROM v_query_frame_predictions LIMIT 1"]
    )
    response = ask(client, provider, headers=normal_user_token_headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["columns"] == ["mask_rle_counts"]
    assert body["row_count"] == 1
    assert body["data_source"]["tables"] == ["v_query_frame_predictions"]


def test_base_table_frame_predictions_is_not_an_entry_point(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    # Ticket #7: the whitelist no longer offers the base table, so the AST
    # guard refuses it — matching the account layer, where the base table
    # was never granted (docs/evidence/m1-t8/02-ro-view-probe.log probe ③).
    provider = FakeProvider(
        [
            "SELECT COUNT(*) AS n FROM frame_predictions",
            "SELECT COUNT(*) AS n FROM frame_predictions",
            "SELECT COUNT(*) AS n FROM frame_predictions",
        ]
    )
    response = ask(client, provider, headers=normal_user_token_headers)
    assert response.status_code == 403, response.text
    body = response.json()
    assert body["reason_code"] == "whitelist_violation"
    assert "frame_predictions" in body["message"]
    assert body["attempts"] == 3


def test_execution_error_is_typed_and_not_retried(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    # A SQL error that only MySQL can catch (unknown function) surfaces as a
    # typed execution_error — and execution failures never trigger repair.
    provider = FakeProvider(["SELECT UNKNOWN_FN(video_id) AS x FROM videos LIMIT 3"])
    response = ask(client, provider, headers=normal_user_token_headers)
    assert response.status_code == 502, response.text
    body = response.json()
    assert body["reason_code"] == "execution_error"
    assert len(provider.calls) == 1
    assert body["attempts"] == 1
    assert [t["stage"] for t in body["trace"]] == ["execution"]


def test_timeout_is_typed(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    # SET SESSION MAX_EXECUTION_TIME kills a slow statement server-side; the
    # pipeline maps it to the `timeout` reason code, names the explicit time
    # budget, and never retries execution failures (ticket #8).
    settings = ResearchQuerySettings(
        _env_file=None,
        LINGSIGHT_RO_PASSWORD=_env_password(),
        RESEARCH_QUERY_TIMEOUT_MS=1000,
    )
    provider = FakeProvider(["SELECT SLEEP(5) AS s FROM datasets LIMIT 5"])
    response = ask(
        client, provider, headers=normal_user_token_headers, settings=settings
    )
    assert response.status_code == 504, response.text
    body = response.json()
    assert body["reason_code"] == "timeout"
    assert body["message"]
    assert "MAX_EXECUTION_TIME" in body["message"]
    assert "1000" in body["message"]
    assert len(provider.calls) == 1
    assert body["attempts"] == 1
    assert [t["stage"] for t in body["trace"]] == ["execution"]


def test_validation_repair_recovers_from_fence_and_missing_table(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    # First completion is a non-whitelisted guess; the repair round-trip
    # (error fed back) yields a valid statement that then executes for real.
    provider = FakeProvider(
        [
            "```sql\nSELECT COUNT(*) AS n FROM mouse_registry\n```",
            "SELECT COUNT(*) AS n FROM datasets",
        ]
    )
    response = ask(client, provider, headers=normal_user_token_headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["rows"] == [[1]]
    assert body["data_source"]["tables"] == ["datasets"]
    assert len(provider.calls) == 2
    assert body["attempts"] == 2
    assert [t["reason_code"] for t in body["trace"]] == ["whitelist_violation"]


def test_markdown_fence_is_stripped_from_model_output(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    provider = FakeProvider([f"```mysql\n{CANONICAL_SQL}\n```"])
    response = ask(client, provider, headers=normal_user_token_headers)
    assert response.status_code == 200
    assert response.json()["rows"] == [[6]]


# --- ticket #8: typed repair loop and error taxonomy --------------------------


def test_syntax_error_recovers_within_retry_budget(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    # Acceptance 1: an injected syntax error recovers within the <=2-retry
    # budget — the parse failure is fed back and the next attempt executes.
    provider = FakeProvider(["SELECT COUNT(* FROM videos", CANONICAL_SQL])
    response = ask(client, provider, headers=normal_user_token_headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "ok"
    assert body["rows"] == [[6]]
    assert body["attempts"] == 2
    assert [t["reason_code"] for t in body["trace"]] == ["parse_error"]
    assert body["trace"][0]["stage"] == "validation"
    assert body["trace"][0]["attempt"] == 1
    # The failed SQL was fed back verbatim as repair context (assistant turn).
    assert provider.calls[1][-2]["role"] == "assistant"
    assert "SELECT COUNT(* FROM videos" in provider.calls[1][-2]["content"]
    # The typed failure itself also reaches the repair prompt, ANSI-free.
    assert "parse_error" in provider.calls[1][-1]["content"]
    assert "\x1b" not in provider.calls[1][-1]["content"]


def test_syntax_error_exhausts_budget_then_fails_typed(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    # Acceptance 1 (exhaustion side): after the budget is spent the verdict
    # is a typed, structured failure — never a fabricated answer.
    provider = FakeProvider(["SELECT COUNT(* FROM videos", "WHERE (", "FROM"])
    response = ask(client, provider, headers=normal_user_token_headers)
    assert response.status_code == 400, response.text
    body = response.json()
    assert body["status"] == "rejected"
    assert body["reason_code"] == "parse_error"
    assert body["message"]
    assert body["attempts"] == 3
    assert [t["reason_code"] for t in body["trace"]] == ["parse_error"] * 3
    assert len(provider.calls) == 3


def test_permission_failure_retries_with_identical_whitelist(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Acceptance 2: zero relaxation. Every retry validates against the very
    # same frozen whitelist and row cap; the system prompt (the whitelist's
    # source) is byte-identical across attempts; the repair prompt states
    # that the whitelist will not be widened; the verdict stays typed.
    import app.text_to_sql.pipeline as pipeline_module

    real_validate = pipeline_module.validate_sql
    seen_whitelists: list[object] = []
    seen_caps: list[int] = []

    def spy(sql: str, whitelist: object, *, max_rows: int) -> object:
        seen_whitelists.append(whitelist)
        seen_caps.append(max_rows)
        return real_validate(sql, whitelist, max_rows=max_rows)  # type: ignore[arg-type]

    monkeypatch.setattr(pipeline_module, "validate_sql", spy)
    provider = FakeProvider([TRAP_SQL, TRAP_SQL, TRAP_SQL])
    response = ask(client, provider, headers=normal_user_token_headers)
    assert response.status_code == 403, response.text
    body = response.json()
    assert body["reason_code"] == "whitelist_violation"
    assert body["attempts"] == 3
    assert [t["reason_code"] for t in body["trace"]] == ["whitelist_violation"] * 3
    # One frozen whitelist object validated all three attempts.
    assert len(seen_whitelists) == 3
    assert all(w is seen_whitelists[0] for w in seen_whitelists)
    assert set(seen_caps) == {200}
    # The system prompt never changed between retries.
    assert len({repr(call[0]) for call in provider.calls}) == 1
    # The repair prompt says the constraints will not be relaxed.
    assert "不会放宽" in provider.calls[1][-1]["content"]
    assert "不会放宽" in provider.calls[2][-1]["content"]


def test_empty_result_is_returned_verbatim_without_rewrite(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    # Acceptance 3: an empty result set is not an error. The SQL executes
    # verbatim, the answer carries an empty marker plus a deterministic
    # suggestion, and there is no second "loosened conditions" model call.
    empty_sql = (
        "SELECT video_id FROM videos WHERE group_name = 'NO_SUCH_GROUP' LIMIT 10"
    )
    provider = FakeProvider([empty_sql])
    response = ask(client, provider, headers=normal_user_token_headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "ok"
    assert body["rows"] == []
    assert body["row_count"] == 0
    assert body["empty"] is True
    assert "phase" in body["suggestion"]
    assert "不会自动" in body["suggestion"]
    # Executed SQL == model output, byte for byte.
    assert body["sql"] == empty_sql
    # No condition-loosening retry ever happened.
    assert len(provider.calls) == 1
    assert body["attempts"] == 1
    assert body["trace"] == []


def test_requires_authentication(client_no_auth: TestClient) -> None:
    provider = FakeProvider([CANONICAL_SQL])
    response = ask(client_no_auth, provider)
    assert response.status_code == 401


def test_empty_question_rejected(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    provider = FakeProvider([])
    response = ask(client, provider, question="", headers=normal_user_token_headers)
    assert response.status_code == 422


def _env_password() -> str:
    # The read-only password reaches tests only through the environment
    # (.env), exactly like production code paths.
    import os

    password = os.environ.get("LINGSIGHT_RO_PASSWORD", "")
    if not password:
        from app.text_to_sql.settings import get_research_settings

        password = get_research_settings().LINGSIGHT_RO_PASSWORD
    assert password, "LINGSIGHT_RO_PASSWORD must be configured via env/.env"
    return password


def test_provider_error_surfaces_vendor_reason(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A failing endpoint must show its own error text, not just the code.

    Found live: Zhipu returns HTTP 429 with body
    ``{"error": {"code": "1113", "message": "余额不足…"}}`` — the balance
    reason was invisible until the gateway learned to quote the body.
    """

    def fake_post(_url: str, /, **_kwargs: Any) -> httpx.Response:
        return httpx.Response(
            429,
            json={"error": {"code": "1113", "message": "余额不足或无可用资源包"}},
        )

    monkeypatch.setattr(httpx, "post", fake_post)
    provider = OpenAICompatProvider(
        base_url="https://example.invalid/v4",
        api_key="k",
        model="m",
    )
    with pytest.raises(ProviderError, match=r"HTTP 429.*1113: 余额不足"):
        provider.chat([{"role": "user", "content": "hi"}])
