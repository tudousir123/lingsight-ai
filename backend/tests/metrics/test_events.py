"""Behavioral event detection (ADR-0006 / docs/10, ticket #6).

The pure seam is the same as ticket #4's: frame rows in → metric rows
out, every value hand-computable from a tiny synthetic trial. The RLE
decoder additionally carries a real-database fixture (row
``0805第一次-A3-2-3`` frame 0) whose stored ``mask_bbox_*`` is exact and
whose ``mask_area_px`` is the sub-pixel model estimate — the raster pixel
count runs ~5-20% above it, so the anchors are: bbox exact, area ratio
≤ 1.3 (measured median 1.06 over 3000 frames, 2026-10-13).
"""

import math

from app.metrics.events import (
    EventFrame,
    bbox_intersects_disk,
    compute_trial_events,
    encode_mask_counts,
    mask_area_and_bbox,
    mask_touches_disk,
)
from app.metrics.definitions import (
    ALGO_VERSION_EVENTS,
    ESCAPE_LATENCY_S,
    STATUS_MISSING_POOL_PARAMS,
    FIRST_DETECTION_S,
    MOUNT_S,
    MOUNT_MIN_FRAMES,
    PLATFORM_CONTACT_S,
    PLATFORM_RADIUS_PX,
    STATUS_MISSING_MASK_PARAMS,
    STATUS_MISSING_PLATFORM_PARAMS,
    STATUS_NO_CONTACT,
    STATUS_NO_ENTRY,
    STATUS_NO_MOUNT,
    STATUS_NO_OK_FRAMES,
    STATUS_OK,
    WATER_ENTRY_S,
)
from app.metrics.compute import CircleGeometry

# --- real-database RLE fixture (2026-10-13 snapshot) -----------------------------

REAL_COUNTS = (
    "1503798,10,1428,13,1425,16,1422,18,1420,20,1417,24,1415,25,1414,26,"
    "1413,27,1411,28,1390,50,1386,54,1383,57,1382,58,1381,59,1381,59,1381,"
    "58,1382,58,1382,57,1384,56,1384,55,1387,53,1388,51,1391,48,1395,44,"
    "1398,41,1401,37,1405,34,1408,30,1413,19,2140850"
)
REAL_W, REAL_H = 2560, 1440
REAL_STORED_AREA = 1115.5
REAL_STORED_BBOX = (1044.0, 391.0, 1073.0, 450.0)  # x1, y1, x2, y2
REAL_PIXEL_COUNT = 1185  # sum of one-runs (2026-10-13 hand decode)


def test_real_rle_row_decodes_to_exact_bbox_and_bounded_area() -> None:
    area, x1, y1, x2, y2 = mask_area_and_bbox(REAL_COUNTS, REAL_W, REAL_H)
    assert area == REAL_PIXEL_COUNT
    assert (x1, y1, x2, y2) == REAL_STORED_BBOX
    # the raster count sits just above the sub-pixel model estimate
    assert 1.0 < area / REAL_STORED_AREA <= 1.3


def test_counts_sum_to_width_times_height() -> None:
    total = sum(int(part) for part in REAL_COUNTS.split(","))
    assert total == REAL_W * REAL_H


def test_malformed_counts_are_rejected_not_guessed() -> None:
    import pytest

    short = REAL_COUNTS.rsplit(",", 1)[0]  # drop the trailing run
    with pytest.raises(ValueError, match="sum to"):
        mask_area_and_bbox(short, REAL_W, REAL_H)


# --- synthetic mask helpers -------------------------------------------------------

# Tiny 8x6 image (width=8, height=6), column-major: index = col*6 + row.


def test_encode_then_decode_round_trips() -> None:
    pixels = {(2, 1), (2, 2), (3, 2), (3, 3), (3, 4)}
    counts = encode_mask_counts(pixels, width=8, height=6)
    area, x1, y1, x2, y2 = mask_area_and_bbox(counts, 8, 6)
    assert area == 5
    assert (x1, y1, x2, y2) == (2.0, 1.0, 3.0, 4.0)


def test_mask_touches_disk_semantics() -> None:
    # mask pixel at (4, 3); disk centered (4, 3) r=2 → touches
    counts = encode_mask_counts({(4, 3)}, 8, 6)
    assert mask_touches_disk(counts, 8, 6, 4.0, 3.0, 2.0)
    # boundary is inclusive: pixel exactly r away (dist=2) counts
    assert mask_touches_disk(counts, 8, 6, 6.0, 3.0, 2.0)
    # one pixel further → no touch
    assert not mask_touches_disk(counts, 8, 6, 6.5, 3.0, 2.0)
    # diagonal distance: (4,3)→(6,5) dist ≈ 2.83 > 2
    assert not mask_touches_disk(counts, 8, 6, 6.0, 5.0, 2.0)
    # mask far away in a different column window → skipped, no touch
    far = encode_mask_counts({(0, 0), (0, 1)}, 8, 6)
    assert not mask_touches_disk(far, 8, 6, 7.0, 5.0, 1.5)
    # a multi-column mask: only the pixel near the disk matters
    two_col = encode_mask_counts({(1, 1), (5, 4)}, 8, 6)
    assert mask_touches_disk(two_col, 8, 6, 5.0, 4.0, 0.5)


def test_bbox_prefilter_is_conservative() -> None:
    # overlapping boxes → True (necessary condition only, kept conservative)
    assert bbox_intersects_disk((4.0, 1.0, 7.0, 4.0), 5.0, 3.0, 2.0)
    # clearly disjoint → False
    assert not bbox_intersects_disk((0.0, 0.0, 1.0, 1.0), 5.0, 3.0, 2.0)
    # touching at the edge (x1 == cx + r) → still True (boundary inclusive)
    assert bbox_intersects_disk((7.0, 0.0, 8.0, 6.0), 5.0, 3.0, 2.0)


# --- event detection over a synthetic trial ---------------------------------------

# Geometry: pool = circle(0, 0, r=100); platform = circle(50, 0, r=46).
POOL = CircleGeometry(cx=0.0, cy=0.0, r=100.0)
PLATFORM = CircleGeometry(cx=50.0, cy=0.0, r=PLATFORM_RADIUS_PX)

# The trial: frame 0 outside the platform zone, frames 30..44 inside it.
# Center (50, 0) is the platform center → in-zone; (0, 0) is 50 px away → out.
# Masks: frame 0's mask sits at the animal; frame 30's mask reaches 5 px
# beyond the center toward the platform zone edge. 30 fps → t = idx / 30.


def frame(
    idx: int,
    cx: float,
    cy: float,
    status: str = "ok",
    mask_pixels: frozenset[tuple[int, int]] | None = None,
) -> EventFrame:
    pixels = {(int(cx), int(cy))} if mask_pixels is None else set(mask_pixels)
    # mask image is the whole plane as far as geometry cares; give the
    # encoder a canvas comfortably larger than any coordinate used.
    w = h = 512
    return EventFrame(
        frame_idx=idx,
        time_s=idx / 30.0,
        center_x=cx,
        center_y=cy,
        status=status,
        mask_rle_counts=encode_mask_counts(pixels, w, h) if pixels else None,
        mask_width=w,
        mask_height=h,
    )


def simple_trial() -> list[EventFrame]:
    return [frame(0, 0.0, 0.0)] + [
        frame(i, 50.0, 0.0) for i in range(30, 30 + MOUNT_MIN_FRAMES)
    ]


def rows_for(frames: list[EventFrame], platform: CircleGeometry | None = PLATFORM):
    rows = compute_trial_events("trial-x", frames, pool=POOL, platform=platform)
    return {row.metric: row for row in rows}


def test_first_detection_water_entry_and_latency_on_simple_trial() -> None:
    rows = rows_for(simple_trial())
    first = rows[FIRST_DETECTION_S]
    assert first.value == 0.0 and first.calc_status == STATUS_OK
    # (0,0) is the pool center → water entry at the very first ok frame
    assert rows[WATER_ENTRY_S].value == 0.0
    # frames 30..44 inside the zone: mount = start of the qualifying run
    mount = rows[MOUNT_S]
    assert mount.value == 1.0 and mount.calc_status == STATUS_OK
    latency = rows[ESCAPE_LATENCY_S]
    assert latency.value == 1.0 and latency.unit == "s"
    assert math.isclose(
        latency.value, mount.value - first.value, abs_tol=1e-12
    )


def test_platform_contact_fires_on_mask_touch_not_center() -> None:
    # center (100, 0) is 50 px from the platform center → outside the zone,
    # but its mask includes a pixel at (95, 0), 45 px away → mask touches.
    early = frame(
        15,
        100.0,
        0.0,
        mask_pixels=frozenset({(95, 0), (100, 0)}),
    )
    rows = rows_for([early] + simple_trial())
    contact = rows[PLATFORM_CONTACT_S]
    assert contact.value == 0.5 and contact.calc_status == STATUS_OK
    # contact (0.5 s) strictly before the center even enters the zone (1.0 s)
    assert contact.value < rows[MOUNT_S].value


def test_no_mount_when_stay_is_interrupted_by_a_miss_frame() -> None:
    # 14 in-zone ok frames, one miss frame, then more in-zone frames: the
    # miss breaks the run, so MOUNT_MIN_FRAMES consecutive never accumulates.
    frames = [frame(0, 0.0, 0.0)]
    frames += [frame(i, 50.0, 0.0) for i in range(30, 30 + MOUNT_MIN_FRAMES - 1)]
    frames.append(frame(44, 50.0, 0.0, status="miss"))
    frames += [frame(i, 50.0, 0.0) for i in range(45, 45 + 5)]
    rows = rows_for(frames)
    assert rows[MOUNT_S].value is None
    assert rows[MOUNT_S].calc_status == STATUS_NO_MOUNT
    assert rows[ESCAPE_LATENCY_S].value is None
    assert rows[ESCAPE_LATENCY_S].calc_status == STATUS_NO_MOUNT


def test_frame_index_gap_does_not_break_the_stay() -> None:
    # ok frames 30..43 then 45.. (44 absent entirely = detection loss):
    # the gap is NOT an interruption, so the stay still qualifies.
    frames = [frame(0, 0.0, 0.0)]
    frames += [frame(i, 50.0, 0.0) for i in range(30, 44)]
    frames += [frame(i, 50.0, 0.0) for i in range(45, 45 + 3)]
    rows = rows_for(frames)
    assert rows[MOUNT_S].value == 1.0


def test_out_of_zone_ok_frame_breaks_the_stay() -> None:
    frames = [frame(0, 0.0, 0.0)]
    frames += [frame(i, 50.0, 0.0) for i in range(30, 30 + MOUNT_MIN_FRAMES - 1)]
    frames.append(frame(44, 0.0, 0.0))  # ok but outside the zone
    frames += [frame(i, 50.0, 0.0) for i in range(45, 45 + 5)]
    rows = rows_for(frames)
    assert rows[MOUNT_S].calc_status == STATUS_NO_MOUNT


def test_water_entry_missing_or_never() -> None:
    rows = rows_for(simple_trial(), platform=PLATFORM)
    assert rows[WATER_ENTRY_S].calc_status == STATUS_OK
    # animal never inside the pool circle (pool far away)
    far_pool = CircleGeometry(cx=1000.0, cy=1000.0, r=10.0)
    rows = {
        row.metric: row
        for row in compute_trial_events("t", simple_trial(), pool=far_pool, platform=PLATFORM)
    }
    assert rows[WATER_ENTRY_S].value is None
    assert rows[WATER_ENTRY_S].calc_status == STATUS_NO_ENTRY
    # pool geometry absent → defensive status, other events unaffected
    rows = {
        row.metric: row
        for row in compute_trial_events("t", simple_trial(), pool=None, platform=PLATFORM)
    }
    assert rows[WATER_ENTRY_S].calc_status == STATUS_MISSING_POOL_PARAMS
    assert rows[MOUNT_S].value == 1.0


def test_no_contact_when_mask_never_reaches_the_zone() -> None:
    # every mask pixel stays ≥ 47 px from the platform center
    frames = [frame(0, 0.0, 0.0, mask_pixels=frozenset({(0, 0), (1, 1)}))]
    frames += [
        frame(i, 0.0, 0.0, mask_pixels=frozenset({(0, 0)}))
        for i in range(30, 30 + MOUNT_MIN_FRAMES)
    ]
    # platform at (50, 0) with nothing ever inside it → also no mount
    rows = rows_for(frames)
    assert rows[PLATFORM_CONTACT_S].value is None
    assert rows[PLATFORM_CONTACT_S].calc_status == STATUS_NO_CONTACT
    assert rows[MOUNT_S].calc_status == STATUS_NO_MOUNT


def test_missing_platform_geometry_is_defensive() -> None:
    rows = rows_for(simple_trial(), platform=None)
    for metric in (PLATFORM_CONTACT_S, MOUNT_S, ESCAPE_LATENCY_S):
        assert rows[metric].value is None
        assert rows[metric].calc_status == STATUS_MISSING_PLATFORM_PARAMS
    # events that do not need the platform still compute
    assert rows[FIRST_DETECTION_S].value == 0.0
    assert rows[WATER_ENTRY_S].value == 0.0


def test_missing_mask_on_a_candidate_frame_is_defensive() -> None:
    # frame 15's bbox passes the platform prefilter but the RLE is absent:
    # contact is undecidable → missing_mask_params, never guessed.
    candidate = EventFrame(
        frame_idx=15,
        time_s=0.5,
        center_x=90.0,
        center_y=0.0,
        status="ok",
        mask_rle_counts=None,
        mask_width=512,
        mask_height=512,
    )
    rows = rows_for([candidate] + simple_trial())
    assert rows[PLATFORM_CONTACT_S].value is None
    assert rows[PLATFORM_CONTACT_S].calc_status == STATUS_MISSING_MASK_PARAMS


def test_no_ok_frames_reports_no_ok_frames() -> None:
    frames = [
        frame(0, 0.0, 0.0, status="miss"),
        frame(30, 0.0, 0.0, status="miss"),
    ]
    rows = rows_for(frames)
    assert len(rows) == 5
    for row in rows.values():
        assert row.value is None
        assert row.calc_status == STATUS_NO_OK_FRAMES


def test_rows_are_self_describing_under_the_event_version() -> None:
    rows = compute_trial_events("trial-x", simple_trial(), pool=POOL, platform=PLATFORM)
    assert [row.metric for row in rows] == [
        FIRST_DETECTION_S,
        WATER_ENTRY_S,
        PLATFORM_CONTACT_S,
        MOUNT_S,
        ESCAPE_LATENCY_S,
    ]
    for row in rows:
        assert row.video_id == "trial-x"
        assert row.algo_version == ALGO_VERSION_EVENTS
        assert row.unit == "s"
        assert row.definition
        assert row.ok_frames == MOUNT_MIN_FRAMES + 1
        assert row.total_frames == MOUNT_MIN_FRAMES + 1
