"""Publish pipeline (#43): gate, consistency, whole-version write, idempotency.

The inference upstream is a fake served through httpx.MockTransport (the
gateway contract-test precedent): one task plus its tracking/keypoints/
provenance artifacts and an overlay stream. No real service, no GPU, no
L3 — but the real database, the real route stack and the real writer.
Each test gets its own task id so published rows never leak across tests.
"""

import base64
import hashlib
import json
import os
import re
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass, field
from threading import Barrier
from typing import Any
from unittest.mock import patch

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlmodel import Session, delete, select

from app import publishing
from app.core.config import settings
from app.core.db import engine
from app.inference_models import InferenceBinding, PreannotationConfirmation
from app.models import ExperimentAccess, Project, PublishedFrame, PublishedResult
from app.preannotations import fingerprint
from app.publishing import HEADING_ALGORITHM, KEYPOINT_PROTOCOL, PRIMARY_RADIUS_PX
from tests.utils.user import (
    authentication_token_from_email,
    create_random_user,
)

TRACK_HASH = "b" * 64
V9_HASH = "c" * 64
FIRST_HASH = "d" * 64
MARK_HASH = "e" * 64
VIDEO_SHA = "a" * 64
OVERLAY_BYTES = b"\x00\x01overlay-video-bytes"

ARTIFACT_NAMES = ("tracking.json", "keypoints.json", "provenance.json")

_TASK_PATH = re.compile(r"^/v1/tasks/(?P<task_id>[^/]+)(?:/artifacts/(?P<name>.+))?$")


def _rle() -> dict[str, Any]:
    # 2x2 column-major COCO RLE: one pixel on.
    return {"size": [2, 2], "counts": [1, 2, 1]}


def _tracking_frame(idx: int, valid: bool) -> dict[str, Any]:
    return {
        "frame": idx,
        "valid": valid,
        "center": [101.5, 202.25] if valid else None,
        "head": None,
        "tail": None,
        "contour_area": 320.5 if valid else None,
        "mask_rle": _rle() if valid else None,
        "reloc": False,
    }


def _kp_frame(
    idx: int,
    *,
    heading_status: str,
    heading: float | None,
    proposal: bool | None,
    correction: str = "",
    head: list[float] | None = None,
    tail: list[float] | None = None,
) -> dict[str, Any]:
    return {
        "frame": idx,
        "status": "inferred" if heading_status != "missing_mask" else "no_mask",
        "head": head,
        "tail": tail,
        "center": [101.5, 202.25] if heading_status != "missing_mask" else None,
        "heading_angle_deg": heading,
        "is_proposal": proposal,
        "heading_status": heading_status,
        "keypoint_correction": correction,
    }


def default_artifacts() -> dict[str, dict[str, Any]]:
    """Six frames: ok, missing_mask, ok(swapped), ok_proposal, ok, no_heading."""
    tracking = {
        "frames": [
            _tracking_frame(0, True),
            _tracking_frame(1, False),
            _tracking_frame(2, True),
            _tracking_frame(3, True),
            _tracking_frame(4, True),
            _tracking_frame(5, True),
        ],
        "summary": {"valid": 5},
        "mask_model": TRACK_HASH,
    }
    keypoints = {
        "frames": [
            _kp_frame(
                0,
                heading_status="ok",
                heading=10.25,
                proposal=False,
                head=[90.0, 80.0],
                tail=[110.0, 120.0],
            ),
            _kp_frame(1, heading_status="missing_mask", heading=None, proposal=None),
            _kp_frame(
                2,
                heading_status="ok",
                heading=187.5,
                proposal=False,
                correction="head_tail_swapped",
                head=[95.0, 85.0],
                tail=[115.0, 125.0],
            ),
            _kp_frame(3, heading_status="ok_proposal", heading=270.0, proposal=True),
            _kp_frame(
                4,
                heading_status="ok",
                heading=359.999999,
                proposal=False,
                head=[91.0, 81.0],
                tail=[111.0, 121.0],
            ),
            _kp_frame(5, heading_status="no_heading", heading=None, proposal=None),
        ],
        "model_sha256": V9_HASH,
        "protocol": KEYPOINT_PROTOCOL,
        "heading_algorithm": HEADING_ALGORITHM,
        "heading_parameters": {"primary_radius_px": PRIMARY_RADIUS_PX},
    }
    provenance = {
        "first_frame_sha256": FIRST_HASH,
        "mark_sha256": MARK_HASH,
        "tracking_sha256": TRACK_HASH,
        "v9_sha256": V9_HASH,
        "confirmed": {"seed": {"frame": 0, "x": 1, "y": 1}},
        "keypoint_protocol": KEYPOINT_PROTOCOL,
        "heading_algorithm": HEADING_ALGORITHM,
        "heading_summary": {
            "ok": 3,
            "ok_proposal": 1,
            "missing_mask": 1,
            "no_heading": 1,
        },
        "video_sha256": VIDEO_SHA,
        "database_written": False,
    }
    return {
        "tracking.json": tracking,
        "keypoints.json": keypoints,
        "provenance.json": provenance,
    }


_UNSET = object()


def default_task(review: dict[str, Any] | None | object = _UNSET) -> dict[str, Any]:
    if review is _UNSET:
        review = {"tracking_ok": True, "note": "看过叠加视频"}
    return {
        "id": "unused",
        "video_id": base64.urlsafe_b64encode(b"day01/maze-clip.mp4")
        .decode()
        .rstrip("="),
        "status": "succeeded",
        "stage": "overlay",
        "candidate": {
            "candidate_frame": 0,
            "width": 640,
            "height": 480,
            "frame_count": 6,
            "fps": 30.0,
            "video_sha256": VIDEO_SHA,
        },
        "confirmed": {"seed": {"frame": 0, "x": 1, "y": 1}},
        "error": None,
        "review": review,
    }


def fresh_task(**overrides: Any) -> tuple[str, dict[str, Any]]:
    """A default reviewed task with its own unique id."""
    task = default_task()
    task.update(overrides)
    task_id = str(uuid.uuid4())
    task["id"] = task_id
    return task_id, task


@dataclass
class FakeUpstream:
    task: dict[str, Any]
    artifacts: dict[str, dict[str, Any]]
    task_status: int = 200
    artifact_status: dict[str, int] = field(default_factory=dict)
    overlay_bytes: bytes = OVERLAY_BYTES
    transport_error: Exception | None = None
    task_body: bytes | None = None
    requests: list[httpx.Request] = field(default_factory=list)

    @property
    def task_id(self) -> str:
        return str(self.task["id"])

    def payload(self, name: str) -> bytes:
        return json.dumps(self.artifacts[name]).encode()


@contextmanager
def fake_inference(upstream: FakeUpstream, *, project_id: str | None = None):
    # Seed trusted historical binding/confirmation as fixture state. The HTTP
    # publish call must never infer this authority from a client project reference.
    if project_id is not None:
        with Session(engine) as setup:
            project = setup.get(Project, uuid.UUID(project_id))
            assert project is not None
            project.video_source_id = "legacy"
            project.video_directory = "day01"
            setup.add(project)
            grant = setup.exec(
                select(ExperimentAccess).where(
                    ExperimentAccess.user_id == project.user_id,
                    ExperimentAccess.experiment_id == "publish-fixture",
                )
            ).first()
            if grant is None:
                setup.add(
                    ExperimentAccess(
                        user_id=project.user_id, experiment_id="publish-fixture"
                    )
                )
            binding = setup.exec(
                select(InferenceBinding).where(
                    InferenceBinding.task_id == upstream.task_id
                )
            ).first()
            if binding is None:
                candidate = upstream.task["candidate"]
                binding = InferenceBinding(
                    owner_user_id=project.user_id,
                    project_id=project.id,
                    video_id=upstream.task["video_id"],
                    source_kind="filesystem",
                    source_id="legacy",
                    upstream_video_id=upstream.task["video_id"],
                    video_sha256=candidate["video_sha256"],
                    idempotency_key=uuid.uuid4(),
                    task_id=upstream.task_id,
                )
                setup.add(binding)
                setup.flush()
                confirmation = PreannotationConfirmation(
                    binding_id=binding.id,
                    owner_user_id=project.user_id,
                    idempotency_key=uuid.uuid4(),
                    request_sha256="0" * 64,
                    candidate_version=fingerprint(
                        {"task_id": upstream.task_id, "candidate": candidate}
                    ),
                    video_sha256=candidate["video_sha256"],
                    width=candidate["width"],
                    height=candidate["height"],
                    frame_count=candidate["frame_count"],
                    geometry=upstream.task["confirmed"],
                    dispatch_status="accepted",
                    dispatch_attempted=True,
                )
                binding.confirmation_id = confirmation.id
                setup.add(confirmation)
                setup.add(binding)
            setup.commit()

    def handler(request: httpx.Request) -> httpx.Response:
        upstream.requests.append(request)
        if upstream.transport_error is not None:
            raise upstream.transport_error
        match = _TASK_PATH.match(request.url.path)
        if match is None:
            return httpx.Response(404, json={"detail": "not found"})
        if match["task_id"] != upstream.task_id:
            return httpx.Response(404, json={"detail": "task 不存在"})
        name = match["name"]
        if name is None:
            if upstream.task_status != 200:
                return httpx.Response(upstream.task_status, json={"detail": "x"})
            if upstream.task_body is not None:
                return httpx.Response(200, content=upstream.task_body)
            return httpx.Response(200, json=upstream.task)
        if name == "overlay.mp4":
            status = upstream.artifact_status.get(name, 200)
            return httpx.Response(status, content=upstream.overlay_bytes)
        status = upstream.artifact_status.get(name, 200)
        return httpx.Response(status, content=upstream.payload(name))

    original = httpx.Client
    with (
        patch.dict(
            os.environ,
            {
                "INFERENCE_EXPERIMENT_DIRECTORIES": json.dumps(
                    {"legacy": {"publish-fixture": "day01"}}
                )
            },
        ),
        patch.object(settings, "INFERENCE_API_TOKEN", "private"),
        patch.object(settings, "INFERENCE_BASE_URL", "http://inference.test"),
        patch(
            "app.inference_client.httpx.Client",
            side_effect=lambda **kw: original(
                transport=httpx.MockTransport(handler), **kw
            ),
        ),
    ):
        yield upstream


@pytest.fixture
def workspace_headers(client: TestClient, db: Session) -> dict[str, str]:
    user = create_random_user(db)
    with (
        patch.object(settings, "AGENT_WORKSPACE_EMAIL", user.email),
        patch.dict(
            os.environ,
            {
                "INFERENCE_EXPERIMENT_DIRECTORIES": json.dumps(
                    {"legacy": {"publish-fixture": "day01"}}
                )
            },
        ),
    ):
        yield authentication_token_from_email(client=client, email=user.email, db=db)


def _create_project(client: TestClient, headers: dict[str, str]) -> str:
    response = client.post(
        f"{settings.API_V1_STR}/projects/",
        json={"name": f"发布-{uuid.uuid4().hex[:8]}"},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return str(response.json()["id"])


def _publish(
    client: TestClient, headers: dict[str, str], project_id: str, task_id: str
) -> httpx.Response:
    return client.post(
        f"{settings.API_V1_STR}/projects/{project_id}/results",
        json={"task_id": task_id},
        headers=headers,
    )


def _result_rows(db: Session, task_id: str) -> list[PublishedResult]:
    return list(
        db.exec(select(PublishedResult).where(PublishedResult.task_id == task_id)).all()
    )


def _frame_rows(db: Session, task_id: str) -> list[PublishedFrame]:
    return list(
        db.exec(
            select(PublishedFrame)
            .where(PublishedFrame.task_id == task_id)
            .order_by(PublishedFrame.frame_idx)
        ).all()
    )


def test_publish_requires_auth(client: TestClient) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/projects/{uuid.uuid4()}/results",
        json={"task_id": str(uuid.uuid4())},
    )
    assert response.status_code == 401


def test_publish_unknown_project_remains_hidden_for_new_workspace_user(
    client: TestClient, db: Session
) -> None:
    outsider = create_random_user(db)
    headers = authentication_token_from_email(
        client=client, email=outsider.email, db=db
    )
    task_id, task = fresh_task()
    with fake_inference(FakeUpstream(task, default_artifacts())):
        response = _publish(client, headers, uuid.uuid4().hex, task_id)
    assert response.status_code == 404


def test_publish_unknown_project_404(
    client: TestClient, workspace_headers: dict[str, str]
) -> None:
    task_id, task = fresh_task()
    with fake_inference(FakeUpstream(task, default_artifacts())):
        response = _publish(client, workspace_headers, str(uuid.uuid4()), task_id)
    assert response.status_code == 404
    assert response.json()["detail"] == "项目不存在"


@pytest.mark.parametrize(
    "task",
    [
        default_task(review=None),
        default_task(review={"tracking_ok": False, "note": "轨迹断了"}),
        default_task() | {"status": "running"},
    ],
    ids=["unreviewed", "tracking_not_ok", "not_succeeded"],
)
def test_publish_gate_rejects_without_passed_review(
    client: TestClient,
    workspace_headers: dict[str, str],
    db: Session,
    task: dict[str, Any],
) -> None:
    project_id = _create_project(client, workspace_headers)
    task_id = str(uuid.uuid4())
    task["id"] = task_id
    upstream = FakeUpstream(task, default_artifacts())
    with fake_inference(upstream, project_id=project_id):
        response = _publish(client, workspace_headers, project_id, task_id)
    assert response.status_code == 409
    assert response.json()["detail"] == publishing.GATE_DETAIL
    assert _result_rows(db, task_id) == []
    assert _frame_rows(db, task_id) == []
    # The gate runs before any artifact is pulled: only the task GET upstream.
    assert [request.url.path.rsplit("/", 1)[-1] for request in upstream.requests] == [
        task_id
    ]


def test_publish_task_not_found(
    client: TestClient, workspace_headers: dict[str, str], db: Session
) -> None:
    project_id = _create_project(client, workspace_headers)
    task_id, task = fresh_task()
    upstream = FakeUpstream(task, default_artifacts())
    upstream.task_status = 404
    with fake_inference(upstream, project_id=project_id):
        response = _publish(client, workspace_headers, project_id, task_id)
    assert response.status_code == 404
    assert _result_rows(db, task_id) == []


def test_publish_unreachable_upstream(
    client: TestClient, workspace_headers: dict[str, str], db: Session
) -> None:
    project_id = _create_project(client, workspace_headers)
    task_id, task = fresh_task()
    upstream = FakeUpstream(task, default_artifacts())
    upstream.transport_error = httpx.ConnectError("refused")
    with fake_inference(upstream, project_id=project_id):
        response = _publish(client, workspace_headers, project_id, task_id)
    assert response.status_code == 503
    assert response.json()["detail"] == "暂时无法连接视频推理服务"
    assert _result_rows(db, task_id) == []


def test_publish_writes_v3_shaped_summary_and_frame_rows(
    client: TestClient, workspace_headers: dict[str, str], db: Session
) -> None:
    project_id = _create_project(client, workspace_headers)
    task_id, task = fresh_task()
    with fake_inference(FakeUpstream(task, default_artifacts()), project_id=project_id):
        response = _publish(client, workspace_headers, project_id, task_id)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["replayed"] is False
    assert body["task_id"] == task_id
    assert body["video_id"] == task["video_id"]
    assert body["fps"] == 30.0
    assert body["total_frames"] == 6
    assert body["valid_frames"] == 5
    assert body["frames_with_heading"] == 4
    assert body["proposal_frames"] == 1
    assert body["heading_algorithm"] == HEADING_ALGORITHM
    assert body["video_sha256"] == VIDEO_SHA
    assert body["review_note"] == "看过叠加视频"
    assert body["published_at"] is not None

    results = _result_rows(db, task_id)
    assert len(results) == 1
    result = results[0]
    assert result.content_fingerprint == body["content_fingerprint"]
    assert str(result.project_id) == project_id
    assert result.overlay_bytes == len(OVERLAY_BYTES)
    assert result.tracking_model_sha256 == TRACK_HASH
    assert result.v9_model_sha256 == V9_HASH
    assert (
        result.provenance_json_sha256
        == hashlib.sha256(
            json.dumps(default_artifacts()["provenance.json"]).encode()
        ).hexdigest()
    )

    frames = _frame_rows(db, task_id)
    assert [frame.frame_idx for frame in frames] == [0, 2, 3, 4]
    first = frames[0]
    assert first.mask_valid is True
    assert (first.centroid_x, first.centroid_y) == (101.5, 202.25)
    assert first.contour_area == 320.5
    assert first.mask_rle_counts == "[1,2,1]"
    assert (first.mask_width, first.mask_height) == (2, 2)
    assert first.rle_format == "coco_counts_column_major"
    assert (first.head_x, first.head_y) == (90.0, 80.0)
    assert (first.tail_x, first.tail_y) == (110.0, 120.0)
    assert first.heading_angle_deg == 10.25
    assert first.is_proposal is False
    assert first.keypoint_correction == ""
    assert frames[1].keypoint_correction == "head_tail_swapped"
    assert frames[2].is_proposal is True


def test_publish_preserves_v9_mask_pixel_centroid(
    client: TestClient, workspace_headers: dict[str, str], db: Session
) -> None:
    project_id = _create_project(client, workspace_headers)
    task_id, task = fresh_task()
    artifacts = default_artifacts()
    artifacts["tracking.json"]["frames"][0]["center"] = [100.12, 201.34]
    expected = [101.123456789, 202.987654321]
    artifacts["keypoints.json"]["frames"][0]["center"] = expected
    with fake_inference(FakeUpstream(task, artifacts), project_id=project_id):
        response = _publish(client, workspace_headers, project_id, task_id)
    assert response.status_code == 201, response.text
    frame = _frame_rows(db, task_id)[0]
    assert [frame.centroid_x, frame.centroid_y] == expected


def test_publish_replays_identical_version_without_rewriting(
    client: TestClient, workspace_headers: dict[str, str], db: Session
) -> None:
    project_id = _create_project(client, workspace_headers)
    task_id, task = fresh_task()
    upstream = FakeUpstream(task, default_artifacts())
    with fake_inference(upstream, project_id=project_id):
        first = _publish(client, workspace_headers, project_id, task_id)
        assert first.status_code == 201
        published_at = _result_rows(db, task_id)[0].published_at
        second = _publish(client, workspace_headers, project_id, task_id)
    assert second.status_code == 200
    assert second.json()["replayed"] is True
    assert second.json()["content_fingerprint"] == first.json()["content_fingerprint"]
    assert len(_result_rows(db, task_id)) == 1
    assert _result_rows(db, task_id)[0].published_at == published_at
    assert len(_frame_rows(db, task_id)) == 4


@pytest.mark.parametrize("same_project", [True, False])
def test_concurrent_publication_replays_or_refuses_the_winning_version(
    client: TestClient,
    workspace_headers: dict[str, str],
    db: Session,
    same_project: bool,
) -> None:
    project_id = _create_project(client, workspace_headers)
    second_project_id = (
        project_id if same_project else _create_project(client, workspace_headers)
    )
    task_id, task = fresh_task()
    ready = Barrier(2, timeout=15)
    writer = publishing._write_whole_version

    def simultaneous_write(*args: Any, **kwargs: Any) -> PublishedResult:
        if same_project:
            ready.wait()
        return writer(*args, **kwargs)

    with (
        fake_inference(FakeUpstream(task, default_artifacts()), project_id=project_id),
        patch.object(publishing, "_write_whole_version", simultaneous_write),
        ThreadPoolExecutor(max_workers=2) as workers,
    ):
        pending = [
            workers.submit(_publish, client, workspace_headers, project_id, task_id)
            for project_id in (project_id, second_project_id)
        ]
        responses = [future.result(timeout=30) for future in pending]
    expected_statuses = [200, 201] if same_project else [201, 409]
    assert (
        sorted(response.status_code for response in responses) == expected_statuses
    ), [response.text for response in responses]
    if same_project:
        assert sorted(response.json()["replayed"] for response in responses) == [
            False,
            True,
        ]
    else:
        conflict = next(
            response for response in responses if response.status_code == 409
        )
        assert conflict.json()["detail"]["message"] == publishing.CROSS_PROJECT_DETAIL
    assert len(_result_rows(db, task_id)) == 1
    assert len(_frame_rows(db, task_id)) == 4


@pytest.mark.parametrize(
    ("artifact", "path", "value"),
    [
        ("tracking.json", ("frames",), []),
        ("tracking.json", ("frames", 5, "frame"), 6),
        ("keypoints.json", ("frames", 0, "frame"), False),
        ("keypoints.json", ("frames", 0, "center"), None),
        ("keypoints.json", ("frames", 0, "center"), [1]),
        ("keypoints.json", ("frames", 0, "center"), [1, float("nan")]),
        ("keypoints.json", ("frames", 0, "center"), [True, 2]),
        ("keypoints.json", ("frames", 5, "heading_status"), "unknown"),
        ("keypoints.json", ("frames", 0, "heading_angle_deg"), -1),
        ("keypoints.json", ("frames", 0, "heading_angle_deg"), float("nan")),
        ("keypoints.json", ("frames", 0, "is_proposal"), True),
        ("keypoints.json", ("frames", 0, "keypoint_correction"), "invented"),
        ("keypoints.json", ("heading_parameters", "primary_radius_px"), 4),
        ("provenance.json", ("first_frame_sha256",), "z" * 64),
        ("provenance.json", ("confirmed", "seed", "x"), 100),
    ],
)
def test_publish_refuses_malformed_scientific_contract(
    client: TestClient,
    workspace_headers: dict[str, str],
    db: Session,
    artifact: str,
    path: tuple[str | int, ...],
    value: Any,
) -> None:
    project_id = _create_project(client, workspace_headers)
    task_id, task = fresh_task()
    artifacts = default_artifacts()
    parent: Any = artifacts[artifact]
    for key in path[:-1]:
        parent = parent[key]
    parent[path[-1]] = value
    with fake_inference(FakeUpstream(task, artifacts), project_id=project_id):
        response = _publish(client, workspace_headers, project_id, task_id)
    assert response.status_code == 422, response.text
    assert _result_rows(db, task_id) == []
    assert _frame_rows(db, task_id) == []


def test_publish_refuses_path_shaped_task_id_before_upstream_access(
    client: TestClient, workspace_headers: dict[str, str]
) -> None:
    project_id = _create_project(client, workspace_headers)
    _, task = fresh_task()
    upstream = FakeUpstream(task, default_artifacts())
    with fake_inference(upstream, project_id=project_id):
        response = _publish(client, workspace_headers, project_id, "../" * 12)
    assert response.status_code == 422
    assert upstream.requests == []


@pytest.mark.parametrize("body", [b"not-json", b"[]", b"\xff"])
def test_publish_handles_malformed_upstream_task(
    client: TestClient, workspace_headers: dict[str, str], body: bytes
) -> None:
    project_id = _create_project(client, workspace_headers)
    task_id, task = fresh_task()
    upstream = FakeUpstream(task, default_artifacts(), task_body=body)
    with fake_inference(upstream, project_id=project_id):
        response = _publish(client, workspace_headers, project_id, task_id)
    assert response.status_code == 502
    assert response.json()["detail"] == "视频推理服务暂时不可用"
    assert len(upstream.requests) == 1


def test_publish_preserves_preseed_missing_masks_and_optional_review_note(
    client: TestClient, workspace_headers: dict[str, str], db: Session
) -> None:
    project_id = _create_project(client, workspace_headers)
    task_id, task = fresh_task(review={"tracking_ok": True})
    artifacts = default_artifacts()
    # Tracking begins at the confirmed seed, while keypoints cover the video.
    artifacts["tracking.json"]["frames"] = artifacts["tracking.json"]["frames"][2:]
    artifacts["keypoints.json"]["frames"][0] = _kp_frame(
        0, heading_status="missing_mask", heading=None, proposal=None
    )
    artifacts["provenance.json"]["heading_summary"].update(ok=2, missing_mask=2)
    with fake_inference(FakeUpstream(task, artifacts), project_id=project_id):
        response = _publish(client, workspace_headers, project_id, task_id)
    assert response.status_code == 201, response.text
    assert response.json()["valid_frames"] == 4
    assert response.json()["frames_with_heading"] == 3
    assert response.json()["review_note"] is None
    assert [frame.frame_idx for frame in _frame_rows(db, task_id)] == [2, 3, 4]


def test_publish_refuses_changed_content_after_publication(
    client: TestClient, workspace_headers: dict[str, str], db: Session
) -> None:
    project_id = _create_project(client, workspace_headers)
    task_id, task = fresh_task()
    upstream = FakeUpstream(task, default_artifacts())
    with fake_inference(upstream, project_id=project_id):
        assert (
            _publish(client, workspace_headers, project_id, task_id).status_code == 201
        )
        fingerprint_before = _result_rows(db, task_id)[0].content_fingerprint
        upstream.artifacts["keypoints.json"]["frames"][0]["heading_angle_deg"] = 11.5
        response = _publish(client, workspace_headers, project_id, task_id)
    assert response.status_code == 409
    assert response.json()["detail"] == publishing.REPLAY_CONFLICT_DETAIL
    assert len(_result_rows(db, task_id)) == 1
    assert _result_rows(db, task_id)[0].content_fingerprint == fingerprint_before
    assert len(_frame_rows(db, task_id)) == 4
    assert _frame_rows(db, task_id)[0].heading_angle_deg == 10.25


def test_publish_refuses_cross_project_republish(
    client: TestClient, workspace_headers: dict[str, str], db: Session
) -> None:
    project_a = _create_project(client, workspace_headers)
    project_b = _create_project(client, workspace_headers)
    task_id, task = fresh_task()
    with fake_inference(FakeUpstream(task, default_artifacts()), project_id=project_a):
        assert (
            _publish(client, workspace_headers, project_a, task_id).status_code == 201
        )
        response = _publish(client, workspace_headers, project_b, task_id)
    assert response.status_code == 409
    assert response.json()["detail"]["message"] == publishing.CROSS_PROJECT_DETAIL
    # Project A keeps its published version; project B adopts nothing.
    rows = _result_rows(db, task_id)
    assert len(rows) == 1
    assert str(rows[0].project_id) == project_a
    assert len(_frame_rows(db, task_id)) == 4
    listing_b = client.get(
        f"{settings.API_V1_STR}/projects/{project_b}/results",
        headers=workspace_headers,
    )
    assert listing_b.status_code == 200
    assert listing_b.json()["count"] == 0


def test_publish_refuses_inconsistent_artifacts(
    client: TestClient, workspace_headers: dict[str, str], db: Session
) -> None:
    project_id = _create_project(client, workspace_headers)

    def artifacts_with(mutate: str) -> tuple[str, FakeUpstream]:
        task_id, task = fresh_task()
        artifacts = default_artifacts()
        if mutate == "video_hash":
            artifacts["provenance.json"]["video_sha256"] = "f" * 64
        elif mutate == "tracking_model_hash":
            artifacts["tracking.json"]["mask_model"] = "0" * 64
        elif mutate == "heading_summary":
            artifacts["provenance.json"]["heading_summary"]["ok"] = 4
        elif mutate == "no_heading_fields":
            for row in artifacts["keypoints.json"]["frames"]:
                for key in (
                    "heading_angle_deg",
                    "is_proposal",
                    "heading_status",
                    "keypoint_correction",
                ):
                    row.pop(key)
            artifacts["keypoints.json"].pop("heading_algorithm")
        return task_id, FakeUpstream(task, artifacts)

    for mutate in (
        "video_hash",
        "tracking_model_hash",
        "heading_summary",
        "no_heading_fields",
    ):
        task_id, upstream = artifacts_with(mutate)
        with fake_inference(upstream, project_id=project_id):
            response = _publish(client, workspace_headers, project_id, task_id)
        assert response.status_code == 422, (mutate, response.text)
        assert "推理产物与来源记录不一致" in response.json()["detail"]
        assert _result_rows(db, task_id) == []
        assert _frame_rows(db, task_id) == []


def test_publish_missing_artifact_404(
    client: TestClient, workspace_headers: dict[str, str], db: Session
) -> None:
    project_id = _create_project(client, workspace_headers)
    task_id, task = fresh_task()
    upstream = FakeUpstream(task, default_artifacts())
    upstream.artifact_status["provenance.json"] = 404
    with fake_inference(upstream, project_id=project_id):
        response = _publish(client, workspace_headers, project_id, task_id)
    assert response.status_code == 404
    assert _result_rows(db, task_id) == []


def test_publish_rolls_back_whole_version_on_readback_failure(
    client: TestClient,
    workspace_headers: dict[str, str],
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project_id = _create_project(client, workspace_headers)
    task_id, task = fresh_task()

    def boom(_session: Session, _prepared: publishing.PreparedPublish) -> None:
        raise publishing.PublishRejected(
            status_code=500, detail=publishing.READBACK_DETAIL
        )

    monkeypatch.setattr(publishing, "_verify_readback", boom)
    with fake_inference(FakeUpstream(task, default_artifacts()), project_id=project_id):
        response = _publish(client, workspace_headers, project_id, task_id)
    assert response.status_code == 500
    assert response.json()["detail"] == publishing.READBACK_DETAIL
    # 整版替换语义：失败不留部分写入残留。
    assert _result_rows(db, task_id) == []
    assert _frame_rows(db, task_id) == []


def test_publish_readback_detects_database_payload_changes(
    client: TestClient, workspace_headers: dict[str, str], db: Session
) -> None:
    project_id = _create_project(client, workspace_headers)
    task_id, task = fresh_task()
    verify = publishing._verify_readback

    def changed_database(
        session: Session, prepared: publishing.PreparedPublish
    ) -> None:
        # Simulate a database-side mutation, bypassing the ORM identity map.
        session.connection().execute(
            update(PublishedFrame)
            .where(PublishedFrame.task_id == task_id, PublishedFrame.frame_idx == 0)
            .values(centroid_x=99.0)
        )
        verify(session, prepared)

    with (
        fake_inference(FakeUpstream(task, default_artifacts()), project_id=project_id),
        patch.object(publishing, "_verify_readback", changed_database),
    ):
        response = _publish(client, workspace_headers, project_id, task_id)
    assert response.status_code == 500, response.text
    assert response.json()["detail"] == publishing.READBACK_DETAIL
    assert _result_rows(db, task_id) == []
    assert _frame_rows(db, task_id) == []


def test_publish_round_trips_multiple_readback_segments(
    client: TestClient, workspace_headers: dict[str, str], db: Session
) -> None:
    project_id = _create_project(client, workspace_headers)
    task_id, task = fresh_task()
    count = publishing.READBACK_SEGMENT_ROWS + 3
    task["candidate"]["frame_count"] = count
    artifacts = default_artifacts()
    artifacts["tracking.json"]["frames"] = [
        _tracking_frame(i, True) for i in range(count)
    ]
    artifacts["tracking.json"]["summary"]["valid"] = count
    artifacts["keypoints.json"]["frames"] = [
        _kp_frame(i, heading_status="ok", heading=360.0, proposal=False)
        for i in range(count)
    ]
    artifacts["provenance.json"]["heading_summary"].update(
        ok=count, ok_proposal=0, missing_mask=0, no_heading=0
    )
    with fake_inference(FakeUpstream(task, artifacts), project_id=project_id):
        response = _publish(client, workspace_headers, project_id, task_id)
    assert response.status_code == 201, response.text
    assert response.json()["frames_with_heading"] == count
    assert [frame.frame_idx for frame in _frame_rows(db, task_id)] == list(range(count))


def test_readback_detects_digest_mismatch(db: Session) -> None:
    task_id, task = fresh_task()
    upstream = FakeUpstream(task, default_artifacts())
    artifacts = {name: upstream.payload(name) for name in ARTIFACT_NAMES}
    overlay = hashlib.sha256(OVERLAY_BYTES).hexdigest()
    prepared = publishing._prepare(
        task_id, upstream.task, artifacts, overlay, len(OVERLAY_BYTES)
    )
    assert len(prepared.frames) == 4

    # Tamper with the expected digest: the read-back must refuse to match.
    object.__setattr__(prepared, "readback_digest", "0" * 64)
    with pytest.raises(publishing.PublishRejected) as excinfo:
        publishing._verify_readback(db, prepared)
    assert excinfo.value.detail == publishing.READBACK_DETAIL


def test_project_results_listing_and_frame_rows(
    client: TestClient, workspace_headers: dict[str, str]
) -> None:
    project_id = _create_project(client, workspace_headers)
    other_project_id = _create_project(client, workspace_headers)
    task_id, task = fresh_task()
    with fake_inference(FakeUpstream(task, default_artifacts()), project_id=project_id):
        assert (
            _publish(client, workspace_headers, project_id, task_id).status_code == 201
        )

    listing = client.get(
        f"{settings.API_V1_STR}/projects/{project_id}/results",
        headers=workspace_headers,
    )
    assert listing.status_code == 200
    body = listing.json()
    assert body["count"] == 1
    assert body["data"][0]["task_id"] == task_id

    empty = client.get(
        f"{settings.API_V1_STR}/projects/{other_project_id}/results",
        headers=workspace_headers,
    )
    assert empty.status_code == 200
    assert empty.json()["count"] == 0

    frames = client.get(
        f"{settings.API_V1_STR}/projects/{project_id}/results/{task_id}/frames",
        headers=workspace_headers,
        params={"offset": 1, "limit": 2},
    )
    assert frames.status_code == 200
    payload = frames.json()
    assert payload["count"] == 4
    assert payload["offset"] == 1
    assert [row["frame_idx"] for row in payload["data"]] == [2, 3]
    # HTTP frame rows never carry the mask RLE.
    assert "mask_rle_counts" not in payload["data"][0]
    assert payload["data"][0]["heading_angle_deg"] == 187.5
    assert payload["data"][0]["keypoint_correction"] == "head_tail_swapped"
    assert payload["data"][1]["is_proposal"] is True

    wrong_project = client.get(
        f"{settings.API_V1_STR}/projects/{other_project_id}/results/{task_id}/frames",
        headers=workspace_headers,
    )
    assert wrong_project.status_code == 404


def test_results_listing_scoped_to_owner(
    client: TestClient, workspace_headers: dict[str, str], db: Session
) -> None:
    project_id = _create_project(client, workspace_headers)
    task_id, task = fresh_task()
    with fake_inference(FakeUpstream(task, default_artifacts()), project_id=project_id):
        assert (
            _publish(client, workspace_headers, project_id, task_id).status_code == 201
        )

    outsider = create_random_user(db)
    outsider_headers = authentication_token_from_email(
        client=client, email=outsider.email, db=db
    )
    listing = client.get(
        f"{settings.API_V1_STR}/projects/{project_id}/results",
        headers=outsider_headers,
    )
    assert listing.status_code == 404

    frames = client.get(
        f"{settings.API_V1_STR}/projects/{project_id}/results/{task_id}/frames",
        headers=outsider_headers,
    )
    assert frames.status_code == 404


def test_project_deletion_cascades_published_rows(
    client: TestClient, workspace_headers: dict[str, str], db: Session
) -> None:
    project_id = _create_project(client, workspace_headers)
    task_id, task = fresh_task()
    with fake_inference(FakeUpstream(task, default_artifacts()), project_id=project_id):
        assert (
            _publish(client, workspace_headers, project_id, task_id).status_code == 201
        )
    assert _frame_rows(db, task_id)

    response = client.delete(
        f"{settings.API_V1_STR}/projects/{project_id}", headers=workspace_headers
    )
    assert response.status_code == 200
    db.expire_all()
    assert _result_rows(db, task_id) == []
    assert _frame_rows(db, task_id) == []
    assert db.get(Project, uuid.UUID(project_id)) is None


def test_library_revocation_hides_owned_derivatives_and_agent_scope(
    client: TestClient,
    workspace_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
) -> None:
    project_id = _create_project(client, workspace_headers)
    owner = client.get("/api/v1/users/me", headers=workspace_headers).json()
    grant_url = f"/api/v1/users/{owner['id']}/whole-library-access"
    assert (
        client.put(
            grant_url,
            headers=superuser_token_headers,
            json={"granted": True, "reason": "synthetic scope test"},
        ).status_code
        == 200
    )
    task_id, task = fresh_task()
    upstream = FakeUpstream(task, default_artifacts())
    with fake_inference(upstream, project_id=project_id):
        with Session(engine) as setup:
            setup.exec(
                delete(ExperimentAccess).where(
                    ExperimentAccess.user_id == uuid.UUID(owner["id"])
                )
            )
            setup.commit()
        assert (
            _publish(client, workspace_headers, project_id, task_id).status_code == 201
        )
        results_url = f"/api/v1/projects/{project_id}/results"
        assert client.get(results_url, headers=workspace_headers).json()["count"] == 1
        assert (
            client.get(
                f"/api/v1/inference/tasks/{task_id}", headers=superuser_token_headers
            ).status_code
            == 404
        )
        assert (
            client.put(
                grant_url,
                headers=superuser_token_headers,
                json={"granted": False, "reason": "synthetic revocation"},
            ).status_code
            == 200
        )
        upstream.requests.clear()
        assert client.get(results_url, headers=workspace_headers).json()["count"] == 0
        assert (
            client.get(
                results_url + f"/{task_id}/frames", headers=workspace_headers
            ).status_code
            == 404
        )
        assert (
            client.get("/api/v1/inference/tasks", headers=workspace_headers).json()
            == []
        )
        assert (
            client.get(
                f"/api/v1/inference/tasks/{task_id}/artifacts/overlay.mp4",
                headers={**workspace_headers, "Range": "bytes=0-4"},
            ).status_code
            == 403
        )
        with patch.object(settings, "AGENT_AUTHORIZATION_TOKEN", "synthetic-callback"):
            callback = client.post(
                "/api/v1/internal/agent/authorize",
                headers={"Authorization": "Bearer synthetic-callback"},
                json={
                    "user_id": owner["id"],
                    "data_scope": "project",
                    "project_id": project_id,
                },
            )
        assert callback.status_code == 200
        assert callback.json()["allowed_publication_task_ids"] == []
        assert upstream.requests == []
