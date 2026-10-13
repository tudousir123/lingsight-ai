"""Deterministic metric computation (ADR-0003, ticket #4).

The pure seam is "frame rows in → metric rows out": every value below is
hand-computed from a tiny synthetic trial, so the golden CTE in docs/09
(SUM of segment lengths over ok frames, speed = dist / time span) can be
re-derived by eye.
"""

import math

from app.metrics.compute import (
    FrameObservation,
    CircleGeometry,
    compute_trial_metrics,
    polyline_length,
)
from app.metrics.definitions import (
    ALGO_VERSION,
    DIST_PX,
    IN_POOL_RATIO,
    SPEED_PX,
    VALID_KP_RATIO,
)

# --- hand-computed fixture: a 4-point polyline of length 5 + 6 + 4 = 15 px
# over t=0..3 s, plus one miss frame and one coord frame that must be
# excluded from the trajectory (docs/08: coord has a center but no
# head/tail; miss has no coordinates at all).
TRIAL_FRAMES = [
    FrameObservation(0, 0.0, 0.0, 0.0, "ok", 1.0, 2.0, 3.0, 4.0),
    FrameObservation(15, 0.5, 100.0, 100.0, "coord", None, None, None, None),
    # deliberately listed out of frame order: computation must sort by frame_idx
    FrameObservation(90, 3.0, 7.0, 10.0, "ok", 1.0, 2.0, 3.0, 4.0),
    FrameObservation(45, 1.5, None, None, "miss", None, None, None, None),
    FrameObservation(30, 1.0, 3.0, 4.0, "ok", 5.0, 6.0, 7.0, 8.0),
    FrameObservation(60, 2.0, 3.0, 10.0, "ok", 9.0, 10.0, None, None),
]
POOL = CircleGeometry(cx=0.0, cy=0.0, r=5.0)


def rows_by_metric(video_id: str = "trial-x", pool: CircleGeometry | None = POOL):
    rows = compute_trial_metrics(video_id, TRIAL_FRAMES, pool=pool)
    return {row.metric: row for row in rows}


def test_polyline_length_empty_and_single_point() -> None:
    assert polyline_length([]) == 0.0
    assert polyline_length([(1.5, -2.0)]) == 0.0


def test_polyline_length_is_sum_of_segment_distances() -> None:
    # (0,0)→(3,4)→(3,10)→(7,10) = 5 + 6 + 4
    points = [(0.0, 0.0), (3.0, 4.0), (3.0, 10.0), (7.0, 10.0)]
    assert math.isclose(polyline_length(points), 15.0, abs_tol=1e-12)


def test_dist_px_excludes_miss_and_coord_frames() -> None:
    row = rows_by_metric()[DIST_PX]
    assert row.value is not None
    assert math.isclose(row.value, 15.0, abs_tol=1e-9)
    assert row.unit == "px"
    assert row.calc_status == "ok"
    assert row.algo_version == ALGO_VERSION
    assert row.ok_frames == 4
    assert row.total_frames == 6
    assert row.duration_s is not None and math.isclose(row.duration_s, 3.0)


def test_speed_px_is_dist_over_ok_frame_time_span() -> None:
    row = rows_by_metric()[SPEED_PX]
    assert row.value is not None
    assert math.isclose(row.value, 15.0 / 3.0, abs_tol=1e-9)
    assert row.unit == "px/s"
    assert row.calc_status == "ok"


def test_valid_kp_ratio_counts_complete_keypoint_ok_frames_over_all() -> None:
    # 6 frames total; ok frames with both head and tail complete: idx 0, 30, 90
    # (idx 60 is ok but the tail is missing) → 3/6 = 0.5. Denominator is ALL
    # frames (miss included), matching qc_summary.valid_keypoint_frame_ratio.
    row = rows_by_metric()[VALID_KP_RATIO]
    assert row.value is not None
    assert math.isclose(row.value, 0.5, abs_tol=1e-12)
    assert row.unit == "ratio"
    assert row.calc_status == "ok"


def test_in_pool_ratio_boundary_is_inclusive() -> None:
    # ok-frame centers: (0,0) d=0 in; (3,4) d=5 boundary → in; (3,10) d≈10.44
    # out; (7,10) d≈12.2 out → 2/4.
    row = rows_by_metric()[IN_POOL_RATIO]
    assert row.value is not None
    assert math.isclose(row.value, 0.5, abs_tol=1e-12)
    assert row.unit == "ratio"
    assert row.calc_status == "ok"


def test_every_video_yields_exactly_four_self_describing_rows() -> None:
    rows = compute_trial_metrics("trial-x", TRIAL_FRAMES, pool=POOL)
    assert [row.metric for row in rows] == [
        DIST_PX,
        SPEED_PX,
        VALID_KP_RATIO,
        IN_POOL_RATIO,
    ]
    for row in rows:
        assert row.video_id == "trial-x"
        assert row.unit
        assert row.definition
        assert row.ok_frames == 4
        assert row.total_frames == 6


def test_single_ok_frame_marks_dist_and_speed_insufficient() -> None:
    frames = [
        FrameObservation(0, 0.0, 1.0, 1.0, "ok", 1.0, 1.0, 1.0, 1.0),
        FrameObservation(30, 1.0, None, None, "miss", None, None, None, None),
    ]
    rows = {row.metric: row for row in compute_trial_metrics("t", frames, pool=POOL)}
    assert rows[DIST_PX].value is None
    assert rows[DIST_PX].calc_status == "insufficient_ok_frames"
    assert rows[SPEED_PX].value is None
    assert rows[SPEED_PX].calc_status == "insufficient_ok_frames"
    # ratios remain computable
    assert rows[VALID_KP_RATIO].value == 0.5
    assert rows[IN_POOL_RATIO].value == 1.0


def test_zero_time_span_speed_is_insufficient_but_dist_is_ok() -> None:
    frames = [
        FrameObservation(0, 2.0, 0.0, 0.0, "ok", 1.0, 1.0, 1.0, 1.0),
        FrameObservation(30, 2.0, 3.0, 4.0, "ok", 1.0, 1.0, 1.0, 1.0),
    ]
    rows = {row.metric: row for row in compute_trial_metrics("t", frames, pool=POOL)}
    assert rows[DIST_PX].value == 5.0
    assert rows[SPEED_PX].value is None
    assert rows[SPEED_PX].calc_status == "insufficient_ok_frames"


def test_no_ok_frames_reports_status_not_zero() -> None:
    frames = [
        FrameObservation(0, 0.0, None, None, "miss", None, None, None, None),
        FrameObservation(30, 1.0, None, None, "miss", None, None, None, None),
    ]
    rows = {row.metric: row for row in compute_trial_metrics("t", frames, pool=POOL)}
    for metric in (DIST_PX, SPEED_PX, IN_POOL_RATIO):
        assert rows[metric].value is None
        assert rows[metric].calc_status == "no_ok_frames"
    # valid_kp_ratio stays well-defined: zero valid frames out of two.
    assert rows[VALID_KP_RATIO].value == 0.0
    assert rows[VALID_KP_RATIO].calc_status == "ok"


def test_missing_pool_geometry_only_affects_in_pool_ratio() -> None:
    rows = {
        row.metric: row for row in compute_trial_metrics("t", TRIAL_FRAMES, pool=None)
    }
    assert rows[IN_POOL_RATIO].value is None
    assert rows[IN_POOL_RATIO].calc_status == "missing_pool_params"
    assert rows[DIST_PX].value == 15.0
    assert rows[SPEED_PX].value == 5.0


def test_degenerate_pool_geometry_is_treated_as_missing() -> None:
    rows = {
        row.metric: row
        for row in compute_trial_metrics("t", TRIAL_FRAMES, pool=CircleGeometry(1, 1, 0))
    }
    assert rows[IN_POOL_RATIO].calc_status == "missing_pool_params"


def test_no_frames_at_all_reports_no_frames() -> None:
    rows = compute_trial_metrics("t", [], pool=POOL)
    assert len(rows) == 4
    for row in rows:
        assert row.value is None
        assert row.calc_status == "no_frames"
