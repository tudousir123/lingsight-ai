"""Deterministic per-trial metric computation (ADR-0003, ticket #4).

Pure functions only: `FrameObservation` rows in → `MetricRow` values out.
SQL is never used to derive a metric — it only retrieves raw frames (the
fetch lives in the scripts). The trajectory metrics reproduce the golden
CTE of docs/09 exactly: polyline length over ok-frame centers ordered by
frame_idx, and speed = distance / ok-frame time span.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from itertools import pairwise

from app.metrics.definitions import (
    ALGO_VERSION,
    DIST_PX,
    IN_POOL_RATIO,
    METRIC_DEFINITIONS,
    SPEED_PX,
    STATUS_INSUFFICIENT_OK_FRAMES,
    STATUS_MISSING_POOL_PARAMS,
    STATUS_NO_FRAMES,
    STATUS_NO_OK_FRAMES,
    STATUS_OK,
    VALID_KP_RATIO,
    MetricName,
    MetricRow,
)


@dataclass(frozen=True)
class FrameObservation:
    """One frame_predictions row — exactly the fields metrics need."""

    frame_idx: int
    time_s: float | None
    center_x: float | None
    center_y: float | None
    status: str
    head_x: float | None
    head_y: float | None
    tail_x: float | None
    tail_y: float | None


@dataclass(frozen=True)
class CircleGeometry:
    """A circular zone in pixel space — the pool (videos.pool_*) or the
    platform circle (day consensus position, radius 46 px, ADR-0006)."""

    cx: float
    cy: float
    r: float


def polyline_length(points: Sequence[tuple[float, float]]) -> float:
    """Length of the polyline through `points` in given order.

    Mirrors the golden CTE segment term SQRT(POW(dx,2)+POW(dy,2)) summed
    over consecutive frames.
    """
    return float(sum(math.dist(a, b) for a, b in pairwise(points)))


def _has_complete_keypoints(frame: FrameObservation) -> bool:
    return (
        frame.status == "ok"
        and frame.head_x is not None
        and frame.head_y is not None
        and frame.tail_x is not None
        and frame.tail_y is not None
    )


def compute_trial_metrics(
    video_id: str,
    frames: Sequence[FrameObservation],
    pool: CircleGeometry | None = None,
) -> list[MetricRow]:
    """Compute the four first-batch metrics for one trial (video).

    Always returns exactly four rows, one per metric, in a fixed order —
    even when a metric cannot be computed: the row then carries a
    `calc_status` reason and a NULL value, so failures are queryable
    instead of silently missing.
    """
    total_frames = len(frames)
    ordered = sorted(frames, key=lambda frame: frame.frame_idx)

    # Trajectory input: ok frames with a usable center + timestamp. docs/08
    # verified every ok frame has center and time_s; the guard is defensive.
    trajectory: list[tuple[float, float]] = []
    times: list[float] = []
    valid_kp_frames = 0
    for frame in ordered:
        if _has_complete_keypoints(frame):
            valid_kp_frames += 1
        if (
            frame.status == "ok"
            and frame.time_s is not None
            and frame.center_x is not None
            and frame.center_y is not None
        ):
            trajectory.append((frame.center_x, frame.center_y))
            times.append(frame.time_s)

    ok_frames = len(trajectory)
    duration_s = (max(times) - min(times)) if times else None
    dist = polyline_length(trajectory) if ok_frames >= 2 else None
    speed = (
        dist / duration_s
        if dist is not None and duration_s is not None and duration_s > 0
        else None
    )

    def row(metric: MetricName, value: float | None, status: str) -> MetricRow:
        definition = METRIC_DEFINITIONS[metric]
        return MetricRow(
            video_id=video_id,
            metric=metric,
            algo_version=ALGO_VERSION,
            value=value,
            unit=definition.unit,
            calc_status=status,
            ok_frames=ok_frames,
            total_frames=total_frames,
            duration_s=duration_s,
            definition=definition.definition,
        )

    def dist_status() -> str:
        if total_frames == 0:
            return STATUS_NO_FRAMES
        if ok_frames == 0:
            return STATUS_NO_OK_FRAMES
        if ok_frames < 2:
            return STATUS_INSUFFICIENT_OK_FRAMES
        return STATUS_OK

    dist_row_status = dist_status()
    speed_row_status = (
        STATUS_INSUFFICIENT_OK_FRAMES
        if dist_row_status == STATUS_OK and speed is None
        else dist_row_status
    )

    in_pool_value: float | None = None
    in_pool_status = STATUS_MISSING_POOL_PARAMS
    if pool is not None and pool.r > 0:
        if ok_frames == 0:
            in_pool_status = STATUS_NO_OK_FRAMES
        else:
            in_pool = sum(
                1
                for x, y in trajectory
                if math.hypot(x - pool.cx, y - pool.cy) <= pool.r
            )
            in_pool_value = in_pool / ok_frames
            in_pool_status = STATUS_OK

    return [
        row(DIST_PX, dist, dist_row_status),
        row(SPEED_PX, speed, speed_row_status),
        row(
            VALID_KP_RATIO,
            valid_kp_frames / total_frames if total_frames else None,
            STATUS_OK if total_frames else STATUS_NO_FRAMES,
        ),
        row(
            IN_POOL_RATIO,
            in_pool_value,
            STATUS_NO_FRAMES if total_frames == 0 else in_pool_status,
        ),
    ]
