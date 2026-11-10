"""Personal-workspace boundary and restricted inference forwarding."""

from unittest.mock import patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.api.routes.inference import router
from app.api.routes.trials import get_media_user
from app.core.config import settings
from app.models import User

TASK = "11111111-1111-4111-8111-111111111111"


def test_inference_gateway_authorizes_and_limits_operations() -> None:
    app = FastAPI()
    app.include_router(router)
    user = User(email="owner@example.com", hashed_password="unused")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_media_user] = lambda: user
    requests: list[httpx.Request] = []

    def upstream(req: httpx.Request) -> httpx.Response:
        requests.append(req)
        return httpx.Response(
            206,
            content=b"video",
            headers={"content-range": "bytes 0-4/10", "content-type": "video/mp4"},
        )

    original = httpx.AsyncClient
    with (
        patch.object(settings, "AGENT_WORKSPACE_EMAIL", "owner@example.com"),
        patch.object(settings, "INFERENCE_API_TOKEN", "private"),
        patch.object(settings, "INFERENCE_BASE_URL", "http://inference.test"),
        patch(
            "app.api.routes.inference.httpx.AsyncClient",
            side_effect=lambda **kw: original(
                transport=httpx.MockTransport(upstream), **kw
            ),
        ),
        TestClient(app) as client,
    ):
        assert client.post("/inference/tasks/../../admin").status_code == 404
        response = client.get(
            f"/inference/tasks/{TASK}/artifacts/overlay.mp4",
            headers={"Range": "bytes=0-4"},
        )
        assert response.status_code == 206
        assert response.headers["content-range"] == "bytes 0-4/10"
        assert requests[-1].headers["authorization"] == "Bearer private"
        assert requests[-1].headers["range"] == "bytes=0-4"
        user.email = "other@example.com"
        assert client.get("/inference/tasks").status_code == 403
        assert len(requests) == 1
