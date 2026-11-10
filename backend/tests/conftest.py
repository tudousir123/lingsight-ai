import hashlib
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlmodel import Session, delete

from tests.runtime import configure_application

_TEST_DATABASE_URL = configure_application()


@pytest.fixture(scope="session")
def db() -> Generator[Session]:
    if _TEST_DATABASE_URL is None:
        pytest.fail(
            "Database test requires an isolated database: bash scripts/test-local.sh"
        )
    from app.core.db import engine, init_db
    from app.models import Item, User

    # MySQL owns this lock, so credentials, hostname aliases and URL options
    # cannot make two sessions on the same server/database miss each other.
    # Keep the lock on a dedicated connection until teardown is complete.
    with engine.connect() as lock:
        database = lock.execute(text("SELECT DATABASE()")).scalar_one()
        key = "lingsight-test-" + hashlib.sha256(database.encode()).hexdigest()[:40]
        acquired = lock.execute(
            text("SELECT GET_LOCK(:key, 0)"), {"key": key}
        ).scalar_one()
        if acquired != 1:
            pytest.exit(
                "另一个 pytest 会话正持有该测试库的 MySQL 锁。"
                "等它结束再跑，或使用独立临时测试库。",
                returncode=3,
            )
        try:
            with Session(engine) as session:
                init_db(session)
                yield session
                session.execute(delete(Item))
                session.execute(delete(User))
                session.commit()
        finally:
            lock.execute(text("SELECT RELEASE_LOCK(:key)"), {"key": key})


@pytest.fixture(scope="module")
def client(db: Session) -> Generator[TestClient]:  # noqa: ARG001 - initialize the isolated DB
    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def superuser_token_headers(client: TestClient) -> dict[str, str]:
    from tests.utils.utils import get_superuser_token_headers

    return get_superuser_token_headers(client)


@pytest.fixture(scope="module")
def normal_user_token_headers(client: TestClient, db: Session) -> dict[str, str]:
    from app.core.config import settings
    from tests.utils.user import authentication_token_from_email

    return authentication_token_from_email(
        client=client, email=settings.EMAIL_TEST_USER, db=db
    )
