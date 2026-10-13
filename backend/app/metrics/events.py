"""Deterministic behavioral-event detection (ADR-0006, docs/10, ticket #6).

Pure functions only, the same discipline as ``app.metrics.compute``: frame
rows in → ``MetricRow`` values out, SQL only retrieves. The four events and
their parameters are the ones the experiment lead confirmed in writing in
docs/10-event-definitions.md (2026-10-13) — including the ruling that
platform contact is decided by the body **mask**, not the center point.

Masks arrive as COCO uncompressed column-major counts
(``rle_format='coco_counts_column_major'``): the comma-separated integers
are alternating run lengths of background/foreground pixels over the
flattened ``width * height`` array in column-major order
(index = column * height + row). The stored ``mask_bbox_*`` columns decode
to exactly this interpretation (2026-10-13, 1050/1050 rows); the stored
``mask_area_px`` is the model's sub-pixel estimate, so the raster pixel
count runs above it with ratio ≤ 1.3 (median 1.06).
"""

import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from app.metrics.compute import CircleGeometry
from app.metrics.definitions import (
    ALGO_VERSION_EVENTS,
    ESCAPE_LATENCY_S,
    FIRST_DETECTION_S,
    METRIC_DEFINITIONS,
    MOUNT_MIN_FRAMES,
    MOUNT_S,
    PLATFORM_CONTACT_S,
    STATUS_MISSING_MASK_PARAMS,
    STATUS_MISSING_PLATFORM_PARAMS,
    STATUS_MISSING_POOL_PARAMS,
    STATUS_NO_CONTACT,
    STATUS_NO_ENTRY,
    STATUS_NO_FRAMES,
    STATUS_NO_MOUNT,
    STATUS_NO_OK_FRAMES,
    STATUS_OK,
    WATER_ENTRY_S,
    MetricName,
    MetricRow,
)


@dataclass(frozen=True)
class EventFrame:
    """One frame_predictions row — the fields event detection needs.

    Mask fields are the platform-contact inputs (docs/10: contact is
    decided by the mask). ``mask_bbox`` is a cheap prefilter; the RLE
    counts decide. Ok frames always carry all of them in the live data —
    the ``None`` guards are defensive, not expected paths.
    """

    frame_idx: int
    time_s: float | None
    center_x: float | None
    center_y: float | None
    status: str
    mask_bbox: tuple[float, float, float, float] | None = None  # x1, y1, x2, y2
    mask_rle_counts: str | None = None
    mask_width: int | None = None
    mask_height: int | None = None


def encode_mask_counts(
    pixels: Iterable[tuple[int, int]], width: int, height: int
) -> str:
    """Encode a pixel set as COCO column-major counts (format reference).

    Round-trips ``mask_area_and_bbox``; exists so the encoding the decoder
    assumes is executable, not just documented.
    """
    indices = sorted(x * height + y for x, y in pixels)
    parts: list[int] = []
    cursor = 0  # flattened position after the last emitted run
    i = 0
    while i < len(indices):
        run_start = indices[i]
        run_end = run_start + 1
        while i + 1 < len(indices) and indices[i + 1] == run_end:
            run_end += 1
            i += 1
        parts.append(run_start - cursor)  # background before the run
        parts.append(run_end - run_start)  # foreground run
        cursor = run_end
        i += 1
    parts.append(width * height - cursor)  # trailing background
    return ",".join(str(part) for part in parts)


def mask_area_and_bbox(
    counts: str, width: int, height: int
) -> tuple[int, float, float, float, float]:
    """Decode full-mask area (pixel count) and bbox (x1, y1, x2, y2).

    Raises ValueError when the runs do not sum to width * height — a
    counts string that long or short is not this mask.
    """
    area = 0
    x1, y1 = math.inf, math.inf
    x2, y2 = -math.inf, -math.inf
    pos = 0
    foreground = False
    for count in (int(part) for part in counts.split(",")):
        if foreground and count:
            area += count
            start_col, start_row = divmod(pos, height)
            end_col, end_row = divmod(pos + count - 1, height)
            x1, x2 = min(x1, start_col), max(x2, end_col)
            if start_col == end_col:
                y1, y2 = min(y1, start_row), max(y2, end_row)
            else:
                # a run spanning columns covers all rows in between
                y1, y2 = min(y1, 0.0), max(y2, float(height - 1))
        pos += count
        foreground = not foreground
    if pos != width * height:
        raise ValueError(
            f"mask counts sum to {pos}, expected {width * height} ({width}x{height})"
        )
    return area, float(x1), float(y1), float(x2), float(y2)


def bbox_intersects_disk(
    bbox: tuple[float, float, float, float], cx: float, cy: float, r: float
) -> bool:
    """Necessary (conservative) prefilter: bbox vs the disk's bounding box."""
    x1, y1, x2, y2 = bbox
    return x1 <= cx + r and cx - r <= x2 and y1 <= cy + r and cy - r <= y2


def mask_touches_disk(
    counts: str, width: int, height: int, cx: float, cy: float, r: float
) -> bool:
    """Does any mask pixel lie within ``r`` of (cx, cy)? Boundary inclusive.

    Walks the column-major runs and only materializes pixels whose column
    falls inside the disk's column window, so frames far from the zone
    cost one pass over the counts string and no pixel visits.
    """
    col_lo = max(0, math.floor(cx - r))
    col_hi = min(width - 1, math.ceil(cx + r))
    if col_lo > col_hi:
        return False
    window_start = col_lo * height
    window_end = (col_hi + 1) * height
    r_squared = r * r
    pos = 0
    foreground = False
    for count in (int(part) for part in counts.split(",")):
        run_start, run_end = pos, pos + count
        if run_end <= window_start:
            pos = run_end
            foreground = not foreground
            continue
        if run_start >= window_end:
            break
        if foreground:
            overlap = range(max(run_start, window_start), min(run_end, window_end))
            for index in overlap:
                x, y = divmod(index, height)
                dx = x - cx
                dy = y - cy
                if dx * dx + dy * dy <= r_squared:
                    return True
        pos = run_end
        foreground = not foreground
    return False


def _usable(frame: EventFrame) -> bool:
    """An ok frame with the coordinates and timestamp events need."""
    return (
        frame.status == "ok"
        and frame.time_s is not None
        and frame.center_x is not None
        and frame.center_y is not None
    )


def _in_circle(frame: EventFrame, circle: CircleGeometry) -> bool:
    assert frame.center_x is not None and frame.center_y is not None
    return (
        math.hypot(frame.center_x - circle.cx, frame.center_y - circle.cy) <= circle.r
    )


def compute_trial_events(
    video_id: str,
    frames: Sequence[EventFrame],
    pool: CircleGeometry | None = None,
    platform: CircleGeometry | None = None,
) -> list[MetricRow]:
    """Compute the five event metrics for one trial (video), docs/10 v1.

    Always returns exactly five rows in a fixed order; when an event
    cannot be decided the row carries a ``calc_status`` reason and a NULL
    value — an undecidable or absent event is data, never a guess.
    """
    ordered = sorted(frames, key=lambda frame: frame.frame_idx)
    usable = [frame for frame in ordered if _usable(frame)]
    total_frames = len(frames)
    ok_frames = len(usable)
    # _usable already guarantees time_s is not None; the filter keeps mypy
    # aware of it for the min/max below.
    times = [frame.time_s for frame in usable if frame.time_s is not None]
    duration_s = max(times) - min(times) if times else None

    def row(metric: MetricName, value: float | None, status: str) -> MetricRow:
        definition = METRIC_DEFINITIONS[metric]
        return MetricRow(
            video_id=video_id,
            metric=metric,
            algo_version=ALGO_VERSION_EVENTS,
            value=value,
            unit=definition.unit,
            calc_status=status,
            ok_frames=ok_frames,
            total_frames=total_frames,
            duration_s=duration_s,
            definition=definition.definition,
        )

    if not ordered:
        return [
            row(metric, None, STATUS_NO_FRAMES)
            for metric in (
                FIRST_DETECTION_S,
                WATER_ENTRY_S,
                PLATFORM_CONTACT_S,
                MOUNT_S,
                ESCAPE_LATENCY_S,
            )
        ]
    if not usable:
        return [
            row(metric, None, STATUS_NO_OK_FRAMES)
            for metric in (
                FIRST_DETECTION_S,
                WATER_ENTRY_S,
                PLATFORM_CONTACT_S,
                MOUNT_S,
                ESCAPE_LATENCY_S,
            )
        ]

    # 首次出现: the first ok frame is the latency clock's start.
    first_detection_time = usable[0].time_s

    # 首次入水: first ok frame with the center inside the pool circle.
    water_entry_time: float | None = None
    water_entry_status = STATUS_OK
    if pool is None or pool.r <= 0:
        water_entry_status = STATUS_MISSING_POOL_PARAMS
    else:
        for frame in usable:
            if _in_circle(frame, pool):
                water_entry_time = frame.time_s
                break
        if water_entry_time is None:
            water_entry_status = STATUS_NO_ENTRY

    # 碰台: first ok frame whose body mask touches the platform circle
    # (user ruling 2026-10-13). bbox prefilter, then the RLE decides; a
    # candidate frame without RLE makes contact undecidable → defensive.
    contact_time: float | None = None
    contact_status = STATUS_OK
    if platform is None or platform.r <= 0:
        contact_status = STATUS_MISSING_PLATFORM_PARAMS
    else:
        decided = False
        for frame in usable:
            if frame.mask_bbox is not None and not bbox_intersects_disk(
                frame.mask_bbox, platform.cx, platform.cy, platform.r
            ):
                continue
            if (
                frame.mask_rle_counts is None
                or frame.mask_width is None
                or frame.mask_height is None
            ):
                contact_status = STATUS_MISSING_MASK_PARAMS
                decided = True
                break
            if mask_touches_disk(
                frame.mask_rle_counts,
                frame.mask_width,
                frame.mask_height,
                platform.cx,
                platform.cy,
                platform.r,
            ):
                contact_time = frame.time_s
                decided = True
                break
        if not decided:
            contact_status = STATUS_NO_CONTACT

    # 有效上台: the center stays inside the platform circle for
    # MOUNT_MIN_FRAMES consecutive ok frames. Present-but-unusable rows
    # (miss/coord) break the stay; absent frame numbers (detection loss)
    # do not — docs/10 continuity rule.
    mount_time: float | None = None
    mount_status = STATUS_OK
    if platform is None or platform.r <= 0:
        mount_status = STATUS_MISSING_PLATFORM_PARAMS
    else:
        run = 0
        run_start_time: float | None = None
        for frame in ordered:
            if not _usable(frame):
                run = 0
                continue
            if _in_circle(frame, platform):
                if run == 0:
                    run_start_time = frame.time_s
                run += 1
                if run >= MOUNT_MIN_FRAMES:
                    mount_time = run_start_time
                    break
            else:
                run = 0
        if mount_time is None:
            mount_status = STATUS_NO_MOUNT
    latency = (
        mount_time - first_detection_time
        if mount_time is not None and first_detection_time is not None
        else None
    )

    return [
        row(FIRST_DETECTION_S, first_detection_time, STATUS_OK),
        row(WATER_ENTRY_S, water_entry_time, water_entry_status),
        row(PLATFORM_CONTACT_S, contact_time, contact_status),
        row(MOUNT_S, mount_time, mount_status),
        row(ESCAPE_LATENCY_S, latency, mount_status),
    ]
