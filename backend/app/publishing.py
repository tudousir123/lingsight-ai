"""Publish pipeline: reviewed inference task → application database.

The platform pulls a task's whitelisted artifacts from the inference service
with a server-side client, validates their mutual consistency, converts them
to the v3 result form and writes one whole version into the application
database under a project (ticket #43 / ADR-0017):

- gate — only tasks the researcher marked ``tracking_ok`` upstream publish;
- consistency — provenance hashes must match the candidate video, the model
  hashes the artifacts carry, and the artifact frames each other;
- conversion — video/task-level summary + one row per frame *with* a heading
  (``ok`` and ``ok_proposal`` alike; invalid frames stay out — the summary
  counts carry the denominators), v3 ``frames`` column shape;
- whole-version write — summary + all frame rows in one transaction, then a
  segmented read-back whose digest must match, else rollback (no partial
  residue);
- idempotency — same task + identical artifact fingerprint replays the
  published record untouched; a different fingerprint is refused.

Large artifacts never enter the database: ``overlay.mp4`` is streamed once
upstream-side only to hash it; the row keeps the SHA-256 and byte size.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import uuid
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from app.inference_client import (
    JSON_ARTIFACTS,
    InferenceArtifactTooLarge,
    InferenceClient,
    InferenceNotFound,
    InferenceUnconfigured,
    InferenceUnreachable,
    InferenceUpstreamError,
)
from app.models import PublishedFrame, PublishedResult, PublishedResultPublic

logger = logging.getLogger(__name__)

RLE_FORMAT = "coco_counts_column_major"  # same convention as water_maze_v3.frames
READBACK_SEGMENT_ROWS = 2000
WRITE_BATCH_ROWS = 500
FLOAT_TOLERANCE = 1e-6
HEADING_ALGORITHM = "frozen-ball-chord-7px-v1"
PRIMARY_RADIUS_PX = 7
KEYPOINT_PROTOCOL = "fixed-mask-centroid-crop256-fp32-v9"
HEADING_STATUSES = frozenset(("ok", "ok_proposal", "missing_mask", "no_heading"))
KEYPOINT_CORRECTIONS = frozenset(
    ("", "head_tail_swapped", "flip_unresolved", "flip_kept_by_trajectory")
)

GATE_DETAIL = "只有通过人工复核（tracking_ok）的推理任务才能发布"
CONSISTENCY_DETAIL = "推理产物与来源记录不一致：{reason}"
REPLAY_CONFLICT_DETAIL = "该任务已发布过不同版本的结果，已拒绝重复发布"
CROSS_PROJECT_DETAIL = "该任务已发布到其他项目；一个任务的已发布结果只归属一个项目"
READBACK_DETAIL = "发布结果回读核对失败，已回滚本次写入"
WRITE_FAILED_DETAIL = "发布写入失败，已回滚"


class PublishRejected(HTTPException):
    """A publish-time gate or consistency refusal (never a transport error)."""


def _reject(status: int, detail: str) -> PublishRejected:
    return PublishRejected(status_code=status, detail=detail)


@dataclass(frozen=True)
class PreparedPublish:
    """Validated task content ready for the whole-version write."""

    task_id: str
    video_id: str
    fps: float
    total_frames: int
    valid_frames: int
    frames_with_heading: int
    proposal_frames: int
    video_sha256: str
    first_frame_model_sha256: str
    mark_model_sha256: str
    tracking_model_sha256: str
    v9_model_sha256: str
    tracking_json_sha256: str
    keypoints_json_sha256: str
    provenance_json_sha256: str
    overlay_sha256: str
    overlay_bytes: int
    heading_algorithm: str
    keypoint_protocol: str
    review_note: str | None
    fingerprint: str
    frames: list[PublishedFrame]
    readback_digest: str


def _sha256_hex(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _finite(value: Any) -> float | None:
    """Accept a JSON number (not bool) within sane image-coordinate bounds."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        number = float(value)
    except OverflowError:
        return None
    return number if -1e18 < number < 1e18 else None


def _point(value: Any) -> tuple[float | None, float | None]:
    if (
        not isinstance(value, list)
        or len(value) != 2
        or (x := _finite(value[0])) is None
        or (y := _finite(value[1])) is None
    ):
        return (None, None)
    return (x, y)


def _require(condition: Any, reason: str) -> None:
    if not condition:
        raise _reject(422, CONSISTENCY_DETAIL.format(reason=reason))


def _gate(task: dict[str, Any]) -> None:
    review = task.get("review")
    if (
        task.get("status") != "succeeded"
        or not isinstance(review, dict)
        or review.get("tracking_ok") is not True
    ):
        raise _reject(409, GATE_DETAIL)


def _validate_rle(rle: Any) -> tuple[str, int, int] | None:
    """Structurally check one COCO column-major RLE; None when malformed."""
    if not isinstance(rle, dict):
        return None
    size, counts = rle.get("size"), rle.get("counts")
    if (
        not isinstance(size, list)
        or len(size) != 2
        or not all(
            isinstance(v, int) and not isinstance(v, bool) and v > 0 for v in size
        )
        or not isinstance(counts, list)
        or not counts
        or not all(
            isinstance(c, int) and not isinstance(c, bool) and c >= 0 for c in counts
        )
    ):
        return None
    height, width = size
    if sum(counts) != height * width:
        return None
    return json.dumps(counts, separators=(",", ":")), width, height


def _frame_digest(frame: PublishedFrame) -> bytes:
    """Canonical per-row digest covering the whole scientific payload."""

    def cell(value: float | None) -> str:
        return "null" if value is None else repr(float(value))

    def text(value: str | None) -> str:
        return "null" if value is None else value

    return (
        f"{frame.frame_idx}|{int(frame.mask_valid)}"
        f"|{cell(frame.centroid_x)}|{cell(frame.centroid_y)}|{cell(frame.contour_area)}"
        f"|{text(frame.mask_rle_counts)}|{frame.mask_width}|{frame.mask_height}"
        f"|{text(frame.rle_format)}"
        f"|{cell(frame.head_x)}|{cell(frame.head_y)}|{cell(frame.tail_x)}|{cell(frame.tail_y)}"
        f"|{cell(frame.heading_angle_deg)}|{int(frame.is_proposal)}|{frame.keypoint_correction}\n"
    ).encode()


def _load_artifacts(
    artifacts: dict[str, bytes],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    try:
        tracking = json.loads(artifacts["tracking.json"])
        keypoints = json.loads(artifacts["keypoints.json"])
        provenance = json.loads(artifacts["provenance.json"])
    except (ValueError, UnicodeError, KeyError) as exc:
        raise _reject(
            422, CONSISTENCY_DETAIL.format(reason="产物不是合法 JSON")
        ) from exc
    _require(isinstance(tracking, dict), "tracking.json 结构不合法")
    _require(isinstance(keypoints, dict), "keypoints.json 结构不合法")
    _require(isinstance(provenance, dict), "provenance.json 结构不合法")
    assert isinstance(tracking, dict)
    assert isinstance(keypoints, dict)
    assert isinstance(provenance, dict)
    return tracking, keypoints, provenance


def _provenance_hash(provenance: dict[str, Any], key: str) -> str:
    value = provenance.get(key)
    _require(_is_sha256(value), f"来源记录缺少合法 {key}")
    assert isinstance(value, str)
    return value


def _is_sha256(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def _prepare(
    task_id: str,
    task: dict[str, Any],
    artifacts: dict[str, bytes],
    overlay_sha256: str,
    overlay_bytes: int,
) -> PreparedPublish:
    """Validate task/artifact mutual consistency and convert to DB rows."""
    _gate(task)
    _require(task.get("id") == task_id, "上游返回的任务标识与请求不一致")
    candidate = task.get("candidate")
    _require(isinstance(candidate, dict), "任务缺少候选视频元数据")
    assert isinstance(candidate, dict)
    video_sha256 = candidate.get("video_sha256")
    frame_count = candidate.get("frame_count")
    fps = _finite(candidate.get("fps"))
    video_id = task.get("video_id")
    _require(
        _is_sha256(video_sha256),
        "候选视频缺少 sha256",
    )
    assert isinstance(video_sha256, str)
    _require(
        isinstance(frame_count, int)
        and not isinstance(frame_count, bool)
        and frame_count > 0,
        "候选视频帧数不可用",
    )
    assert isinstance(frame_count, int)
    _require(
        fps is not None and fps > 0,
        "候选视频帧率不可用",
    )
    assert isinstance(fps, (int, float))
    _require(isinstance(video_id, str) and bool(video_id), "任务缺少视频标识")
    assert isinstance(video_id, str)

    tracking, keypoints, provenance = _load_artifacts(artifacts)
    _require(
        isinstance(task.get("confirmed"), dict)
        and provenance.get("confirmed") == task["confirmed"],
        "人工确认参数与来源记录不一致",
    )

    # Cross-artifact hash and lineage checks.
    _require(
        provenance.get("video_sha256") == video_sha256,
        "来源记录与候选视频的 sha256 不一致",
    )
    _require(
        tracking.get("mask_model") == provenance.get("tracking_sha256"),
        "追踪产物的模型哈希与来源记录不一致",
    )
    _require(
        keypoints.get("model_sha256") == provenance.get("v9_sha256"),
        "关键点产物的模型哈希与来源记录不一致",
    )
    heading_algorithm = keypoints.get("heading_algorithm")
    _require(
        heading_algorithm == HEADING_ALGORITHM,
        "关键点产物缺少朝向算法标识（需含朝向阶段的新版结果）",
    )
    assert isinstance(heading_algorithm, str)
    parameters = keypoints.get("heading_parameters")
    _require(
        isinstance(parameters, dict)
        and parameters.get("primary_radius_px") == PRIMARY_RADIUS_PX,
        "朝向参数不符合冻结 7px 协议",
    )
    _require(
        heading_algorithm == provenance.get("heading_algorithm"),
        "朝向算法标识与来源记录不一致",
    )
    keypoint_protocol = keypoints.get("protocol")
    _require(
        keypoint_protocol == KEYPOINT_PROTOCOL
        and keypoint_protocol == provenance.get("keypoint_protocol"),
        "关键点协议与来源记录不一致",
    )
    assert isinstance(keypoint_protocol, str)
    first_frame_hash = _provenance_hash(provenance, "first_frame_sha256")
    mark_hash = _provenance_hash(provenance, "mark_sha256")
    tracking_hash = _provenance_hash(provenance, "tracking_sha256")
    v9_hash = _provenance_hash(provenance, "v9_sha256")

    tracking_frames = tracking.get("frames")
    kp_frames = keypoints.get("frames")
    _require(isinstance(tracking_frames, list), "tracking.json 缺少帧列表")
    _require(isinstance(kp_frames, list), "keypoints.json 缺少帧列表")
    assert isinstance(tracking_frames, list)
    assert isinstance(kp_frames, list)
    _require(len(kp_frames) == frame_count, "关键点帧数与候选视频帧数不一致")

    tracking_by_idx: dict[int, dict[str, Any]] = {}
    valid_frames = 0
    for row in tracking_frames:
        _require(isinstance(row, dict), "追踪帧结构不合法")
        assert isinstance(row, dict)
        idx = row.get("frame")
        _require(
            isinstance(idx, int)
            and not isinstance(idx, bool)
            and 0 <= idx < frame_count,
            "追踪帧序不合法",
        )
        assert isinstance(idx, int)
        _require(idx not in tracking_by_idx, "追踪帧重复")
        _require(isinstance(row.get("valid"), bool), "追踪有效位不合法")
        tracking_by_idx[idx] = row
        if row.get("valid") is True:
            valid_frames += 1
            _require(
                _validate_rle(row.get("mask_rle")) is not None,
                f"第 {idx} 帧的 mask RLE 不合法",
            )

    ok_frames = proposal_frames = 0
    status_counts: dict[str, int] = {}
    frames: list[PublishedFrame] = []
    digest = hashlib.sha256()
    for index, row in enumerate(kp_frames):
        _require(isinstance(row, dict), "关键点帧结构不合法")
        assert isinstance(row, dict)
        _require(
            type(row.get("frame")) is int and row["frame"] == index,
            "关键点帧序与视频帧不一致",
        )
        status = row.get("heading_status")
        _require(
            isinstance(status, str) and status in HEADING_STATUSES,
            f"第 {index} 帧缺少合法朝向状态",
        )
        assert isinstance(status, str)
        status_counts[status] = status_counts.get(status, 0) + 1
        heading = _finite(row.get("heading_angle_deg"))
        tracking_row = tracking_by_idx.get(index)
        has_mask = tracking_row is not None and tracking_row.get("valid") is True
        if status in ("missing_mask", "no_heading"):
            # ok 与提案均入、无效帧不入：无朝向的帧不产生行。
            _require(
                row.get("heading_angle_deg") is None
                and row.get("is_proposal") is None
                and (status == "no_heading") == has_mask,
                f"第 {index} 帧无朝向状态与 mask/数值不一致",
            )
            continue
        _require(
            # Upstream rounds to six decimal places and can emit exactly 360.
            heading is not None and 0 <= heading <= 360,
            f"第 {index} 帧朝向角不合法",
        )
        assert heading is not None
        proposal = row.get("is_proposal")
        _require(isinstance(proposal, bool), f"第 {index} 帧缺少提案标记")
        assert isinstance(proposal, bool)
        _require(
            proposal == (status == "ok_proposal"),
            f"第 {index} 帧朝向状态与提案标记不一致",
        )
        correction = row.get("keypoint_correction", "")
        _require(
            isinstance(correction, str) and correction in KEYPOINT_CORRECTIONS,
            f"第 {index} 帧极性标记不合法",
        )
        assert isinstance(correction, str)
        _require(
            tracking_row is not None and tracking_row.get("valid") is True,
            f"第 {index} 帧有朝向但缺少有效 mask",
        )
        assert tracking_row is not None
        rle = _validate_rle(tracking_row.get("mask_rle"))
        _require(rle is not None, f"第 {index} 帧的 mask RLE 不合法")
        assert rle is not None
        counts, width, height = rle
        # v9 stores the mask-pixel mean used for its crop and frozen heading.
        # Tracking's rounded contour-moments center is a different quantity.
        centroid_x, centroid_y = _point(row.get("center"))
        _require(
            centroid_x is not None and centroid_y is not None,
            f"第 {index} 帧缺少有效的 v9 mask 像素质心",
        )
        head = _point(row.get("head"))
        tail = _point(row.get("tail"))
        area = _finite(tracking_row.get("contour_area"))
        frames.append(
            PublishedFrame(
                task_id=task_id,
                frame_idx=index,
                mask_valid=True,
                centroid_x=centroid_x,
                centroid_y=centroid_y,
                contour_area=area,
                mask_rle_counts=counts,
                mask_width=width,
                mask_height=height,
                rle_format=RLE_FORMAT,
                head_x=head[0],
                head_y=head[1],
                tail_x=tail[0],
                tail_y=tail[1],
                heading_angle_deg=heading,
                is_proposal=proposal,
                keypoint_correction=correction,
            )
        )
        if proposal:
            proposal_frames += 1
        else:
            ok_frames += 1
        digest.update(_frame_digest(frames[-1]))

    _require(bool(frames), "结果没有任何带朝向的帧，无法发布")

    summary = provenance.get("heading_summary")
    _require(isinstance(summary, dict), "来源记录缺少朝向汇总")
    assert isinstance(summary, dict)
    for key, expected in (
        ("ok", ok_frames),
        ("ok_proposal", proposal_frames),
        ("missing_mask", status_counts.get("missing_mask", 0)),
        ("no_heading", status_counts.get("no_heading", 0)),
    ):
        _require(
            summary.get(key) == expected,
            f"来源记录的朝向汇总与关键点产物不一致（{key}）",
        )

    tracking_json_sha256 = _sha256_hex(artifacts["tracking.json"])
    keypoints_json_sha256 = _sha256_hex(artifacts["keypoints.json"])
    provenance_json_sha256 = _sha256_hex(artifacts["provenance.json"])
    fingerprint = _sha256_hex(
        "\n".join(
            (
                video_sha256,
                tracking_json_sha256,
                keypoints_json_sha256,
                provenance_json_sha256,
                overlay_sha256,
            )
        ).encode()
    )
    review_note = (
        task["review"].get("note") if isinstance(task.get("review"), dict) else None
    )
    if not isinstance(review_note, str):
        review_note = None
    return PreparedPublish(
        task_id=task_id,
        video_id=video_id,
        fps=float(fps),
        total_frames=frame_count,
        valid_frames=valid_frames,
        frames_with_heading=len(frames),
        proposal_frames=proposal_frames,
        video_sha256=video_sha256,
        first_frame_model_sha256=first_frame_hash,
        mark_model_sha256=mark_hash,
        tracking_model_sha256=tracking_hash,
        v9_model_sha256=v9_hash,
        tracking_json_sha256=tracking_json_sha256,
        keypoints_json_sha256=keypoints_json_sha256,
        provenance_json_sha256=provenance_json_sha256,
        overlay_sha256=overlay_sha256,
        overlay_bytes=overlay_bytes,
        heading_algorithm=heading_algorithm,
        keypoint_protocol=keypoint_protocol,
        review_note=review_note,
        fingerprint=fingerprint,
        frames=frames,
        readback_digest=digest.hexdigest(),
    )


def _write_whole_version(
    session: Session,
    prepared: PreparedPublish,
    project_id: uuid.UUID,
    user_id: uuid.UUID,
) -> PublishedResult:
    """Insert summary + frames as one version, verify by segmented read-back."""
    result = PublishedResult(
        task_id=prepared.task_id,
        project_id=project_id,
        user_id=user_id,
        video_id=prepared.video_id,
        fps=prepared.fps,
        total_frames=prepared.total_frames,
        valid_frames=prepared.valid_frames,
        frames_with_heading=prepared.frames_with_heading,
        proposal_frames=prepared.proposal_frames,
        video_sha256=prepared.video_sha256,
        first_frame_model_sha256=prepared.first_frame_model_sha256,
        mark_model_sha256=prepared.mark_model_sha256,
        tracking_model_sha256=prepared.tracking_model_sha256,
        v9_model_sha256=prepared.v9_model_sha256,
        tracking_json_sha256=prepared.tracking_json_sha256,
        keypoints_json_sha256=prepared.keypoints_json_sha256,
        provenance_json_sha256=prepared.provenance_json_sha256,
        overlay_sha256=prepared.overlay_sha256,
        overlay_bytes=prepared.overlay_bytes,
        heading_algorithm=prepared.heading_algorithm,
        keypoint_protocol=prepared.keypoint_protocol,
        content_fingerprint=prepared.fingerprint,
        review_tracking_ok=True,
        review_note=prepared.review_note,
    )
    try:
        # Claim the unique task before writing any frames. Deleting frame rows
        # first takes MySQL gap locks and can deadlock simultaneous publishers.
        # Published versions are immutable; the FK forbids orphan old frames.
        session.add(result)
        session.flush()
        for start in range(0, len(prepared.frames), WRITE_BATCH_ROWS):
            session.add_all(prepared.frames[start : start + WRITE_BATCH_ROWS])
            session.flush()
        _verify_readback(session, prepared)
        session.commit()
    except PublishRejected:
        session.rollback()
        raise
    except IntegrityError:
        session.rollback()
        # Preserve the driver's duplicate key code for the caller to settle
        # a simultaneous publication after the winning transaction commits.
        raise
    except Exception:
        # Driver/ORM detail goes to the log, never into the API response.
        session.rollback()
        logger.exception("publish write failed for task %s", prepared.task_id)
        raise _reject(500, WRITE_FAILED_DETAIL) from None
    session.refresh(result)
    return result


def _verify_readback(session: Session, prepared: PreparedPublish) -> None:
    """Re-read the uncommitted version in segments and compare digests.

    Same discipline as the v3 write-back: values must round-trip exactly
    (float tolerance 1e-6) and the per-row digest must equal the one built
    from the artifacts, or the whole transaction rolls back.
    """
    digest = hashlib.sha256()
    total = 0
    offset = 0
    while True:
        rows = session.exec(
            select(PublishedFrame)
            .where(col(PublishedFrame.task_id) == prepared.task_id)
            .order_by(col(PublishedFrame.frame_idx))
            .offset(offset)
            .limit(READBACK_SEGMENT_ROWS)
            # A SELECT alone can return the just-inserted ORM objects from
            # the identity map. Reload persisted cells to verify the database.
            .execution_options(populate_existing=True)
        ).all()
        if not rows:
            break
        for row in rows:
            expected = prepared.frames[total]
            if (
                row.frame_idx != expected.frame_idx
                or row.is_proposal != expected.is_proposal
                or abs(float(row.heading_angle_deg) - expected.heading_angle_deg)
                > FLOAT_TOLERANCE
            ):
                raise _reject(500, READBACK_DETAIL)
            digest.update(_frame_digest(row))
            total += 1
        offset += READBACK_SEGMENT_ROWS
        if len(rows) < READBACK_SEGMENT_ROWS:
            break
    if total != len(prepared.frames) or digest.hexdigest() != prepared.readback_digest:
        raise _reject(500, READBACK_DETAIL)


def _settle_existing(
    existing: PublishedResult, prepared: PreparedPublish, project_id: uuid.UUID
) -> tuple[PublishedResult, bool]:
    """Idempotency rules for a task that already has a published version."""
    if existing.project_id != project_id:
        # One published version belongs to exactly one project; a second
        # project must not silently adopt (or rewrite) another project's data.
        raise _reject(409, CROSS_PROJECT_DETAIL)
    if existing.content_fingerprint == prepared.fingerprint:
        return existing, True
    raise _reject(409, REPLAY_CONFLICT_DETAIL)


def publish_task_results(
    session: Session,
    client: InferenceClient,
    *,
    project_id: uuid.UUID,
    user_id: uuid.UUID,
    task_id: str,
) -> tuple[PublishedResult, bool]:
    """Publish one reviewed task into a project; returns (result, replayed)."""
    try:
        task = client.fetch_task(task_id)
        # The human gate runs before any artifact is pulled: an unreviewed
        # task must not cost three downloads plus an overlay stream.
        _gate(task)
        artifacts = {
            name: client.fetch_artifact(task_id, name) for name in JSON_ARTIFACTS
        }
        overlay = client.hash_artifact(task_id, "overlay.mp4")
    except InferenceUnconfigured:
        raise HTTPException(503, "视频推理服务尚未配置") from None
    except InferenceUnreachable:
        raise HTTPException(503, "暂时无法连接视频推理服务") from None
    except InferenceNotFound as exc:
        raise HTTPException(404, exc.detail) from None
    except InferenceUpstreamError:
        raise HTTPException(502, "视频推理服务暂时不可用") from None
    except InferenceArtifactTooLarge:
        raise HTTPException(502, "推理产物超出发布大小上限") from None

    prepared = _prepare(task_id, task, artifacts, overlay.sha256, overlay.size_bytes)

    existing = session.exec(
        select(PublishedResult).where(col(PublishedResult.task_id) == task_id)
    ).first()
    if existing is not None:
        return _settle_existing(existing, prepared, project_id)
    try:
        return _write_whole_version(session, prepared, project_id, user_id), False
    except IntegrityError as exc:
        # A concurrent publish of the same task hit the unique constraint
        # after our select: re-read and settle as replay or conflict.
        if _is_unique_violation(exc):
            existing = session.exec(
                select(PublishedResult).where(col(PublishedResult.task_id) == task_id)
            ).first()
            if existing is not None:
                return _settle_existing(existing, prepared, project_id)
        logger.exception("publish integrity failure for task %s", prepared.task_id)
        raise _reject(500, WRITE_FAILED_DETAIL) from None


def _is_unique_violation(exc: IntegrityError) -> bool:
    return exc.orig is not None and bool(exc.orig.args) and exc.orig.args[0] == 1062


def result_public(
    result: PublishedResult, *, replayed: bool = False
) -> PublishedResultPublic:
    return PublishedResultPublic(
        task_id=result.task_id,
        project_id=result.project_id,
        video_id=result.video_id,
        fps=result.fps,
        total_frames=result.total_frames,
        valid_frames=result.valid_frames,
        frames_with_heading=result.frames_with_heading,
        proposal_frames=result.proposal_frames,
        heading_algorithm=result.heading_algorithm,
        keypoint_protocol=result.keypoint_protocol,
        video_sha256=result.video_sha256,
        content_fingerprint=result.content_fingerprint,
        review_note=result.review_note,
        published_at=result.published_at,
        replayed=replayed,
    )
