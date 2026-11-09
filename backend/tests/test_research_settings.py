import pytest

from app.core.research import ResearchDatabaseSettings
from app.text_to_sql.settings import ResearchQuerySettings


def test_browsing_and_legacy_query_share_connection_policy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("RESEARCH_DB_NAME", "water_maze")
    monkeypatch.setenv("RESEARCH_QUERY_TIMEOUT_MS", "12000")
    monkeypatch.setenv("LINGSIGHT_RO_PASSWORD", "synthetic-research-test-password")
    browsing = ResearchDatabaseSettings(_env_file=None)
    query = ResearchQuerySettings(_env_file=None)
    assert (
        query.model_dump(include=set(type(browsing).model_fields))
        == browsing.model_dump()
    )
    assert browsing.read_timeout_seconds == 17
    assert not hasattr(browsing, "LLM_API_KEY")
