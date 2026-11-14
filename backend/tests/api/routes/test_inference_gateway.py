"""Personal-workspace boundary and restricted inference forwarding."""

from dataclasses import dataclass, field
from types import SimpleNamespace
from unittest.mock import patch

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.deps import get_current_user, get_media_user
from app.api.routes.inference import router
from app.core.config import settings
from app.models import User

TASK = "11111111-1111-4111-8111-111111111111"


@dataclass
class Harness:
    app: FastAPI
    client: TestClient
    user: User
    requests: list[httpx.Request]
    state: SimpleNamespace = field(repr=False)

    @property
    def response(self) -> httpx.Response:
        return self.state.response


@pytest.fixture
def gateway() -> Harness:
    app = FastAPI()
    app.include_router(router)
    user = User(email="owner@example.com", hashed_password="unused")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_media_user] = lambda: user
    requests: list[httpx.Request] = []
    state = SimpleNamespace(response=httpx.Response(200, json=[]), error=None)

    def upstream(req: httpx.Request) -> httpx.Response:
        requests.append(req)
        if state.error is not None:
            raise state.error
        return state.response

    original = httpx.AsyncClient
    with (
        patch.object(settings, "AGENT_WORKSPACE_EMAIL", "owner@example.com"),
        patch.object(settings, "INFERENCE_API_TOKEN", "private"),
        patch.object(settings, "INFERENCE_BASE_URL", "http://inference.test"),
        patch(
            "app.api.gateway.httpx.AsyncClient",
            side_effect=lambda **kw: original(
                transport=httpx.MockTransport(upstream), **kw
            ),
        ),
        TestClient(app) as client,
    ):
        yield Harness(app, client, user, requests, state)


def test_inference_gateway_authorizes_and_limits_operations(gateway: Harness) -> None:
    gateway.state.response = httpx.Response(
        206,
        content=b"video",
        headers={"content-range": "bytes 0-4/10", "content-type": "video/mp4"},
    )
    assert gateway.client.post("/inference/tasks/../../admin").status_code == 404
    response = gateway.client.get(
        f"/inference/tasks/{TASK}/artifacts/overlay.mp4",
        headers={"Range": "bytes=0-4"},
    )
    assert response.status_code == 206
    assert response.headers["content-range"] == "bytes 0-4/10"
    assert gateway.requests[-1].headers["authorization"] == "Bearer private"
    assert gateway.requests[-1].headers["range"] == "bytes=0-4"
    gateway.user.email = "other@example.com"
    assert gateway.client.get("/inference/tasks").status_code == 403
    assert len(gateway.requests) == 1


def test_login_required(gateway: Harness) -> None:
    gateway.app.dependency_overrides.clear()
    response = gateway.client.get("/inference/tasks")
    assert response.status_code == 401
    assert gateway.requests == []


def test_artifact_media_token_or_header_required(gateway: Harness) -> None:
    gateway.app.dependency_overrides.pop(get_media_user)
    response = gateway.client.get(f"/inference/tasks/{TASK}/artifacts/overlay.mp4")
    assert response.status_code == 403
    assert response.json()["detail"] == "Not authenticated"
    assert gateway.requests == []


def test_operation_surface_checked_before_workspace_gate(gateway: Harness) -> None:
    # Current contract: an unknown operation is a 404 even for a caller who
    # would also fail the workspace gate (the agent gateway checks in the
    # opposite order).
    gateway.user.email = "other@example.com"
    assert gateway.client.get("/inference/health").status_code == 404
    assert gateway.requests == []


def test_artifact_name_whitelist(gateway: Harness) -> None:
    response = gateway.client.get(f"/inference/tasks/{TASK}/artifacts/virus.sh")
    assert response.status_code == 404
    assert response.json()["detail"] == "Unknown inference operation"
    assert gateway.requests == []


@pytest.mark.parametrize(
    ("status", "location"),
    [(401, None), (403, None), (500, None), (502, None), (302, "http://upstream/")],
)
def test_upstream_failures_normalized(
    gateway: Harness, status: int, location: str | None
) -> None:
    headers = {"location": location} if location is not None else {}
    gateway.state.response = httpx.Response(
        status, text="private upstream detail", headers=headers
    )
    response = gateway.client.get("/inference/tasks")
    assert response.status_code == 502
    assert response.json()["detail"] == "视频推理服务暂时不可用"
    assert "private upstream detail" not in response.text


def test_connect_failure_reports_service_unavailable(gateway: Harness) -> None:
    gateway.state.error = httpx.ConnectError("connection refused")
    response = gateway.client.get("/inference/tasks")
    assert response.status_code == 503
    assert response.json()["detail"] == "暂时无法连接视频推理服务"


def test_missing_configuration(gateway: Harness) -> None:
    with patch.object(settings, "INFERENCE_API_TOKEN", ""):
        assert gateway.client.get("/inference/tasks").status_code == 503
        assert gateway.client.get("/inference/tasks").json()["detail"] == (
            "视频推理服务尚未配置"
        )
    assert gateway.requests == []


def test_payload_size_limit(gateway: Harness) -> None:
    response = gateway.client.post("/inference/tasks", content=b"x" * 512001)
    assert response.status_code == 413
    assert gateway.requests == []


def test_videos_query_path_forwarded(gateway: Harness) -> None:
    gateway.client.get("/inference/videos?path=day01/sub")
    assert gateway.requests[-1].url.params["path"] == "day01/sub"
    assert (
        str(gateway.requests[-1].url)
        == "http://inference.test/v1/videos?path=day01%2Fsub"
    )
    gateway.client.get("/inference/videos")
    assert gateway.requests[-1].url.params["path"] == ""
    gateway.client.get("/inference/tasks?path=should-not-forward")
    assert "path" not in gateway.requests[-1].url.params


def test_client_accept_forwarded_verbatim(gateway: Harness) -> None:
    gateway.client.get("/inference/tasks", headers={"Accept": "text/csv"})
    assert gateway.requests[-1].headers["accept"] == "text/csv"


def test_video_sources_and_source_query_are_forwarded(gateway: Harness) -> None:
    gateway.state.response = httpx.Response(
        200,
        json={
            "items": [
                {
                    "id": "legacy",
                    "label": "现有推理视频目录",
                    "kind": "filesystem",
                    "available": True,
                }
            ]
        },
    )
    sources = gateway.client.get("/inference/sources")
    assert sources.status_code == 200
    assert gateway.requests[-1].url.path == "/v1/sources"
    gateway.client.get(
        "/inference/videos?source_id=lab-nas&path=Day1&url=http://evil.test&token=leak"
    )
    assert dict(gateway.requests[-1].url.params) == {
        "path": "Day1",
        "source_id": "lab-nas",
    }
    gateway.client.get("/inference/tasks?source_id=lab-nas")
    assert "source_id" not in gateway.requests[-1].url.params
