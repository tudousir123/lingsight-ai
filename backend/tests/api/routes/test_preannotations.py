"""Persisted confirmation behavior through authenticated project-video HTTP."""

import base64
import copy
import json
import subprocess
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.exc import OperationalError
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from tests.api.routes.test_platform_user_flow import SyntheticInference, signup


@pytest.fixture
def flow(client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    media = tmp_path / "media"
    media.mkdir()
    monkeypatch.setenv("PLATFORM_MEDIA_ROOT", str(media))
    monkeypatch.setenv("PLATFORM_MEDIA_INFERENCE_SOURCE_ID", "platform-media")
    monkeypatch.setenv("PLATFORM_MEDIA_READONLY_READY", "true")
    monkeypatch.setattr(settings, "INFERENCE_BASE_URL", "http://inference.test")
    monkeypatch.setattr(settings, "INFERENCE_API_TOKEN", "synthetic")
    clip = tmp_path / "clip.mp4"
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
            str(clip),
        ],
        check=True,
    )
    owner, _ = signup(client)
    other, _ = signup(client)
    project = client.post(
        "/api/v1/projects/", headers=owner, json={"name": "confirmation"}
    ).json()
    project_url = f"/api/v1/projects/{project['id']}"
    upload = client.post(
        project_url + "/videos",
        headers={**owner, "Idempotency-Key": str(uuid.uuid4())},
        files={"file": ("clip.mp4", clip.read_bytes(), "video/mp4")},
    )
    assert upload.status_code == 201, upload.text
    video = upload.json()
    upstream = SyntheticInference(media)
    state = SimpleNamespace(
        confirm_error=None, reject=False, change_on_dispatch=False, reads=0
    )

    def handle(request):
        if request.url.path.endswith("/confirm"):
            if state.reject:
                return httpx.Response(422)
            if state.confirm_error == "before":
                upstream.confirm_calls += 1
                raise httpx.ReadTimeout("ambiguous")
            result = upstream.handle(request)
            if state.confirm_error == "after":
                raise httpx.ReadTimeout("accepted but response lost")
            return result
        if "/tasks/" in request.url.path and request.method == "GET":
            state.reads += 1
            if state.change_on_dispatch and state.reads >= 2:
                task = next(iter(upstream.tasks.values()))
                if state.change_on_dispatch == "hash":
                    task["candidate"]["video_sha256"] = "f" * 64
                else:
                    task["candidate"]["seed"]["x"] = 321
        return upstream.handle(request)

    original = httpx.Client
    with patch(
        "httpx.Client",
        side_effect=lambda **kw: original(transport=httpx.MockTransport(handle), **kw),
    ):
        create_payload = {"project_id": project["id"], "video_id": video["video_id"]}
        task_response = client.post(
            "/api/v1/inference/tasks",
            headers={**owner, "Idempotency-Key": str(uuid.uuid4())},
            json=create_payload,
        )
        assert task_response.status_code == 202, task_response.text
        task = task_response.json()
        video_url = project_url + "/videos/" + video["video_id"]
        candidate = client.get(
            video_url + "/preannotation", params={"task_id": task["id"]}, headers=owner
        )
        assert candidate.status_code == 200, candidate.text
        payload = {
            "task_id": task["id"],
            "candidate_version": candidate.json()["candidate_version"],
            "expected_confirmation_id": None,
            "seed": {"frame": 2, "x": 320, "y": 240},
            "pool": {"cx": 320, "cy": 240, "radius": 200},
            "marks": [
                {"label": "north", "polygon": [[1, 1], [15, 1], [15, 15], [1, 15]]}
            ],
        }
        state.reads = 0
        yield SimpleNamespace(
            http_client=original,
            client=client,
            owner=owner,
            other=other,
            url=video_url,
            payload=payload,
            upstream=upstream,
            state=state,
            task=task,
            create_payload=create_payload,
        )


def submit(flow, payload=None, key=None):
    return flow.client.post(
        flow.url + "/preannotation-confirmations",
        headers={**flow.owner, "Idempotency-Key": key or str(uuid.uuid4())},
        json=payload or flow.payload,
    )


@pytest.mark.parametrize(
    "change",
    [
        {"seed": {"frame": 6, "x": 320, "y": 240}},
        {"seed": {"frame": 1.5, "x": 320, "y": 240}},
        {"seed": {"frame": True, "x": 320, "y": 240}},
        {"seed": {"frame": 2, "x": 639, "y": 479}},
        {"pool": {"cx": 100, "cy": 240, "radius": 200}},
        {"pool": {"cx": 320, "cy": 240, "radius": 0}},
        {"marks": [{"label": "bow", "polygon": [[1, 1], [15, 15], [1, 15], [15, 1]]}]},
        {"marks": [{"label": "line", "polygon": [[1, 1], [2, 2], [3, 3]]}]},
        {"marks": [{"label": "boolean", "polygon": [[True, 1], [15, 1], [15, 15]]}]},
        {"marks": [{"label": "string", "polygon": [["1", 1], [15, 1], [15, 15]]}]},
        {"marks": [{"label": "out", "polygon": [[-1, 1], [15, 1], [15, 15]]}]},
        {"marks": [{"label": " ", "polygon": [[1, 1], [15, 1], [15, 15]]}]},
        {"marks": [{"label": "same", "polygon": [[1, 1], [15, 1], [15, 15]]}] * 2},
        {"marks": [{"label": "x" * 101, "polygon": [[1, 1], [15, 1], [15, 15]]}]},
    ],
)
def test_invalid_geometry_never_dispatches(flow, change):
    response = submit(flow, {**flow.payload, **change})
    assert response.status_code == 422, response.text
    assert flow.upstream.confirm_calls == 0
    assert (
        flow.client.get(
            flow.url + "/preannotation-confirmation", headers=flow.owner
        ).status_code
        == 404
    )


def test_geometry_roundtrip_deleted_marks_and_immutable_replay(flow):
    payload = {**flow.payload, "marks": []}
    key = str(uuid.uuid4())
    first = submit(flow, payload, key)
    assert first.status_code == 201, first.text
    assert first.json()["marks"] == []
    assert first.json()["seed"] == payload["seed"]
    assert first.json()["pool"] == payload["pool"]
    assert first.json()["confirmed_at"].endswith(("Z", "+00:00"))
    assert submit(flow, payload, key).status_code == 200
    assert (
        submit(
            flow, {**payload, "seed": {"frame": 2, "x": 321, "y": 240}}, key
        ).status_code
        == 409
    )
    assert (
        submit(
            flow, {**payload, "expected_confirmation_id": first.json()["id"]}
        ).status_code
        == 409
    )
    read = flow.client.get(
        flow.url + "/preannotation-confirmation",
        params={"confirmation_id": first.json()["id"]},
        headers=flow.owner,
    )
    assert read.json() == first.json()
    assert (
        flow.client.get(
            flow.url + "/preannotation-confirmation", headers=flow.other
        ).status_code
        == 404
    )
    assert flow.upstream.confirm_calls == 1


@pytest.mark.parametrize("when,status", [("after", "accepted"), ("before", "pending")])
def test_timeout_readback_never_dispatches_twice(flow, when, status):
    flow.state.confirm_error = when
    key = str(uuid.uuid4())
    response = submit(flow, key=key)
    assert response.status_code == 201, response.text
    assert response.json()["tracking_dispatch"]["status"] == status
    assert submit(flow, key=key).json()["tracking_dispatch"]["status"] == status
    assert flow.upstream.confirm_calls == 1


def test_explicit_rejection_can_retry_same_immutable_version(flow):
    flow.state.reject = True
    key = str(uuid.uuid4())
    first = submit(flow, key=key)
    assert first.status_code == 201, first.text
    assert first.json()["tracking_dispatch"]["status"] == "failed"
    flow.state.reject = False
    replay = submit(flow, key=key)
    assert replay.status_code == 200
    assert replay.json()["id"] == first.json()["id"]
    assert replay.json()["tracking_dispatch"]["status"] == "accepted"


def test_candidate_change_between_save_and_dispatch_is_not_consumed(flow):
    flow.state.change_on_dispatch = True
    response = submit(flow)
    assert response.status_code == 201, response.text
    assert response.json()["tracking_dispatch"] == {
        "status": "failed",
        "error_code": "stale_version",
    }
    assert flow.upstream.confirm_calls == 0


def test_concurrent_confirmation_replay_has_one_dispatch(flow):
    key = str(uuid.uuid4())
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: submit(flow, key=key), range(2)))
    assert sorted(r.status_code for r in responses) == [200, 201]
    assert responses[0].json()["id"] == responses[1].json()["id"]
    assert flow.upstream.confirm_calls == 1


def test_database_failure_does_not_start_tracking(flow):
    def fail_insert(_conn, _cursor, statement, _parameters, _context, _executemany):
        if statement.startswith("INSERT INTO preannotation_confirmation"):
            raise OperationalError(statement, {}, Exception("synthetic disk failure"))

    event.listen(engine, "before_cursor_execute", fail_insert)
    try:
        response = submit(flow)
    finally:
        event.remove(engine, "before_cursor_execute", fail_insert)
    assert response.status_code == 503
    assert flow.upstream.confirm_calls == 0
    assert (
        flow.client.get(
            flow.url + "/preannotation-confirmation", headers=flow.owner
        ).status_code
        == 404
    )


def test_stale_candidate_and_cross_video_are_rejected(flow):
    assert (
        submit(flow, {**flow.payload, "candidate_version": "f" * 64}).status_code == 409
    )
    response = flow.client.post(
        flow.url.replace("/videos/", "/videos/wrong-") + "/preannotation-confirmations",
        headers={**flow.owner, "Idempotency-Key": str(uuid.uuid4())},
        json=flow.payload,
    )
    assert response.status_code == 404
    assert flow.upstream.confirm_calls == 0


def test_oversized_and_nonfinite_geometry_rejected(flow):
    response = flow.client.post(
        flow.url + "/preannotation-confirmations",
        headers=flow.owner,
        content=b" " * 512001,
    )
    assert response.status_code == 413
    payload = copy.deepcopy(flow.payload)
    payload["seed"]["x"] = float("nan")
    response = flow.client.post(
        flow.url + "/preannotation-confirmations",
        headers={**flow.owner, "Idempotency-Key": str(uuid.uuid4())},
        content=json.dumps(payload),
    )
    assert response.status_code == 422
    assert flow.upstream.confirm_calls == 0


def test_candidate_metadata_must_match_uploaded_input(flow):
    flow.upstream.tasks[flow.task["id"]]["candidate"]["width"] = 600
    response = flow.client.get(
        flow.url + "/preannotation",
        params={"task_id": flow.task["id"]},
        headers=flow.owner,
    )
    assert response.status_code == 409


def test_ambiguous_create_is_durable_across_retry_and_concurrent_calls(flow):
    original = flow.upstream.handle
    key = str(uuid.uuid4())
    creates = []

    def timeout(request):
        if request.url.path == "/v1/tasks" and request.method == "POST":
            creates.append(request)
            original(request)
            raise httpx.ReadTimeout("created but lost response")
        return original(request)

    # Current patched constructor is avoided: create the transport factory from
    # the upstream fixture's original httpx class via the module class object.
    with patch(
        "httpx.Client",
        side_effect=lambda **kw: flow.http_client(
            transport=httpx.MockTransport(timeout), **kw
        ),
    ):

        def create():
            return flow.client.post(
                "/api/v1/inference/tasks",
                headers={**flow.owner, "Idempotency-Key": key},
                json=flow.create_payload,
            )

        assert create().status_code == 503
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lambda _: create(), range(2)))
        assert [r.status_code for r in responses] == [503, 503]
    assert len(creates) == 1


def test_replaced_failed_confirmation_cannot_be_redispatched(flow):
    flow.state.reject = True
    old_key = str(uuid.uuid4())
    first = submit(flow, key=old_key)
    assert first.status_code == 201
    replacement = {
        **flow.payload,
        "expected_confirmation_id": first.json()["id"],
        "marks": [],
    }
    new_key = str(uuid.uuid4())
    second = submit(flow, replacement, new_key)
    assert second.status_code == 201, second.text
    flow.state.reject = False
    old_replay = submit(flow, key=old_key)
    assert old_replay.status_code == 200
    assert old_replay.json()["tracking_dispatch"]["status"] == "failed"
    assert flow.upstream.confirm_calls == 0
    assert (
        submit(flow, replacement, new_key).json()["tracking_dispatch"]["status"]
        == "accepted"
    )
    latest = flow.client.get(
        flow.url + "/preannotation-confirmation", headers=flow.owner
    )
    assert latest.json()["id"] == second.json()["id"]


def test_concurrent_distinct_versions_respect_expected_confirmation(flow):
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: submit(flow), range(2)))
    assert sorted(r.status_code for r in responses) == [201, 409]
    assert flow.upstream.confirm_calls == 1


def test_input_hash_change_after_save_returns_persisted_failure(flow):
    flow.state.change_on_dispatch = "hash"
    response = submit(flow)
    assert response.status_code == 201, response.text
    assert response.json()["tracking_dispatch"] == {
        "status": "failed",
        "error_code": "stale_version",
    }
    assert (
        flow.client.get(
            flow.url + "/preannotation-confirmation", headers=flow.owner
        ).json()["id"]
        == response.json()["id"]
    )
    assert flow.upstream.confirm_calls == 0


def test_rejected_replay_overlaps_replacement_without_consuming_old_geometry(flow):
    flow.state.reject = True
    old_key = str(uuid.uuid4())
    first = submit(flow, key=old_key)
    assert first.status_code == 201
    replacement = {
        **flow.payload,
        "expected_confirmation_id": first.json()["id"],
        "marks": [],
    }
    flow.state.reject = False
    committed = [threading.Event(), threading.Event()]
    resume = [threading.Event(), threading.Event()]
    counter_lock = threading.Lock()
    count = 0

    def pause_committed_requests(_session):
        nonlocal count
        with counter_lock:
            index = count
            count += 1
        if index < 2:
            committed[index].set()
            assert resume[index].wait(20), "overlapping request did not resume"

    # Pause at the database boundary after durable commits have released locks.
    # Both operations enter through HTTP, with no replacement of application code.
    event.listen(Session, "after_commit", pause_committed_requests)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            replay_future = pool.submit(submit, flow, None, old_key)
            try:
                assert committed[0].wait(20)
                replacement_future = pool.submit(submit, flow, replacement)
                assert committed[1].wait(20)
                resume[0].set()
                replay = replay_future.result(timeout=20)
            finally:
                for signal in resume:
                    signal.set()
            replaced = replacement_future.result(timeout=20)
    finally:
        event.remove(Session, "after_commit", pause_committed_requests)
    assert replay.status_code == 200, replay.text
    assert replay.json()["tracking_dispatch"]["status"] == "failed"
    assert replaced.status_code == 201, replaced.text
    assert replaced.json()["tracking_dispatch"]["status"] == "accepted"
    assert flow.upstream.confirm_calls == 1
    assert flow.upstream.tasks[flow.task["id"]]["confirmed"]["marks"] == []
    latest = flow.client.get(
        flow.url + "/preannotation-confirmation", headers=flow.owner
    )
    assert latest.json()["id"] == replaced.json()["id"]


def test_candidate_image_url_uses_configured_api_prefix(flow, monkeypatch):
    from fastapi import FastAPI

    from app.api.main import api_router

    monkeypatch.setattr(settings, "API_V1_STR", "/research/v2")
    configured = FastAPI()
    configured.include_router(api_router, prefix=settings.API_V1_STR)
    with TestClient(configured) as client:
        response = client.get(
            flow.url.replace("/api/v1", "/research/v2") + "/preannotation",
            params={"task_id": flow.task["id"]},
            headers=flow.owner,
        )
        assert response.status_code == 200, response.text
        assert response.json()["image_url"] == (
            f"/research/v2/inference/tasks/{flow.task['id']}/artifacts/candidate.jpg"
        )
        async_client = httpx.AsyncClient
        with patch(
            "httpx.AsyncClient",
            side_effect=lambda **kw: async_client(
                transport=httpx.MockTransport(flow.upstream.handle), **kw
            ),
        ):
            image = client.get(response.json()["image_url"], headers=flow.owner)
        assert image.status_code == 200
        assert image.content == b"synthetic-candidate"


def test_unicode_media_source_uses_listed_identifier_for_task_input(flow, monkeypatch):
    monkeypatch.setenv("PLATFORM_MEDIA_INFERENCE_SOURCE_ID", "平台媒体")
    listed_ids = set()

    def upstream(request):
        result = flow.upstream.handle(request)
        if request.url.path == "/v1/videos":
            listing = result.json()
            for item in listing["items"]:
                encoded = item["id"][3:]
                value = json.loads(
                    base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
                )
                assert value["s"] == "平台媒体"
                item["id"] = "v1." + base64.urlsafe_b64encode(
                    json.dumps(
                        value, ensure_ascii=False, separators=(",", ":")
                    ).encode()
                ).decode().rstrip("=")
                listed_ids.add(item["id"])
            return httpx.Response(200, json=listing)
        if request.url.path == "/v1/tasks" and request.method == "POST":
            assert json.loads(request.content)["video_id"] in listed_ids
        return result

    with patch(
        "httpx.Client",
        side_effect=lambda **kw: flow.http_client(
            transport=httpx.MockTransport(upstream), **kw
        ),
    ):
        response = flow.client.post(
            "/api/v1/inference/tasks",
            headers={**flow.owner, "Idempotency-Key": str(uuid.uuid4())},
            json=flow.create_payload,
        )
    assert response.status_code == 202, response.text
    assert response.json()["video_id"] == flow.create_payload["video_id"]
