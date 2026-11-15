"""Stable validation errors for new platform APIs, without changing legacy APIs."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import settings


def test_new_resource_validation_has_machine_readable_fields(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    response = client.get(
        f"{settings.API_V1_STR}/users/not-a-uuid/whole-library-access",
        headers=superuser_token_headers,
    )
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "invalid_input"
    assert "path.user_id" in detail["fields"]
    assert "input" not in detail


def test_existing_signup_keeps_validation_contract(client: TestClient) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/users/signup", json={"email": "invalid"}
    )
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)


def test_internal_credential_rejects_non_ascii_header(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api.routes.agent_authorization import router

    monkeypatch.setattr(settings, "AGENT_AUTHORIZATION_TOKEN", "synthetic-callback")
    application = FastAPI()
    application.include_router(router, prefix=settings.API_V1_STR)
    with TestClient(application, raise_server_exceptions=False) as service:
        response = service.post(
            f"{settings.API_V1_STR}/internal/agent/authorize",
            headers=[(b"authorization", b"Bearer \xff")],
            json={
                "user_id": "11111111-1111-4111-8111-111111111111",
                "data_scope": "none",
                "project_id": None,
            },
        )
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "authentication_required"
