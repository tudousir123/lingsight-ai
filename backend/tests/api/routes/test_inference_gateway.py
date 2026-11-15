"""Owned inference HTTP access and restricted upstream forwarding."""

import base64
import json
import uuid
from collections.abc import Generator
from dataclasses import dataclass, field
from types import SimpleNamespace
from unittest.mock import patch

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.deps import get_current_user, get_media_user
from app.api.routes.inference import router
from app.core.config import settings
from app.inference_models import InferenceBinding
from app.models import ExperimentAccess, Project, User

TASK = "11111111-1111-4111-8111-111111111111"
ARTIFACT = f"/inference/tasks/{TASK}/artifacts/overlay.mp4"
SOURCE = "lab-nas"
EXPERIMENT = "gateway-experiment"


@dataclass
class Harness:
    app: FastAPI
    client: TestClient
    user: User
    other_user: User
    project: Project
    grant: ExperimentAccess
    requests: list[httpx.Request]
    state: SimpleNamespace = field(repr=False)


@pytest.fixture
def gateway(db: Session, monkeypatch: pytest.MonkeyPatch) -> Generator[Harness]:
    """Persist real access records; only the external HTTP service is simulated.

    Authentication itself is covered by the real-login platform flow. These
    transport tests select a persisted principal without replacing authorization.
    """
    app = FastAPI()
    app.include_router(router)
    user = User(email=f"gateway-{uuid.uuid4()}@example.com", hashed_password="unused")
    other_user = User(
        email=f"gateway-other-{uuid.uuid4()}@example.com", hashed_password="unused"
    )
    db.add_all([user, other_user])
    db.commit()
    project = Project(
        user_id=user.id,
        name="Gateway project",
        video_source_id=SOURCE,
        video_directory="day01",
    )
    grant = ExperimentAccess(user_id=user.id, experiment_id=EXPERIMENT)
    db.add_all([project, grant])
    db.commit()
    raw_video = json.dumps({"s": SOURCE, "p": "day01/mouse.mp4"}).encode()
    video_id = "v1." + base64.urlsafe_b64encode(raw_video).decode().rstrip("=")
    db.add(
        InferenceBinding(
            owner_user_id=user.id,
            project_id=project.id,
            video_id=video_id,
            source_kind="filesystem",
            source_id=SOURCE,
            upstream_video_id=video_id,
            idempotency_key=uuid.uuid4(),
            task_id=TASK,
        )
    )
    db.commit()
    monkeypatch.setenv(
        "INFERENCE_EXPERIMENT_DIRECTORIES",
        json.dumps({SOURCE: {EXPERIMENT: "day01"}, "private-nas": {"other": ""}}),
    )
    requests: list[httpx.Request] = []
    state = SimpleNamespace(user=user, response=None, error=None)
    app.dependency_overrides[get_current_user] = lambda: state.user
    app.dependency_overrides[get_media_user] = lambda: state.user

    def upstream(req: httpx.Request) -> httpx.Response:
        requests.append(req)
        if state.error is not None:
            raise state.error
        if state.response is not None:
            return state.response
        if req.url.path == f"/v1/tasks/{TASK}":
            return httpx.Response(
                200, json={"id": TASK, "video_id": video_id, "status": "succeeded"}
            )
        if req.url.path == "/v1/videos":
            return httpx.Response(
                200,
                json={
                    "source_id": req.url.params["source_id"],
                    "path": req.url.params["path"],
                    "items": [],
                },
            )
        if req.url.path == "/v1/sources":
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "id": source,
                            "label": source,
                            "kind": "filesystem",
                            "available": True,
                        }
                        for source in (SOURCE, "private-nas")
                    ]
                },
            )
        raise AssertionError(f"Unexpected upstream request: {req.method} {req.url}")

    original_async = httpx.AsyncClient
    original_sync = httpx.Client
    try:
        with (
            patch.object(
                settings, "AGENT_WORKSPACE_EMAIL", "old-whitelist@example.com"
            ),
            patch.object(settings, "INFERENCE_API_TOKEN", "private"),
            patch.object(settings, "INFERENCE_BASE_URL", "http://inference.test"),
            patch(
                "app.api.gateway.httpx.AsyncClient",
                side_effect=lambda **kw: original_async(
                    transport=httpx.MockTransport(upstream), **kw
                ),
            ),
            patch(
                "app.inference_client.httpx.Client",
                side_effect=lambda **kw: original_sync(
                    transport=httpx.MockTransport(upstream), **kw
                ),
            ),
            TestClient(app) as client,
        ):
            yield Harness(
                app, client, user, other_user, project, grant, requests, state
            )
    finally:
        db.delete(user)
        db.delete(other_user)
        db.commit()


def test_inference_gateway_authorizes_and_limits_operations(gateway: Harness) -> None:
    gateway.state.response = httpx.Response(
        206,
        content=b"video",
        headers={
            "content-range": "bytes 0-4/10",
            "content-type": "video/mp4",
            "accept-ranges": "bytes",
            "content-length": "5",
        },
    )
    assert gateway.client.post("/inference/tasks/../../admin").status_code == 404
    response = gateway.client.get(
        ARTIFACT,
        headers={
            "Range": "bytes=0-4",
            "Authorization": "Bearer client-token",
            "X-LingSight-User-Id": str(gateway.other_user.id),
        },
    )
    assert response.status_code == 206
    assert response.content == b"video"
    assert response.headers["content-range"] == "bytes 0-4/10"
    assert response.headers["content-type"] == "video/mp4"
    assert response.headers["accept-ranges"] == "bytes"
    assert response.headers["content-length"] == "5"
    assert response.headers["cache-control"] == "private, no-store"
    assert gateway.requests[-1].headers["authorization"] == "Bearer private"
    assert gateway.requests[-1].headers["range"] == "bytes=0-4"
    assert "x-lingsight-user-id" not in gateway.requests[-1].headers
    gateway.state.user = gateway.other_user
    assert (
        gateway.client.get(ARTIFACT, headers={"Range": "bytes=0-4"}).status_code == 404
    )
    assert len(gateway.requests) == 1


def test_task_list_only_reads_owned_bindings(gateway: Harness) -> None:
    response = gateway.client.get("/inference/tasks")
    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [TASK]
    assert response.json()[0]["project_id"] == str(gateway.project.id)
    assert [request.url.path for request in gateway.requests] == [f"/v1/tasks/{TASK}"]
    gateway.state.user = gateway.other_user
    assert gateway.client.get("/inference/tasks").json() == []
    assert gateway.client.get(f"/inference/tasks/{TASK}").status_code == 404
    assert len(gateway.requests) == 1


def test_revoked_input_access_blocks_artifacts_and_filters_tasks(
    gateway: Harness, db: Session
) -> None:
    db.delete(gateway.grant)
    db.commit()
    assert (
        gateway.client.get(ARTIFACT, headers={"Range": "bytes=0-4"}).status_code == 403
    )
    response = gateway.client.get("/inference/tasks")
    assert response.status_code == 200
    assert response.json() == []
    assert gateway.requests == []


def test_login_required(gateway: Harness) -> None:
    gateway.app.dependency_overrides.clear()
    response = gateway.client.get("/inference/tasks")
    assert response.status_code == 401
    assert gateway.requests == []


def test_artifact_media_token_or_header_required(gateway: Harness) -> None:
    gateway.app.dependency_overrides.pop(get_media_user)
    response = gateway.client.get(ARTIFACT)
    assert response.status_code == 403
    assert response.json()["detail"] == "Not authenticated"
    assert gateway.requests == []


def test_operation_surface_checked_before_resource_access(gateway: Harness) -> None:
    gateway.state.user = gateway.other_user
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
    response = gateway.client.get(ARTIFACT)
    assert response.status_code == 502
    assert response.json()["detail"] == "视频推理服务暂时不可用"
    assert "private upstream detail" not in response.text


def test_connect_failure_reports_service_unavailable(gateway: Harness) -> None:
    gateway.state.error = httpx.ConnectError("connection refused")
    response = gateway.client.get(ARTIFACT)
    assert response.status_code == 503
    assert response.json()["detail"] == "暂时无法连接视频推理服务"


def test_missing_configuration(gateway: Harness) -> None:
    with patch.object(settings, "INFERENCE_API_TOKEN", ""):
        response = gateway.client.get(ARTIFACT)
    assert response.status_code == 503
    assert response.json()["detail"] == "视频推理服务尚未配置"
    assert gateway.requests == []


def test_payload_size_limit(gateway: Harness) -> None:
    response = gateway.client.post("/inference/tasks", content=b"x" * 512001)
    assert response.status_code == 413
    assert gateway.requests == []


def test_videos_query_path_forwarded(gateway: Harness) -> None:
    response = gateway.client.get(
        "/inference/videos",
        params={
            "source_id": SOURCE,
            "path": "day01/sub",
            "project_id": str(gateway.project.id),
        },
    )
    assert response.status_code == 200
    assert dict(gateway.requests[-1].url.params) == {
        "path": "day01/sub",
        "source_id": SOURCE,
    }
    assert gateway.requests[-1].url.path == "/v1/videos"
    gateway.client.get("/inference/tasks?path=should-not-forward")
    assert "path" not in gateway.requests[-1].url.params


def test_authorized_root_directory_defaults_to_empty_path(
    gateway: Harness, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(
        "INFERENCE_EXPERIMENT_DIRECTORIES", json.dumps({SOURCE: {EXPERIMENT: ""}})
    )
    gateway.project.video_directory = ""
    db.add(gateway.project)
    db.commit()
    response = gateway.client.get(
        "/inference/videos",
        params={"source_id": SOURCE, "project_id": str(gateway.project.id)},
    )
    assert response.status_code == 200
    assert gateway.requests[-1].url.params["path"] == ""


@pytest.mark.parametrize(
    ("path", "status"),
    [
        ("", 403),
        ("day02", 403),
        ("../day01", 422),
        ("/day01", 422),
        ("day01/../day02", 422),
    ],
)
def test_directory_cannot_escape_authorized_experiment(
    gateway: Harness, path: str, status: int
) -> None:
    response = gateway.client.get(
        "/inference/videos",
        params={
            "source_id": SOURCE,
            "path": path,
            "project_id": str(gateway.project.id),
        },
    )
    assert response.status_code == status
    assert gateway.requests == []


def test_directory_requires_owned_project(gateway: Harness) -> None:
    params = {"source_id": SOURCE, "path": "day01"}
    assert gateway.client.get("/inference/videos", params=params).status_code == 422
    assert (
        gateway.client.get(
            "/inference/videos", params={**params, "project_id": str(uuid.uuid4())}
        ).status_code
        == 404
    )
    assert gateway.requests == []


def test_client_accept_forwarded_verbatim(gateway: Harness) -> None:
    gateway.state.response = httpx.Response(200, content=b"video")
    assert (
        gateway.client.get(ARTIFACT, headers={"Accept": "text/csv"}).status_code == 200
    )
    assert gateway.requests[-1].headers["accept"] == "text/csv"


def test_video_sources_and_source_query_are_forwarded(gateway: Harness) -> None:
    sources = gateway.client.get("/inference/sources")
    assert sources.status_code == 200
    assert gateway.requests[-1].url.path == "/v1/sources"
    assert [source["id"] for source in sources.json()] == [
        SOURCE,
        f"upload-{gateway.user.id.hex}",
    ]
    response = gateway.client.get(
        "/inference/videos",
        params={
            "source_id": SOURCE,
            "path": "day01",
            "project_id": str(gateway.project.id),
            "url": "http://evil.test",
            "token": "leak",
        },
    )
    assert response.status_code == 200
    assert dict(gateway.requests[-1].url.params) == {
        "path": "day01",
        "source_id": SOURCE,
    }
    gateway.client.get(f"/inference/tasks?source_id={SOURCE}")
    assert "source_id" not in gateway.requests[-1].url.params
    gateway.state.user = gateway.other_user
    request_count = len(gateway.requests)
    sources = gateway.client.get("/inference/sources")
    assert sources.status_code == 200
    assert [source["id"] for source in sources.json()] == [
        f"upload-{gateway.other_user.id.hex}"
    ]
    assert len(gateway.requests) == request_count
