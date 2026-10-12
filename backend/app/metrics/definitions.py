"""Metric names, units, and canonical one-line definitions (ADR-0003).

Everything that lands in a `trial_metrics` row — metric key, unit,
definition text, algorithm version — is defined here once. The semantic
layer and the compute pipeline both derive from these constants, so the
science口径 documented in docs/08/docs/09 cannot drift between code and
schema context.
"""

from dataclasses import dataclass
from typing import Literal

# One algo_version = one deterministic snapshot of how metrics are derived
# from frame_predictions. Recomputing with changed logic ships a NEW
# version; old rows are never overwritten in place across versions.
ALGO_VERSION = "v1-polyline-ok-frames"

MetricName = Literal["dist_px", "speed_px", "valid_kp_ratio", "in_pool_ratio"]

DIST_PX: MetricName = "dist_px"
SPEED_PX: MetricName = "speed_px"
VALID_KP_RATIO: MetricName = "valid_kp_ratio"
IN_POOL_RATIO: MetricName = "in_pool_ratio"

# calc_status values — why a row has (or lacks) a value.
STATUS_OK = "ok"
STATUS_NO_FRAMES = "no_frames"
STATUS_NO_OK_FRAMES = "no_ok_frames"
STATUS_INSUFFICIENT_OK_FRAMES = "insufficient_ok_frames"
STATUS_MISSING_POOL_PARAMS = "missing_pool_params"


@dataclass(frozen=True)
class MetricDefinition:
    """Name, unit, and the one-line science definition of a metric."""

    metric: MetricName
    unit: str
    definition: str


METRIC_DEFINITIONS: dict[MetricName, MetricDefinition] = {
    DIST_PX: MetricDefinition(
        metric=DIST_PX,
        unit="px",
        definition=(
            "游泳距离：status='ok' 帧身体中心点按 frame_idx 升序连接的折线总长"
            "（逐段欧氏距离求和；miss/coord 帧不参与，与 docs/09 公共 CTE 同口径）"
        ),
    ),
    SPEED_PX: MetricDefinition(
        metric=SPEED_PX,
        unit="px/s",
        definition=(
            "平均速度：dist_px ÷ ok 帧时间跨度 MAX(time_s)−MIN(time_s)"
            "（跨度为 0 视为不可计算，对应黄金 CTE 的 NULLIF 防 0）"
        ),
    ),
    VALID_KP_RATIO: MetricDefinition(
        metric=VALID_KP_RATIO,
        unit="ratio",
        definition=(
            "有效关键点帧占比：status='ok' 且头/尾关键点坐标齐全的帧数 "
            "÷ 该视频全部帧数（分母含 miss 帧，与 qc_summary."
            "valid_keypoint_frame_ratio 同口径，可交叉核对）"
        ),
    ),
    IN_POOL_RATIO: MetricDefinition(
        metric=IN_POOL_RATIO,
        unit="ratio",
        definition=(
            "在池时间占比：中心点与池心欧氏距离 ≤ pool_r 的 ok 帧数 ÷ ok 帧数"
            "（边界含端点；池参数取 videos.pool_cx/pool_cy/pool_r）"
        ),
    ),
}


@dataclass(frozen=True)
class MetricRow:
    """One long-format `trial_metrics` row.

    PK: (video_id, metric, algo_version) — one value per trial, metric,
    and algorithm version (ADR-0003: recomputation is versioned).
    """

    video_id: str
    metric: str
    algo_version: str
    value: float | None
    unit: str
    calc_status: str
    ok_frames: int
    total_frames: int
    duration_s: float | None
    definition: str
