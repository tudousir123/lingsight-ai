"""Synthetic user HTTP flow: uploaded video through publication and authorization."""

import base64
import hashlib
import json
import subprocess
import uuid
from pathlib import Path
from typing import Any
from unittest.mock import patch

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from tests.api.routes.test_publish import OVERLAY_BYTES, default_artifacts

API = "/api/v1"


def signup(client: TestClient) -> tuple[dict[str, str], str]:
    email = f"flow-{uuid.uuid4().hex}@example.com"
    response = client.post(
        f"{API}/users/signup", json={"email": email, "password": "synthetic-flow-123"}
    )
    assert response.status_code == 200, response.text
    login = client.post(
        f"{API}/login/access-token",
        data={"username": email, "password": "synthetic-flow-123"},
    )
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['access_token']}"}, response.json()[
        "id"
    ]


class SyntheticInference:
    """An HTTP upstream double owning task state and serving generated media."""

    def __init__(self, media: Path):
        self.media = media
        self.tasks: dict[str, dict[str, Any]] = {}
        self.create_calls = 0
        self.confirm_calls = 0

    def handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path.removeprefix("/v1/")
        if path == "videos":
            directory = request.url.params.get("path", "")
            source = request.url.params["source_id"]
            items = []
            for file in (self.media / directory).glob("*.mp4"):
                relative = file.relative_to(self.media).as_posix()
                encoded = (
                    base64.urlsafe_b64encode(
                        json.dumps(
                            {"s": source, "p": relative}, separators=(",", ":")
                        ).encode()
                    )
                    .decode()
                    .rstrip("=")
                )
                items.append(
                    {"type": "video", "id": "v1." + encoded, "name": file.name}
                )
            return httpx.Response(
                200, json={"source_id": source, "path": directory, "items": items}
            )
        if path == "tasks" and request.method == "POST":
            self.create_calls += 1
            video_id = json.loads(request.content)["video_id"]
            encoded = video_id[3:]
            relative = json.loads(
                base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
            )["p"]
            task_id = str(uuid.uuid4())
            task = {
                "id": task_id,
                "video_id": video_id,
                "status": "waiting_for_review",
                "stage": "first_frame",
                "error": None,
                "review": None,
                "confirmed": None,
                "candidate": {
                    "video_sha256": hashlib.sha256(
                        (self.media / relative).read_bytes()
                    ).hexdigest(),
                    "width": 640,
                    "height": 480,
                    "frame_count": 6,
                    "fps": 6.0,
                    "candidate_frame": 2,
                    "seed": {"frame": 2, "x": 320, "y": 240},
                    "pool": {"cx": 320, "cy": 240, "radius": 200},
                    "marks": [],
                    "review_reasons": [],
                },
            }
            self.tasks[task_id] = task
            return httpx.Response(202, json=task)
        parts = path.split("/")
        if len(parts) < 2 or parts[0] != "tasks" or parts[1] not in self.tasks:
            return httpx.Response(404)
        task = self.tasks[parts[1]]
        if len(parts) == 2:
            return httpx.Response(200, json=task)
        if parts[2] == "confirm":
            self.confirm_calls += 1
            task["confirmed"] = json.loads(request.content)
            task["status"] = "queued"
            task["stage"] = "tracking"
            return httpx.Response(200, json=task)
        if parts[2] == "review":
            task["review"] = json.loads(request.content)
            return httpx.Response(200, json=task)
        if parts[2] == "artifacts":
            name = parts[3]
            if name == "overlay.mp4":
                return httpx.Response(200, content=OVERLAY_BYTES)
            if name == "candidate.jpg":
                return httpx.Response(200, content=b"synthetic-candidate")
            artifacts = default_artifacts()
            artifacts["provenance.json"]["video_sha256"] = task["candidate"][
                "video_sha256"
            ]
            artifacts["provenance.json"]["confirmed"] = task["confirmed"]
            return httpx.Response(200, json=artifacts[name])
        return httpx.Response(404)


def test_private_uploaded_video_to_published_project(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "platform-media"
    root.mkdir()
    monkeypatch.setenv("PLATFORM_MEDIA_ROOT", str(root))
    monkeypatch.setenv("PLATFORM_MEDIA_INFERENCE_SOURCE_ID", "platform-media")
    monkeypatch.setenv("PLATFORM_MEDIA_READONLY_READY", "true")
    monkeypatch.setattr(
        settings, "INFERENCE_BASE_URL", "http://synthetic-inference.test"
    )
    monkeypatch.setattr(settings, "INFERENCE_API_TOKEN", "synthetic-service-token")
    video_file = tmp_path / "generated.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=640x480:rate=6:duration=1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(video_file),
        ],
        check=True,
    )
    original = video_file.read_bytes()
    owner, owner_id = signup(client)
    other, _ = signup(client)
    workspace = client.get(f"{API}/users/me/workspace", headers=owner)
    assert workspace.status_code == 200
    assert workspace.json()["whole_library_access"] is False
    assert workspace.json()["allowed_experiment_ids"] == []
    project = client.post(
        f"{API}/projects/", headers=owner, json={"name": "Synthetic flow"}
    ).json()
    project_url = f"{API}/projects/{project['id']}"
    uploaded = client.post(
        project_url + "/videos",
        headers={**owner, "Idempotency-Key": str(uuid.uuid4())},
        files={"file": ("same-name.mp4", original, "video/mp4")},
    )
    assert uploaded.status_code == 201, uploaded.text
    video = uploaded.json()
    assert video["sha256"] == hashlib.sha256(original).hexdigest()
    assert (
        client.get(
            video["media_url"], headers={**other, "Range": "bytes=0-5"}
        ).status_code
        == 404
    )
    assert client.get(project_url + "/videos", headers=other).status_code == 404
    upstream = SyntheticInference(root)
    sync_client, async_client = httpx.Client, httpx.AsyncClient
    with (
        patch(
            "httpx.Client",
            side_effect=lambda **kw: sync_client(
                transport=httpx.MockTransport(upstream.handle), **kw
            ),
        ),
        patch(
            "httpx.AsyncClient",
            side_effect=lambda **kw: async_client(
                transport=httpx.MockTransport(upstream.handle), **kw
            ),
        ),
    ):
        key = str(uuid.uuid4())
        request = {"project_id": project["id"], "video_id": video["video_id"]}
        created = client.post(
            f"{API}/inference/tasks",
            headers={**owner, "Idempotency-Key": key},
            json=request,
        )
        assert created.status_code == 202, created.text
        task = created.json()
        assert task["video_id"] == video["video_id"]
        replay = client.post(
            f"{API}/inference/tasks",
            headers={**owner, "Idempotency-Key": key},
            json=request,
        )
        assert replay.json()["id"] == task["id"]
        assert upstream.create_calls == 1
        task_url = f"{API}/inference/tasks/{task['id']}"
        assert client.get(f"{API}/inference/tasks", headers=other).json() == []
        assert client.get(task_url, headers=other).status_code == 404
        assert (
            client.get(task_url + "/artifacts/candidate.jpg", headers=other).status_code
            == 404
        )
        video_url = project_url + f"/videos/{video['video_id']}"
        candidate = client.get(
            video_url + "/preannotation", params={"task_id": task["id"]}, headers=owner
        )
        assert candidate.status_code == 200, candidate.text
        assert candidate.json()["frame_index"] == 2
        confirmation_payload = {
            "task_id": task["id"],
            "candidate_version": candidate.json()["candidate_version"],
            "expected_confirmation_id": None,
            "seed": {"frame": 2, "x": 320, "y": 240},
            "pool": {"cx": 320, "cy": 240, "radius": 200},
            "marks": [],
        }
        confirmation_key = str(uuid.uuid4())
        confirmed = client.post(
            video_url + "/preannotation-confirmations",
            headers={**owner, "Idempotency-Key": confirmation_key},
            json=confirmation_payload,
        )
        assert confirmed.status_code == 201, confirmed.text
        confirmation = confirmed.json()
        assert confirmation["tracking_dispatch"]["status"] == "accepted"
        assert confirmation["confirmed_by"] == owner_id
        assert (
            client.get(video_url + "/preannotation-confirmation", headers=owner).json()[
                "id"
            ]
            == confirmation["id"]
        )
        assert (
            client.post(
                video_url + "/preannotation-confirmations",
                headers={**owner, "Idempotency-Key": confirmation_key},
                json=confirmation_payload,
            ).status_code
            == 200
        )
        assert upstream.confirm_calls == 1
        upstream.tasks[task["id"]]["status"] = "succeeded"
        denied = client.post(
            project_url + "/results", headers=owner, json={"task_id": task["id"]}
        )
        assert denied.status_code == 409
        reviewed = client.post(
            task_url + "/review",
            headers=owner,
            json={"tracking_ok": True, "note": "Synthetic review"},
        )
        assert reviewed.status_code == 200, reviewed.text
        published = client.post(
            project_url + "/results", headers=owner, json={"task_id": task["id"]}
        )
        assert published.status_code == 201, published.text
        result = published.json()
        assert result["confirmation_id"] == confirmation["id"]
        assert result["original_video_sha256"] == video["sha256"]
        assert result["source_kind"] == "user_upload"
        assert client.get(project_url + "/results", headers=other).status_code == 404
        assert (
            client.get(
                project_url + f"/results/{task['id']}/frames", headers=other
            ).status_code
            == 404
        )
        other_project = client.post(
            f"{API}/projects/", headers=other, json={"name": "Other project"}
        ).json()
        other_project_url = f"{API}/projects/{other_project['id']}"
        assert (
            client.post(
                other_project_url + "/members",
                headers=other,
                json={"kind": "video", "id": video["video_id"]},
            ).status_code
            == 404
        )
        assert (
            client.post(
                other_project_url + "/results",
                headers=other,
                json={"task_id": task["id"]},
            ).status_code
            == 404
        )
        monkeypatch.setattr(settings, "AGENT_AUTHORIZATION_TOKEN", "synthetic-callback")
        authorization = client.post(
            f"{API}/internal/agent/authorize",
            headers={"Authorization": "Bearer synthetic-callback"},
            json={
                "user_id": owner_id,
                "data_scope": "project",
                "project_id": project["id"],
            },
        )
        assert authorization.status_code == 200, authorization.text
        assert authorization.json()["allowed_publication_task_ids"] == [task["id"]]
        assert client.post(
            f"{API}/internal/agent/authorize",
            headers=owner,
            json={
                "user_id": owner_id,
                "data_scope": "project",
                "project_id": project["id"],
            },
        ).status_code in (401, 403)
