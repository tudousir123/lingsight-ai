"""Response and request models for the single-trial analysis flow (#20-#23).

Every bundle carries the same trial identity plus explicit provenance for
each material. ``status`` fields are tri-state (available / missing) with a
``reason`` whenever something is missing — the UI never guesses a fallback.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

MediaKind = Literal["source", "overlay"]
Availability = Literal["available", "missing"]
FrameStatus = Literal["ok", "miss", "coord"]
ReviewStateName = Literal["draft", "confirmed"]


#: Shared missing-material reasons: the fixture store must answer with the
#: exact same words as the research store, so they live next to the schemas.
REASON_NO_TRACK = "该试次尚无离线推理结果（未接入模型推理，不代填示例轨迹）"
REASON_NO_POOL = "该试次没有水池几何参数"


class ExperimentSummary(BaseModel):
    id: str
    name: str
    trial_count: int


class ExperimentsPublic(BaseModel):
    data: list[ExperimentSummary]


class TrialSummary(BaseModel):
    id: str
    experiment_id: str
    video_name: str
    group_name: str
    mouse_id: str
    phase: str
    date_dir: str
    training_day: int | None
    session_no: int
    session_label: str
    trial_no: str
    media_available: bool
    result_available: bool


class TrialsPublic(BaseModel):
    data: list[TrialSummary]
    count: int


class MediaInfo(BaseModel):
    """Playable video for a trial, resolved server-side (no direct DB access)."""

    kind: MediaKind
    status: Availability
    url: str | None = None
    reason: str | None = None
    fingerprint: str | None = Field(
        default=None,
        description="媒体内容 SHA-256；用于人工核对记录绑定素材版本",
    )


class PoolGeometry(BaseModel):
    status: Availability
    cx: float | None = None
    cy: float | None = None
    r: float | None = None
    source: str | None = None
    reason: str | None = None


class MarkerShape(BaseModel):
    label: str
    points: list[list[float]]


class MarkersGeometry(BaseModel):
    status: Availability
    shapes: list[MarkerShape] | None = None
    source: str | None = None
    reason: str | None = None


class PlatformGeometry(BaseModel):
    """Hidden-platform reference from experiment metadata, never pixels."""

    status: Availability
    cx: float | None = None
    cy: float | None = None
    r: float | None = None
    day_label: str | None = None
    source: str | None = None
    reason: str | None = None


class GeometryBundle(BaseModel):
    pool: PoolGeometry
    markers: MarkersGeometry
    platform: PlatformGeometry


class TrackFrame(BaseModel):
    frame: int
    time_s: float | None = None
    status: FrameStatus
    center: list[float] | None = None
    head: list[float] | None = None
    tail: list[float] | None = None


class TrackBundle(BaseModel):
    """Offline tracking result of this trial (no interpolation of gaps)."""

    status: Availability
    source: str | None = Field(
        default=None, description="推理产出标记（videos.artifact_mode）"
    )
    fps: float | None = None
    width: int | None = None
    height: int | None = None
    frames: list[TrackFrame] = []
    speed: list[float | None] = Field(
        default=[], description="逐帧速度 px/s；miss/端部窗口帧为 null"
    )
    valid_frames: int = 0
    kp_frames: int = 0
    reason: str | None = None


class MetricValue(BaseModel):
    """One persisted trial-level metric row (never re-derived client-side)."""

    metric: str
    value: float | None = None
    unit: str | None = None
    algo_version: str
    calc_status: str
    ok_frames: int | None = None
    total_frames: int | None = None
    duration_s: float | None = None
    calculated_at: datetime | None = None


class UnavailableMetric(BaseModel):
    metric: str
    reason: str


class ReviewPublic(BaseModel):
    """Persisted human preparation review of one trial (not inference QC)."""

    state: ReviewStateName
    boundary_ok: bool
    markers_ok: bool
    platform_ok: bool
    tracking_ok: bool
    reviewer_email: str
    source_version: str
    created_at: datetime
    updated_at: datetime
    confirmed_at: datetime | None = None


class ReviewUpdate(BaseModel):
    source_version: str
    boundary_ok: bool = False
    markers_ok: bool = False
    platform_ok: bool = False
    tracking_ok: bool = False
    state: ReviewStateName


class ResultStates(BaseModel):
    """Three distinct states that must not be conflated (#18 决策)."""

    inference_available: bool
    artifact_mode: str | None = None
    qc_status: str | None = Field(
        default=None,
        description="推理质检标记（语义待确认，不代表人工通过）",
    )
    preparation_review: ReviewPublic | None = None
    result_quality: Literal["not_started"] = "not_started"


class PlatformEntryCandidate(BaseModel):
    frame: int
    time_s: float
    note: str = "中心点首次进入平台标定圆——仅几何候选，不构成有效上台判定"


class PreparationPublic(BaseModel):
    trial: TrialSummary
    video: MediaInfo
    geometry: GeometryBundle
    tracking: TrackBundle
    metrics: list[MetricValue] = []
    metric_unavailable: list[UnavailableMetric] = []
    review: ReviewPublic | None = None
    source_version: str


class ResultPublic(BaseModel):
    trial: TrialSummary
    video: MediaInfo
    geometry: GeometryBundle
    track: TrackBundle
    metrics: list[MetricValue] = []
    metric_unavailable: list[UnavailableMetric] = []
    states: ResultStates
    platform_entry_candidate: PlatformEntryCandidate | None = None
    source_version: str
