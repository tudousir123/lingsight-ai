"""User HTTP boundary; no historical shared task can be adopted by ID."""

import uuid
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from tests.utils.user import authentication_token_from_email


def test_unknown_task_is_hidden_before_upstream(
    client: TestClient, db: Session
) -> None:
    email = f"inference-{uuid.uuid4()}@example.com"
    headers = authentication_token_from_email(client=client, email=email, db=db)
    calls = []
    original = httpx.AsyncClient

    def upstream(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json={"id": str(uuid.uuid4())})

    with (
        patch.object(settings, "AGENT_WORKSPACE_EMAIL", email),
        patch.object(settings, "INFERENCE_API_TOKEN", "synthetic"),
        patch.object(settings, "INFERENCE_BASE_URL", "http://inference.test"),
        patch(
            "app.api.gateway.httpx.AsyncClient",
            side_effect=lambda **kw: original(
                transport=httpx.MockTransport(upstream), **kw
            ),
        ),
    ):
        response = client.get(
            f"/api/v1/inference/tasks/{uuid.uuid4()}", headers=headers
        )
    assert response.status_code == 404
    assert calls == []


def test_task_create_requires_project_and_video(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/inference/tasks",
        headers=superuser_token_headers,
        json={"video_id": "shared-video"},
    )
    assert response.status_code == 422


def test_confirmation_does_not_exist_for_unknown_project_video(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"/api/v1/projects/{uuid.uuid4()}/videos/unknown/preannotation-confirmations",
        headers={**superuser_token_headers, "Idempotency-Key": str(uuid.uuid4())},
        json={
            "task_id": str(uuid.uuid4()),
            "candidate_version": "a" * 64,
            "expected_confirmation_id": None,
            "seed": {"frame": 0, "x": 10, "y": 10},
            "pool": {"cx": 10, "cy": 10, "radius": 5},
            "marks": [],
        },
    )
    assert response.status_code == 404
    assert response.json()["detail"] != "Not Found"


def test_publish_cannot_adopt_unknown_task(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    project = client.post(
        "/api/v1/projects/",
        headers=superuser_token_headers,
        json={"name": f"publish-{uuid.uuid4()}"},
    ).json()
    response = client.post(
        f"/api/v1/projects/{project['id']}/results",
        headers=superuser_token_headers,
        json={"task_id": str(uuid.uuid4())},
    )
    assert response.status_code == 404
