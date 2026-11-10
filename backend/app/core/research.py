"""Connection policy for the existing read-only water_maze database.

Experiment browsing and legacy Q&A share this configuration. It is not a
water_maze_v3 adapter: that database is owned by the independent Agent via DBHub.
Environment variable names stay compatible with existing deployments.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class ResearchDatabaseSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file="../.env", env_ignore_empty=True, extra="ignore"
    )

    RESEARCH_DB_HOST: str = "127.0.0.1"
    RESEARCH_DB_PORT: int = 3306
    RESEARCH_DB_USER: str = "lingsight_ro"
    RESEARCH_DB_NAME: str = "water_maze"
    LINGSIGHT_RO_PASSWORD: str = ""
    RESEARCH_QUERY_TIMEOUT_MS: int = 10_000

    @property
    def read_timeout_seconds(self) -> float:
        return self.RESEARCH_QUERY_TIMEOUT_MS / 1000 + 5.0


@lru_cache(maxsize=1)
def get_research_database_settings() -> ResearchDatabaseSettings:
    return ResearchDatabaseSettings()
