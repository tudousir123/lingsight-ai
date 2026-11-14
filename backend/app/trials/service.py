"""Single-trial flow service: bundle assembly and review persistence.

Routes stay thin; this module owns the invariants that browser tests cannot
safely prove (#18 测试决策):

- every bundle carries one trial identity and per-field provenance/missing
  reasons — never a fallback to another trial's materials;
- a preparation review binds to the source-version fingerprint of exactly
  the materials it acknowledged, and final confirmation is gated
  server-side on all four acknowledgements plus the required materials;
- the manual review state is kept strictly separate from the inference
  ``qc_status`` marker.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol, cast

from sqlmodel import Session, select

from app.models import TrialReview, User
from app.trials import derive
from app.trials.schemas import (
    GeometryBundle,
    MediaInfo,
    MetricValue,
    PreparationPublic,
    ResultPublic,
    ResultStates,
    ReviewPublic,
    ReviewStateName,
    ReviewUpdate,
    TrackBundle,
    TrialSummary,
    UnavailableMetric,
)

#: Calibration-gated metrics that must never show a converted value without
#: a validated px→cm calibration (#18 决策；语义层 pool_r 注记)。
CALIBRATION_GATED_METRICS = [
    UnavailableMetric(
        metric="dist_cm", reason="缺少有效的空间标定（px→cm），不显示换算值"
    ),
    UnavailableMetric(
        metric="speed_cm_s", reason="缺少有效的空间标定（px→cm），不显示换算值"
    ),
]


class TrialNotFound(Exception):
    """Trial does not exist in this experiment."""


class SourceVersionConflict(Exception):
    """Materials changed since the client loaded them."""


class ConfirmationRejected(Exception):
    """Final confirmation requirements not met."""

    def __init__(self, detail: str) -> None:
        self.detail = detail
        super().__init__(detail)


class TrialCatalogProtocol(Protocol):
    def list_experiments(
        self, allowed_ids: set[str] | None
    ) -> list[dict[str, object]]: ...

    def list_trials(
        self,
        experiment_id: str,
        *,
        group_name: str | None,
        mouse_id: str | None,
        phase: str | None,
        date_dir: str | None,
        skip: int,
        limit: int,
    ) -> tuple[list[dict[str, object]], int]: ...

    def get_trial(
        self, experiment_id: str, trial_id: str
    ) -> dict[str, object] | None: ...


class TrialAssetsProtocol(Protocol):
    def get_media(self, experiment_id: str, trial_id: str) -> MediaInfo: ...

    def get_geometry(self, experiment_id: str, trial_id: str) -> GeometryBundle: ...

    def get_track(self, experiment_id: str, trial_id: str) -> TrackBundle: ...

    def get_metrics(self, experiment_id: str, trial_id: str) -> list[MetricValue]: ...

    def get_qc_status(self, experiment_id: str, trial_id: str) -> str | None: ...

    def media_path(
        self, experiment_id: str, trial_id: str, kind: str
    ) -> Path | None: ...


def load_trial(
    catalog: TrialCatalogProtocol, experiment_id: str, trial_id: str
) -> dict[str, object]:
    """Fetch the trial summary or raise TrialNotFound."""
    row = catalog.get_trial(experiment_id, trial_id)
    if row is None:
        raise TrialNotFound(trial_id)
    return row


@dataclass(frozen=True)
class _TrialMaterials:
    trial: TrialSummary
    video: MediaInfo
    geometry: GeometryBundle
    track: TrackBundle
    source_version: str


def _load_materials(
    catalog: TrialCatalogProtocol,
    assets: TrialAssetsProtocol,
    experiment_id: str,
    trial_id: str,
) -> _TrialMaterials:
    trial = TrialSummary.model_validate(load_trial(catalog, experiment_id, trial_id))
    video = assets.get_media(experiment_id, trial_id)
    geometry = assets.get_geometry(experiment_id, trial_id)
    track = assets.get_track(experiment_id, trial_id)
    return _TrialMaterials(
        trial,
        video,
        geometry,
        track,
        derive.source_version(trial_id, video, geometry, track),
    )


def preparation_bundle(
    catalog: TrialCatalogProtocol,
    assets: TrialAssetsProtocol,
    session: Session,
    current_user: User,
    experiment_id: str,
    trial_id: str,
) -> PreparationPublic:
    """Everything the preparation page needs, in one trial's context."""
    materials = _load_materials(catalog, assets, experiment_id, trial_id)
    metrics = assets.get_metrics(experiment_id, trial_id)
    review = _find_review(
        session, current_user.id, experiment_id, trial_id, materials.source_version
    )
    return PreparationPublic(
        trial=materials.trial,
        video=materials.video,
        geometry=materials.geometry,
        tracking=materials.track,
        metrics=metrics,
        metric_unavailable=CALIBRATION_GATED_METRICS,
        review=_review_public(review, current_user.email),
        source_version=materials.source_version,
    )


def result_bundle(
    catalog: TrialCatalogProtocol,
    assets: TrialAssetsProtocol,
    session: Session,
    current_user: User,
    experiment_id: str,
    trial_id: str,
) -> ResultPublic:
    """Offline result of the same trial; missing pieces stay explicit."""
    materials = _load_materials(catalog, assets, experiment_id, trial_id)
    metrics = assets.get_metrics(experiment_id, trial_id)
    qc_status = assets.get_qc_status(experiment_id, trial_id)
    review = _find_review(
        session, current_user.id, experiment_id, trial_id, materials.source_version
    )
    frames = materials.track.frames if materials.track.status == "available" else []
    candidate = derive.platform_entry_candidate(frames, materials.geometry)
    states = ResultStates(
        inference_available=materials.track.status == "available",
        artifact_mode=materials.track.source,
        qc_status=qc_status,
        preparation_review=_review_public(review, current_user.email),
        result_quality="not_started",
    )
    return ResultPublic(
        trial=materials.trial,
        video=materials.video,
        geometry=materials.geometry,
        track=materials.track,
        metrics=metrics,
        metric_unavailable=CALIBRATION_GATED_METRICS,
        states=states,
        platform_entry_candidate=candidate,
        source_version=materials.source_version,
    )


def save_review(
    session: Session,
    current_user: User,
    experiment_id: str,
    trial_id: str,
    update: ReviewUpdate,
    *,
    catalog: TrialCatalogProtocol,
    assets: TrialAssetsProtocol,
) -> ReviewPublic:
    """Persist a draft or final review, enforcing the server-side gates.

    - version gate: the submitted fingerprint must match the current
      materials (409-equivalent) so a stale tab cannot confirm new data;
    - final gate: all four acknowledgements plus every required material
      (video, pool, markers, platform, tracking) must be available.
    """
    # Lock a row that already exists even for a first review. Locking only a
    # missing review cannot serialize inserts at MySQL READ COMMITTED. Keep
    # read/check/write together so a concurrent draft cannot undo confirmation.
    session.exec(
        select(User.id).where(User.id == current_user.id).with_for_update()
    ).one()
    # A request may have waited for the lock while materials changed. Read and
    # validate them after the wait rather than accepting a stale fingerprint.
    materials = _load_materials(catalog, assets, experiment_id, trial_id)
    current_version = materials.source_version
    if update.source_version != current_version:
        raise SourceVersionConflict(
            "被核对的素材已更新，请刷新页面后按最新素材重新核对"
        )
    existing = _find_review(
        session, current_user.id, experiment_id, trial_id, current_version
    )
    if existing is not None and existing.state == "confirmed":
        # A final confirmation is a terminal record (reviewer + timestamp):
        # repeating the same confirmation is idempotent, anything else is
        # rejected instead of silently clearing confirmed_at.
        same = (
            update.state == "confirmed"
            and update.boundary_ok == existing.boundary_ok
            and update.markers_ok == existing.markers_ok
            and update.platform_ok == existing.platform_ok
            and update.tracking_ok == existing.tracking_ok
        )
        if not same:
            raise ConfirmationRejected("该试次已最终确认，不能再改写核对记录")
        saved = _review_public(existing, current_user.email)
        assert saved is not None
        return saved
    if update.state == "confirmed":
        acked = [
            update.boundary_ok,
            update.markers_ok,
            update.platform_ok,
            update.tracking_ok,
        ]
        if not all(acked):
            raise ConfirmationRejected(
                f"四项人工核对未全部通过（{sum(acked)}/4），不能完成最终确认"
            )
        missing = _missing_materials(
            materials.video, materials.geometry, materials.track
        )
        if missing:
            raise ConfirmationRejected(
                "缺少必要素材，不能完成最终确认：" + "、".join(missing)
            )
    review = existing
    now = datetime.now(UTC)
    if review is None:
        review = TrialReview(
            user_id=current_user.id,
            experiment_id=experiment_id,
            trial_id=trial_id,
            source_version=current_version,
        )
    review.source_version = current_version
    review.boundary_ok = update.boundary_ok
    review.markers_ok = update.markers_ok
    review.platform_ok = update.platform_ok
    review.tracking_ok = update.tracking_ok
    review.state = update.state
    review.confirmed_at = now if update.state == "confirmed" else None
    review.updated_at = now
    session.add(review)
    session.commit()
    session.refresh(review)
    saved = _review_public(review, current_user.email)
    assert saved is not None
    return saved


def _missing_materials(
    video: MediaInfo, geometry: GeometryBundle, track: TrackBundle
) -> list[str]:
    missing: list[str] = []
    if video.status != "available":
        missing.append("试次视频")
    if geometry.pool.status != "available":
        missing.append("水池边界几何")
    if geometry.markers.status != "available":
        missing.append("标志物标注")
    if geometry.platform.status != "available":
        missing.append("基准平台标定")
    if track.status != "available":
        missing.append("离线追踪结果")
    return missing


def _find_review(
    session: Session,
    user_id: uuid.UUID,
    experiment_id: str,
    trial_id: str,
    source_version: str,
) -> TrialReview | None:
    return session.exec(
        select(TrialReview).where(
            TrialReview.user_id == user_id,
            TrialReview.experiment_id == experiment_id,
            TrialReview.trial_id == trial_id,
            TrialReview.source_version == source_version,
        )
    ).first()


def _review_public(
    review: TrialReview | None, reviewer_email: str
) -> ReviewPublic | None:
    if review is None:
        return None
    return ReviewPublic(
        state=cast(ReviewStateName, review.state),
        boundary_ok=review.boundary_ok,
        markers_ok=review.markers_ok,
        platform_ok=review.platform_ok,
        tracking_ok=review.tracking_ok,
        reviewer_email=reviewer_email,
        source_version=review.source_version,
        created_at=_utc(review.created_at),
        updated_at=_utc(review.updated_at),
        confirmed_at=_utc(review.confirmed_at) if review.confirmed_at else None,
    )


def _utc(value: datetime | None) -> datetime:
    if value is None:
        raise ValueError("review timestamp is missing")
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value
