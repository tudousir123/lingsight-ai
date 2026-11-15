"""Immutable geometry snapshots and conservative tracking dispatch recovery."""

import hashlib
import json
import math
import re
import uuid
from datetime import UTC
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, StrictInt
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session, col, select

from app.inference_access import failure, geometry_public, task_public
from app.inference_client import (
    InferenceArtifactTooLarge,
    InferenceClient,
    InferenceNotFound,
    InferenceUnconfigured,
    InferenceUnreachable,
    InferenceUpstreamError,
)
from app.inference_models import InferenceBinding, PreannotationConfirmation


class Seed(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, strict=True)
    frame: StrictInt = Field(ge=0)
    x: float
    y: float


class Pool(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, strict=True)
    cx: float
    cy: float
    radius: float = Field(gt=0)


class Mark(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    label: str = Field(min_length=1, max_length=100, strict=True)
    polygon: list[list[float]] = Field(min_length=3, max_length=1024)


class ConfirmationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task_id: uuid.UUID
    candidate_version: str = Field(min_length=64, max_length=64)
    expected_confirmation_id: uuid.UUID | None
    seed: Seed
    pool: Pool
    marks: list[Mark] = Field(max_length=64)


def fingerprint(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode()
    ).hexdigest()


def candidate_snapshot(
    task: dict[str, Any], binding: InferenceBinding
) -> dict[str, Any]:
    task_public(task, binding)
    candidate = task.get("candidate")
    if not isinstance(candidate, dict):
        raise failure(404, "resource_not_found", "Candidate not found")
    width, height, count = (
        candidate.get(key) for key in ("width", "height", "frame_count")
    )
    frame = candidate.get("candidate_frame")
    sha = candidate.get("video_sha256")
    if (
        not all(type(value) is int and value > 0 for value in (width, height, count))
        or type(frame) is not int
        or not isinstance(count, int)
        or not 0 <= frame < count
        or not isinstance(sha, str)
        or not re.fullmatch("[a-f0-9]{64}", sha)
    ):
        raise failure(
            409,
            "state_conflict",
            "Candidate image frame, dimensions or input hash unavailable",
        )
    if binding.source_kind == "user_upload" and (width, height, count) != (
        binding.input_width,
        binding.input_height,
        binding.input_frame_count,
    ):
        raise failure(
            409, "state_conflict", "Candidate dimensions do not match uploaded input"
        )
    if binding.video_sha256 is not None and binding.video_sha256 != sha:
        raise failure(409, "stale_version", "Inference input hash changed")
    evidence = candidate.get("evidence") or {}
    reasons = (
        evidence.get("review_reasons", candidate.get("review_reasons", []))
        if isinstance(evidence, dict)
        else []
    )
    result = {
        "project_id": str(binding.project_id),
        "video_id": binding.video_id,
        "task_id": binding.task_id,
        "video_sha256": sha,
        "frame_index": frame,
        "width": width,
        "height": height,
        "frame_count": count,
        "image_url": f"/api/v1/inference/tasks/{binding.task_id}/artifacts/candidate.jpg",
        **geometry_public(candidate),
        "evidence": {
            "review_reasons": [r for r in reasons if isinstance(r, str)]
            if isinstance(reasons, list)
            else []
        },
    }
    try:
        result["candidate_version"] = fingerprint(
            {"task_id": binding.task_id, "candidate": candidate}
        )
    except TypeError, ValueError:
        raise failure(502, "upstream_error", "Candidate is not valid JSON") from None
    return result


def validate_geometry(
    data: ConfirmationInput, candidate: dict[str, Any]
) -> dict[str, Any]:
    w, h, count = candidate["width"], candidate["height"], candidate["frame_count"]
    seed, pool = data.seed, data.pool

    def invalid(message: str) -> None:
        raise failure(422, "invalid_geometry", message)

    if not (0 <= seed.frame < count and 0 <= seed.x < w and 0 <= seed.y < h):
        invalid("Seed outside video")
    if not (
        pool.cx - pool.radius >= 0
        and pool.cy - pool.radius >= 0
        and pool.cx + pool.radius < w
        and pool.cy + pool.radius < h
    ):
        invalid("Pool must fit inside the image")
    if (seed.x - pool.cx) ** 2 + (seed.y - pool.cy) ** 2 > pool.radius**2:
        invalid("Seed must be inside pool")
    labels: set[str] = set()
    for mark in data.marks:
        if not mark.label.strip() or mark.label in labels:
            invalid("Landmark labels must be nonempty and unique")
        labels.add(mark.label)
        points = mark.polygon
        if any(
            len(p) != 2
            or not all(math.isfinite(v) for v in p)
            or not (0 <= p[0] < w and 0 <= p[1] < h)
            for p in points
        ):
            invalid("Landmark outside image")
        if len({tuple(p) for p in points}) != len(points):
            invalid("Landmark vertices must be distinct; do not repeat closing point")
        area = sum(
            a[0] * b[1] - b[0] * a[1]
            for a, b in zip(points, points[1:] + points[:1], strict=True)
        )
        if area == 0:
            invalid("Landmark must have positive area")

        def cross(a: list[float], b: list[float], c: list[float]) -> float:
            return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

        def intersects(
            a: list[float], b: list[float], c: list[float], d: list[float]
        ) -> bool:
            if (
                max(a[0], b[0]) < min(c[0], d[0])
                or max(c[0], d[0]) < min(a[0], b[0])
                or max(a[1], b[1]) < min(c[1], d[1])
                or max(c[1], d[1]) < min(a[1], b[1])
            ):
                return False
            return (
                cross(a, b, c) * cross(a, b, d) <= 0
                and cross(c, d, a) * cross(c, d, b) <= 0
            )

        edges = list(zip(points, points[1:] + points[:1], strict=True))
        for i, (a, b) in enumerate(edges):
            for j in range(i + 1, len(edges)):
                if j == i + 1 or (i == 0 and j == len(edges) - 1):
                    continue
                if intersects(a, b, *edges[j]):
                    invalid("Landmark polygon intersects itself")
    return {
        "seed": seed.model_dump(),
        "pool": pool.model_dump(),
        "marks": [mark.model_dump() for mark in data.marks],
    }


def confirmation_public(
    row: PreannotationConfirmation, binding: InferenceBinding
) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "project_id": str(binding.project_id),
        "video_id": binding.video_id,
        "task_id": binding.task_id,
        "candidate_version": row.candidate_version,
        "video_sha256": row.video_sha256,
        "width": row.width,
        "height": row.height,
        "frame_count": row.frame_count,
        **row.geometry,
        "confirmed_by": str(row.owner_user_id),
        "confirmed_at": row.confirmed_at.replace(tzinfo=UTC)
        if row.confirmed_at.tzinfo is None
        else row.confirmed_at,
        "tracking_dispatch": {
            "status": row.dispatch_status,
            "error_code": row.dispatch_error,
        },
    }


def latest_confirmation(
    session: Session, binding: InferenceBinding
) -> PreannotationConfirmation | None:
    return session.exec(
        select(PreannotationConfirmation)
        .join(
            InferenceBinding,
            col(PreannotationConfirmation.binding_id) == col(InferenceBinding.id),
        )
        .where(
            InferenceBinding.project_id == binding.project_id,
            InferenceBinding.video_id == binding.video_id,
        )
        .order_by(
            col(PreannotationConfirmation.confirmed_at).desc(),
            col(PreannotationConfirmation.id).desc(),
        )
    ).first()


def verify_consumed_confirmation(
    session: Session, binding: InferenceBinding, task: dict[str, Any]
) -> None:
    row = session.get(PreannotationConfirmation, binding.confirmation_id)
    candidate = candidate_snapshot(task, binding)
    if (
        row is None
        or row.binding_id != binding.id
        or row.video_sha256 != candidate["video_sha256"]
        or row.candidate_version != candidate["candidate_version"]
        or row.owner_user_id != binding.owner_user_id
        or row.geometry != task.get("confirmed")
    ):
        raise failure(
            409, "state_conflict", "Task does not match persisted confirmation"
        )


def dispatch_confirmation(
    session: Session,
    client: InferenceClient,
    row: PreannotationConfirmation,
    binding: InferenceBinding,
) -> None:
    # Serialize recovery against all workers; geometry is never updated.
    row = session.exec(
        select(PreannotationConfirmation)
        .where(PreannotationConfirmation.id == row.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).one()
    if row.dispatch_status == "accepted":
        session.commit()
        return
    assert binding.task_id
    try:
        task = client.fetch_task(binding.task_id)
        current = candidate_snapshot(task, binding)
        if current["candidate_version"] != row.candidate_version:
            row.dispatch_status, row.dispatch_error = "failed", "stale_version"
        elif task.get("confirmed") == row.geometry:
            row.dispatch_status, row.dispatch_error = "accepted", None
        elif task.get("confirmed") is not None:
            row.dispatch_status, row.dispatch_error = "failed", "confirmation_mismatch"
        elif row.dispatch_attempted:
            row.dispatch_status, row.dispatch_error = (
                "pending",
                "dispatch_outcome_unknown",
            )
        elif task.get("status") != "waiting_for_review":
            row.dispatch_status, row.dispatch_error = "failed", "state_conflict"
        else:
            row.dispatch_attempted = True
            session.add(row)
            session.commit()  # durable before any possibly accepted HTTP mutation
            try:
                accepted = client.request_json(
                    "POST",
                    f"tasks/{binding.task_id}/confirm",
                    row.geometry,
                    idempotency_key=str(row.id),
                )
                if accepted.get("confirmed") == row.geometry:
                    row.dispatch_status, row.dispatch_error = "accepted", None
                else:
                    row.dispatch_status, row.dispatch_error = (
                        "pending",
                        "dispatch_outcome_unknown",
                    )
            except InferenceUpstreamError as exc:
                if exc.status_code in (400, 404, 409, 422):
                    row.dispatch_attempted = False
                    row.dispatch_status, row.dispatch_error = (
                        "failed",
                        "upstream_rejected",
                    )
                else:
                    row.dispatch_status, row.dispatch_error = (
                        "pending",
                        "dispatch_outcome_unknown",
                    )
            except (
                InferenceUnreachable,
                InferenceUnconfigured,
                InferenceNotFound,
                InferenceArtifactTooLarge,
            ):
                row.dispatch_status, row.dispatch_error = (
                    "pending",
                    "dispatch_outcome_unknown",
                )
                try:
                    recovered = client.fetch_task(binding.task_id)
                    if recovered.get("confirmed") == row.geometry:
                        row.dispatch_status, row.dispatch_error = "accepted", None
                except (
                    InferenceUnreachable,
                    InferenceUnconfigured,
                    InferenceNotFound,
                    InferenceUpstreamError,
                    InferenceArtifactTooLarge,
                ):
                    pass
    except (
        InferenceUnreachable,
        InferenceUnconfigured,
        InferenceNotFound,
        InferenceUpstreamError,
        InferenceArtifactTooLarge,
    ):
        row.dispatch_status, row.dispatch_error = "failed", "service_unavailable"
    session.add(row)
    try:
        session.commit()
    except SQLAlchemyError:
        session.rollback()
        raise failure(
            503,
            "service_unavailable",
            "Confirmation saved; dispatch outcome requires recovery",
        ) from None
