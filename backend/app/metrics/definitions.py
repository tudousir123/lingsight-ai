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

# ADR-0006 / docs/10 (ticket #6): the event batch — platform zone = the
# day's consensus position with radius 46 px, platform contact decided by
# the body mask (user ruling 2026-10-13), effective mounting = center
# staying ≥ MOUNT_MIN_FRAMES consecutive ok frames inside the zone.
ALGO_VERSION_EVENTS = "v1-platformzone-46px-maskcontact-mount500ms"
PLATFORM_RADIUS_PX = 46.0
MOUNT_MIN_FRAMES = 15  # ≥ 0.5 s at 30 fps, counted in ok frames (docs/10)

MetricName = Literal[
    "dist_px",
    "speed_px",
    "valid_kp_ratio",
    "in_pool_ratio",
    "first_detection_s",
    "water_entry_s",
    "platform_contact_s",
    "mount_s",
    "escape_latency_s",
]

DIST_PX: MetricName = "dist_px"
SPEED_PX: MetricName = "speed_px"
VALID_KP_RATIO: MetricName = "valid_kp_ratio"
IN_POOL_RATIO: MetricName = "in_pool_ratio"
FIRST_DETECTION_S: MetricName = "first_detection_s"
WATER_ENTRY_S: MetricName = "water_entry_s"
PLATFORM_CONTACT_S: MetricName = "platform_contact_s"
MOUNT_S: MetricName = "mount_s"
ESCAPE_LATENCY_S: MetricName = "escape_latency_s"

# calc_status values — why a row has (or lacks) a value.
STATUS_OK = "ok"
STATUS_NO_FRAMES = "no_frames"
STATUS_NO_OK_FRAMES = "no_ok_frames"
STATUS_INSUFFICIENT_OK_FRAMES = "insufficient_ok_frames"
STATUS_MISSING_POOL_PARAMS = "missing_pool_params"
# Event batch (ADR-0006): defensive + honest-absence states.
STATUS_MISSING_PLATFORM_PARAMS = "missing_platform_params"
STATUS_MISSING_MASK_PARAMS = "missing_mask_params"
STATUS_NO_ENTRY = "no_entry"  # center never entered the pool circle
STATUS_NO_CONTACT = "no_contact"  # mask never touched the platform circle
STATUS_NO_MOUNT = "no_mount"  # no qualifying stay — a failed trial is data


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
    FIRST_DETECTION_S: MetricDefinition(
        metric=FIRST_DETECTION_S,
        unit="s",
        definition=(
            "首次出现（docs/10）：首个 status='ok' 且中心/时间非空帧的 time_s，"
            "逃逸潜伏期计时起点"
        ),
    ),
    WATER_ENTRY_S: MetricDefinition(
        metric=WATER_ENTRY_S,
        unit="s",
        definition=(
            "首次入水（docs/10）：中心点首次满足与池心欧氏距离 ≤ pool_r 的 ok 帧"
            " time_s；独立事件，不参与潜伏期计时"
        ),
    ),
    PLATFORM_CONTACT_S: MetricDefinition(
        metric=PLATFORM_CONTACT_S,
        unit="s",
        definition=(
            "碰台（docs/10，2026-10-13 用户裁决 mask 参与）：身体轮廓（COCO 列主序 "
            "RLE 解码）任一像素首次进入平台圈（当日共识坐标，半径 46px）的 ok 帧 "
            "time_s；短暂擦过即算，不要求停留"
        ),
    ),
    MOUNT_S: MetricDefinition(
        metric=MOUNT_S,
        unit="s",
        definition=(
            "有效上台（docs/10）：中心在平台圈内连续停留 ≥15 个连续 ok 帧的合格段"
            "首帧 time_s；miss/coord 帧打断累计，ok 帧号断档（检测丢帧）不打断"
        ),
    ),
    ESCAPE_LATENCY_S: MetricDefinition(
        metric=ESCAPE_LATENCY_S,
        unit="s",
        definition=(
            "逃逸潜伏期（docs/10/ADR-0006）：有效上台时刻 − 首次出现时刻（秒）；"
            "全程无有效上台为 NULL + no_mount（失败试次保留，不编造）"
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
