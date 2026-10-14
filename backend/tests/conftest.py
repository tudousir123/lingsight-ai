import fcntl
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete

from app.core.config import settings
from app.core.db import engine, init_db
from app.main import app
from app.models import Item, User
from tests.utils.user import authentication_token_from_email
from tests.utils.utils import get_superuser_token_headers

# Teardown below deletes every User/Item row, so two concurrent pytest
# sessions on this shared DB corrupt each other (one session's teardown
# wipes the other's users mid-run -> a wall of false "User not found").
# The lock turns that silent corruption into an immediate, explained exit.
_TEST_DB_LOCK = Path("/tmp/lingsight_backend_pytest.lock")


@pytest.fixture(scope="session", autouse=True)
def db() -> Generator[Session]:
    lock = _TEST_DB_LOCK.open("w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        pytest.exit(
            "另一个 pytest 会话正持有测试库锁 ("
            f"{_TEST_DB_LOCK})。共享测试库不支持并发运行：teardown 会互删"
            "用户造成成片假失败。等它结束再跑，或先 `pkill -f pytest`。",
            returncode=3,
        )
    try:
        with Session(engine) as session:
            init_db(session)
            yield session
            session.execute(delete(Item))
            session.execute(delete(User))
            session.commit()
            # 本机 dev 栈与测试共享 app 库：清空后立刻用同一个 init_db 把
            # FIRST_SUPERUSER 重建回来，任何一次 pytest（哪怕单文件）都不再
            # 静默废掉本地登录（曾两次咬人，local-e2e §4 / retro 2026-10-14）。
            # 其他手工账号仍会丢失；CI 每分片全新库，无感。
            init_db(session)
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()


@pytest.fixture(scope="module")
def client() -> Generator[TestClient]:
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def superuser_token_headers(client: TestClient) -> dict[str, str]:
    return get_superuser_token_headers(client)


@pytest.fixture(scope="module")
def normal_user_token_headers(client: TestClient, db: Session) -> dict[str, str]:
    return authentication_token_from_email(
        client=client, email=settings.EMAIL_TEST_USER, db=db
    )
