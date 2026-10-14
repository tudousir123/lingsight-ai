"""Pipeline settings: every credential arrives via environment (ticket #5).

The research query pipeline talks to two external services — an OpenAI-
compatible LLM endpoint and the `water_maze` MySQL database through the
`lingsight_ro` read-only account. Both are configured exclusively through
environment variables (never literals), following the pattern of
``app.core.config``.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class ResearchQuerySettings(BaseSettings):
    """Env-driven configuration for the query tracer (no secret defaults)."""

    model_config = SettingsConfigDict(
        # Same .env as app.core.config (one level above ./backend/).
        env_file="../.env",
        env_ignore_empty=True,
        extra="ignore",
    )

    # --- Model Gateway (thin, single provider; ADR-0001) ---
    LLM_BASE_URL: str | None = None
    LLM_API_KEY: str | None = None
    LLM_MODEL: str = "gpt-4o-mini"
    LLM_TIMEOUT_SECONDS: float = 60.0
    #: Wire protocol of the endpoint: "openai" (/chat/completions) or
    #: "anthropic" (/v1/messages — GLM Coding Plan subscription keys and
    #: Claude-compatible vendors). Swapping protocol stays a config change.
    LLM_PROTOCOL: str = "openai"
    #: Anthropic protocol requires max_tokens on every request; sized for
    #: deterministic SQL generation (reasoning blocks share this budget).
    LLM_MAX_TOKENS: int = 4096
    #: Extended thinking on the Anthropic protocol (GLM reasoning models):
    #: "enabled" adds a thinking budget to every request. The "effort level"
    #: is expressed by LLM_THINKING_BUDGET_TOKENS; keep LLM_MAX_TOKENS above
    #: budget + expected answer size.
    LLM_THINKING: str = "disabled"
    LLM_THINKING_BUDGET_TOKENS: int = 8192

    # --- Read-only research database (lingsight_ro on water_maze) ---
    RESEARCH_DB_HOST: str = "127.0.0.1"
    RESEARCH_DB_PORT: int = 3306
    RESEARCH_DB_USER: str = "lingsight_ro"
    RESEARCH_DB_NAME: str = "water_maze"
    LINGSIGHT_RO_PASSWORD: str = ""

    # --- Safety rails (service-side, layered on top of the DB account) ---
    #: Row cap: appended when the model omits LIMIT, clamped when exceeded.
    RESEARCH_QUERY_MAX_ROWS: int = 200
    #: Server-side MAX_EXECUTION_TIME for read-only SELECTs (MySQL 8).
    RESEARCH_QUERY_TIMEOUT_MS: int = 10_000
    #: Bounded repair (issue #8): total retry budget for generation/validation
    #: failures, shared across syntax and permission classes. Execution
    #: failures and empty results are never retried.
    RESEARCH_QUERY_REPAIR_ATTEMPTS: int = 2

    @property
    def read_timeout_seconds(self) -> float:
        """Socket read timeout: slightly above the statement timeout."""
        return self.RESEARCH_QUERY_TIMEOUT_MS / 1000 + 5.0


@lru_cache(maxsize=1)
def get_research_settings() -> ResearchQuerySettings:
    """Cached singleton; tests override via the FastAPI dependency."""
    return ResearchQuerySettings()
