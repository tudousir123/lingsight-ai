"""A project scope must pass platform ownership checks before reaching Agent."""

import json
import uuid
from collections.abc import Iterator
from unittest.mock import Mock, patch

import pytest
from fastapi import HTTPException

from app.api.deps import get_db
from tests.api.routes import test_agent_gateway as contract

PROJECT_ID = "44444444-4444-4444-8444-444444444444"


@pytest.fixture
def gateway() -> Iterator[contract.AgentGatewayTest]:
    case = contract.AgentGatewayTest()
    case.setUp()
    case.app.dependency_overrides[get_db] = lambda: Mock(name="isolated_session")
    try:
        yield case
    finally:
        case.doCleanups()


def test_owned_project_is_checked_and_forwarded(
    gateway: contract.AgentGatewayTest,
) -> None:
    with patch("app.api.routes.agent.owned_project") as own:
        response = gateway.client.post(
            "/agent/tasks", json={"goal": "Analyze", "project_id": PROJECT_ID}
        )
    assert response.status_code == 200
    assert own.call_args.args[1] is gateway.user
    assert own.call_args.args[2] == uuid.UUID(PROJECT_ID)
    assert json.loads(gateway.calls[0].content)["project_id"] == PROJECT_ID


def test_foreign_or_deleted_project_never_reaches_agent(
    gateway: contract.AgentGatewayTest,
) -> None:
    with patch(
        "app.api.routes.agent.owned_project",
        side_effect=HTTPException(404, "项目不存在"),
    ):
        response = gateway.client.post(
            "/agent/tasks", json={"goal": "Analyze", "project_id": PROJECT_ID}
        )
    assert response.status_code == 404
    assert not gateway.calls


@pytest.mark.parametrize("project_id", ["wrong", "", {}, [], 5, True])
def test_invalid_scope_is_rejected_before_upstream(
    gateway: contract.AgentGatewayTest, project_id: object
) -> None:
    response = gateway.client.post(
        "/agent/tasks", json={"goal": "Analyze", "project_id": project_id}
    )
    assert response.status_code == 422
    assert not gateway.calls


def test_legacy_unscoped_task_does_not_read_project_database(
    gateway: contract.AgentGatewayTest,
) -> None:
    with patch("app.api.routes.agent.owned_project") as own:
        response = gateway.client.post("/agent/tasks", json={"goal": "Analyze"})
    assert response.status_code == 200
    own.assert_not_called()


def test_project_validation_preserves_body_ceiling(
    gateway: contract.AgentGatewayTest,
) -> None:
    response = gateway.client.post(
        "/agent/tasks", json={"goal": "x" * 128001, "project_id": PROJECT_ID}
    )
    assert response.status_code == 413
    assert not gateway.calls
