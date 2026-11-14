import pytest

from app.core.config import settings
from tests.runtime import test_database_url as validate_test_database_url


@pytest.mark.parametrize(
    "name", ["app", "water_maze", "water_maze_v3", "lingsight_test", ""]
)
def test_refuses_non_test_database(name: str) -> None:
    with pytest.raises(ValueError, match="lingsight_test_"):
        validate_test_database_url(f"mysql+pymysql://user:synthetic@localhost/{name}")


def test_refuses_implicit_database() -> None:
    with pytest.raises(ValueError, match="test-local"):
        validate_test_database_url(None)


def test_preserves_explicit_test_database() -> None:
    url = "mysql+pymysql://user:synthetic@localhost/lingsight_test_example"
    assert validate_test_database_url(url) == url


def test_application_configuration_is_synthetic() -> None:
    assert settings.SENTRY_DSN is None
    assert settings.SMTP_HOST is None
    assert settings.AGENT_API_TOKEN == ""
    assert settings.DATABASE_URL.path.startswith("/lingsight_test_")


def test_shared_database_lock_blocks_other_connections(db: object) -> None:
    import hashlib

    from sqlalchemy import text

    from app.core.db import engine

    with engine.connect() as other:
        database = other.execute(text("SELECT DATABASE()")).scalar_one()
        key = "lingsight-test-" + hashlib.sha256(database.encode()).hexdigest()[:40]
        assert (
            other.execute(text("SELECT GET_LOCK(:key, 0)"), {"key": key}).scalar_one()
            == 0
        )
