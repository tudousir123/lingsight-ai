"""Explicit, synthetic application configuration for the test process."""

import os
import re
from unittest.mock import patch

from sqlalchemy.engine import make_url

from app.core.settings import Settings


def test_database_url(value: str | None) -> str:
    """Fail before connecting if a caller accidentally supplies a normal DB."""
    if not value:
        raise ValueError("Use bash scripts/test-local.sh, or set TEST_DATABASE_URL")
    url = make_url(value)
    if url.drivername != "mysql+pymysql" or not re.fullmatch(
        r"lingsight_test_[a-z0-9_]+", url.database or ""
    ):
        raise ValueError(
            "TEST_DATABASE_URL must use MySQL and a lingsight_test_* database"
        )
    return value


def configure_application() -> str | None:
    database_url = os.environ.get("TEST_DATABASE_URL") or None
    if database_url:
        test_database_url(database_url)
    # Clear process settings while constructing the synthetic instance; neither
    # a developer's dotenv nor SMTP/Sentry/Agent credentials enter this object.
    with patch.dict(os.environ, {}, clear=True):
        settings = Settings(
            # BaseSettings accepts this runtime-only keyword; Pydantic's
            # synthesized model signature omits it. Keep dotenv disabled.
            _env_file=None,  # type: ignore[call-arg]
            SECRET_KEY="synthetic-backend-tests-secret-not-for-deployment",
            PROJECT_NAME="LingSight tests",
            DATABASE_URL=database_url
            or "mysql+pymysql://unused:unused@127.0.0.1:1/lingsight_test_unconfigured",  # type: ignore[arg-type]
            FIRST_SUPERUSER="admin@example.com",
            FIRST_SUPERUSER_PASSWORD="synthetic-test-password",
            FASTAPI_ENV="development",
            EMAILS_FROM_EMAIL="tests@example.com",
        )
    # Production callers retain the same config.settings object; tests replace
    # its construction before importing routes, security or the database engine.
    with patch("app.core.settings.get_settings", return_value=settings):
        from app.core import config

        config.settings = settings
    return database_url
