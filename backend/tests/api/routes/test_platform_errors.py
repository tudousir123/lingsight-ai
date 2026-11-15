"""Stable validation errors for new platform APIs, without changing legacy APIs."""

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
