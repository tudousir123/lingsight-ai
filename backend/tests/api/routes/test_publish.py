"""Publish pipeline (#43): gate, consistency, whole-version write, idempotency.

The inference upstream is a fake served through httpx.MockTransport (the
gateway contract-test precedent): one task plus its tracking/keypoints/
provenance artifacts and an overlay stream. No real service, no GPU, no
L3 — but the real database, the real route stack and the real writer.
Each test gets its own task id so published rows never leak across tests.
"""

import hashlib
import json
import re
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any
from unittest.mock import patch

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app import publishing
from app.core.config import settings
from app.models import PublishedFrame, PublishedResult, Project
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

HEADING_ALGORITHM = "frozen-ball-chord-7px-v1"
KEYPOINT_PROTOCOL = "fixed-mask-centroid-crop256-fp32-v9"

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
            _kp_frame(
                3, heading_status="ok_proposal", heading=270.0, proposal=True
            ),
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
        "heading_parameters": {"primary_radius_px": 7},
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
        "video_id": "day01/maze-clip.mp4",
        "status": "succeeded",
        "stage": "overlay",
        "candidate": {
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
    requests: list[httpx.Request] = field(default_factory=list)

    @property
    def task_id(self) -> str:
        return str(self.task["id"])

    def payload(self, name: str) -> bytes:
        return json.dumps(self.artifacts[name]).encode()


@contextmanager
def fake_inference(upstream: FakeUpstream):
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
            return httpx.Response(200, json=upstream.task)
        if name == "overlay.mp4":
            status = upstream.artifact_status.get(name, 200)
            return httpx.Response(status, content=upstream.overlay_bytes)
        status = upstream.artifact_status.get(name, 200)
        return httpx.Response(status, content=upstream.payload(name))

    original = httpx.Client
    with (
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
    with patch.object(settings, "AGENT_WORKSPACE_EMAIL", user.email):
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
        db.exec(
            select(PublishedResult).where(PublishedResult.task_id == task_id)
        ).all()
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


def test_publish_requires_workspace_user(client: TestClient, db: Session) -> None:
    outsider = create_random_user(db)
    headers = authentication_token_from_email(
        client=client, email=outsider.email, db=db
    )
    task_id, task = fresh_task()
    with fake_inference(FakeUpstream(task, default_artifacts())):
        response = _publish(client, headers, uuid.uuid4().hex, task_id)
    assert response.status_code == 403
    assert "个人科研工作区" in response.json()["detail"]


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
    with fake_inference(upstream):
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
    with fake_inference(upstream):
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
    with fake_inference(upstream):
        response = _publish(client, workspace_headers, project_id, task_id)
    assert response.status_code == 503
    assert response.json()["detail"] == "暂时无法连接视频推理服务"
    assert _result_rows(db, task_id) == []


def test_publish_writes_v3_shaped_summary_and_frame_rows(
    client: TestClient, workspace_headers: dict[str, str], db: Session
) -> None:
    project_id = _create_project(client, workspace_headers)
    task_id, task = fresh_task()
    with fake_inference(FakeUpstream(task, default_artifacts())):
        response = _publish(client, workspace_headers, project_id, task_id)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["replayed"] is False
    assert body["task_id"] == task_id
    assert body["video_id"] == "day01/maze-clip.mp4"
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
    assert result.provenance_json_sha256 == hashlib.sha256(
        json.dumps(default_artifacts()["provenance.json"]).encode()
    ).hexdigest()

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


def test_publish_replays_identical_version_without_rewriting(
    client: TestClient, workspace_headers: dict[str, str], db: Session
) -> None:
    project_id = _create_project(client, workspace_headers)
    task_id, task = fresh_task()
    upstream = FakeUpstream(task, default_artifacts())
    with fake_inference(upstream):
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


def test_publish_refuses_changed_content_after_publication(
    client: TestClient, workspace_headers: dict[str, str], db: Session
) -> None:
    project_id = _create_project(client, workspace_headers)
    task_id, task = fresh_task()
    upstream = FakeUpstream(task, default_artifacts())
    with fake_inference(upstream):
        assert (
            _publish(client, workspace_headers, project_id, task_id).status_code
            == 201
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
    with fake_inference(FakeUpstream(task, default_artifacts())):
        assert (
            _publish(client, workspace_headers, project_a, task_id).status_code == 201
        )
        response = _publish(client, workspace_headers, project_b, task_id)
    assert response.status_code == 409
    assert response.json()["detail"] == publishing.CROSS_PROJECT_DETAIL
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
        with fake_inference(upstream):
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
    with fake_inference(upstream):
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

    def boom(session: Session, prepared: publishing.PreparedPublish) -> None:
        raise publishing.PublishRejected(
            status_code=500, detail=publishing.READBACK_DETAIL
        )

    monkeypatch.setattr(publishing, "_verify_readback", boom)
    with fake_inference(FakeUpstream(task, default_artifacts())):
        response = _publish(client, workspace_headers, project_id, task_id)
    assert response.status_code == 500
    assert response.json()["detail"] == publishing.READBACK_DETAIL
    # 整版替换语义：失败不留部分写入残留。
    assert _result_rows(db, task_id) == []
    assert _frame_rows(db, task_id) == []


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
    client: TestClient, workspace_headers: dict[str, str], db: Session
) -> None:
    project_id = _create_project(client, workspace_headers)
    other_project_id = _create_project(client, workspace_headers)
    task_id, task = fresh_task()
    with fake_inference(FakeUpstream(task, default_artifacts())):
        assert (
            _publish(client, workspace_headers, project_id, task_id).status_code
            == 201
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
    with fake_inference(FakeUpstream(task, default_artifacts())):
        assert (
            _publish(client, workspace_headers, project_id, task_id).status_code
            == 201
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
    with fake_inference(FakeUpstream(task, default_artifacts())):
        assert (
            _publish(client, workspace_headers, project_id, task_id).status_code
            == 201
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
