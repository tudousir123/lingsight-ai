"""Resolve one trial's preparation/result materials from the research side.

Everything here is server-side: the browser never touches the research
database. Bounded, parameterized queries go through the shared read-only
account; media and marker files are resolved from configured local roots.
Missing materials become explicit ``status="missing"`` + reason — the
preparation and result pages must never fall back to another trial's video,
track or chart.
"""

import json
from pathlib import Path
from typing import Any, Literal, cast

from app.core.research import ResearchDatabaseSettings
from app.metrics.definitions import PLATFORM_RADIUS_PX
from app.trials import derive
from app.trials.catalog import read_rows
from app.trials.derive import build_track_bundle
from app.trials.media import ResearchTrialMedia, describe_media
from app.trials.schemas import (
    REASON_NO_POOL,
    REASON_NO_TRACK,
    GeometryBundle,
    MarkersGeometry,
    MarkerShape,
    MediaInfo,
    MetricValue,
    PlatformGeometry,
    PoolGeometry,
    TrackBundle,
    TrackFrame,
)
from app.trials.settings import TrialsSettings

VIDEO_ROW_SELECT = (
    "SELECT video_id, source_video_path, fps, width, height, "
    "pool_cx, pool_cy, pool_r, pool_source, artifact_mode, date_dir "
    "FROM videos WHERE dataset_id = %s AND video_id = %s LIMIT 1"
)


class ResearchTrialAssets:
    """Materials for one trial: media files, geometry, track, metrics, QC."""

    def __init__(
        self,
        research: ResearchDatabaseSettings,
        trials: TrialsSettings,
    ) -> None:
        self.research = research
        self.trials = trials
        self.media = ResearchTrialMedia(trials)
        # Instances are constructed by the request dependency, never cached.
        # Media/geometry/track in one response use the same video metadata.
        self._video_rows: dict[tuple[str, str], dict[str, Any]] = {}

    # --- helpers ---------------------------------------------------------------

    def _read(self, sql: str, params: tuple[Any, ...]) -> list[dict[str, Any]]:
        return read_rows(self.research, sql, params)

    def _video_row(self, experiment_id: str, trial_id: str) -> dict[str, Any]:
        key = (experiment_id, trial_id)
        if key not in self._video_rows:
            rows = self._read(VIDEO_ROW_SELECT, key)
            self._video_rows[key] = rows[0] if rows else {}
        return self._video_rows[key]

    def get_media(self, experiment_id: str, trial_id: str) -> MediaInfo:
        row = self._video_row(experiment_id, trial_id)
        return describe_media(
            experiment_id,
            trial_id,
            source=self.media.source_path(row.get("source_video_path")),
            overlay=self.media.overlay_path(trial_id),
            missing_reason="源视频文件在本机不可访问（未挂载或路径未配置）",
        )

    def get_geometry(self, experiment_id: str, trial_id: str) -> GeometryBundle:
        row = self._video_row(experiment_id, trial_id)
        pool = self._pool(row)
        markers = self._markers()
        platform = self._platform(row)
        return GeometryBundle(pool=pool, markers=markers, platform=platform)

    def _pool(self, row: dict[str, Any]) -> PoolGeometry:
        if (
            row.get("pool_cx") is None
            or row.get("pool_cy") is None
            or row.get("pool_r") is None
        ):
            return PoolGeometry(status="missing", reason=REASON_NO_POOL)
        return PoolGeometry(
            status="available",
            cx=_as_float(row.get("pool_cx")),
            cy=_as_float(row.get("pool_cy")),
            r=_as_float(row.get("pool_r")),
            source=derive.pool_source_label(row.get("pool_source")),
        )

    def _markers(self) -> MarkersGeometry:
        path = self.trials.TRIALS_SCENE_MARKERS_JSON
        if path is None:
            return MarkersGeometry(status="missing", reason="未配置标志物场景标注文件")
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except OSError, json.JSONDecodeError:
            return MarkersGeometry(
                status="missing", reason=f"标志物场景标注文件不可读：{path.name}"
            )
        shapes = [MarkerShape.model_validate(item) for item in data.get("shapes", [])]
        if not shapes:
            return MarkersGeometry(status="missing", reason="标志物场景标注中没有图形")
        return MarkersGeometry(
            status="available",
            shapes=shapes,
            source=data.get("source", "人工 LabelMe 场景标注"),
        )

    def _platform(self, row: dict[str, Any]) -> PlatformGeometry:
        date_dir = row.get("date_dir")
        if date_dir is None:
            return PlatformGeometry(status="missing", reason="该试次没有实验日期")
        rows = self._read(
            "SELECT day_label, plat_cx_consensus, plat_cy_consensus, source_file "
            "FROM platform_positions WHERE day_label = %s LIMIT 1",
            (date_dir,),
        )
        if not rows or rows[0].get("plat_cx_consensus") is None:
            return PlatformGeometry(
                status="missing",
                reason=f"实验日期 {date_dir} 没有平台标定记录",
            )
        first = rows[0]
        return PlatformGeometry(
            status="available",
            cx=_as_float(first.get("plat_cx_consensus")),
            cy=_as_float(first.get("plat_cy_consensus")),
            r=PLATFORM_RADIUS_PX,
            day_label=str(first.get("day_label")),
            source=(
                "E1 报告共识坐标（成像/行为双法交叉，"
                f"{Path(str(first.get('source_file') or 'platform_coordinates.csv')).name}）"
            ),
        )

    def get_track(self, experiment_id: str, trial_id: str) -> TrackBundle:
        row = self._video_row(experiment_id, trial_id)
        if not row:
            return TrackBundle(status="missing", reason="试次不存在")
        rows = self._read(
            "SELECT frame_idx, time_s, center_x, center_y, head_x, head_y, "
            "tail_x, tail_y, status FROM v_query_frame_predictions "
            "WHERE video_id = %s ORDER BY frame_idx",
            (trial_id,),
        )
        if not rows:
            return TrackBundle(
                status="missing",
                reason=REASON_NO_TRACK,
            )
        frames = [_frame(item) for item in rows]
        fps = _as_float(row.get("fps"))
        assert fps is not None
        return build_track_bundle(
            frames=frames,
            fps=fps,
            width=int(row["width"]),
            height=int(row["height"]),
            source=str(row.get("artifact_mode") or "") or None,
        )

    def get_metrics(self, experiment_id: str, trial_id: str) -> list[MetricValue]:
        rows = self._read(
            "SELECT metric, value, unit, algo_version, calc_status, ok_frames, "
            "total_frames, duration_s, calculated_at FROM trial_metrics "
            "WHERE video_id = %s",
            (trial_id,),
        )
        return [MetricValue.model_validate(item) for item in rows]

    def get_qc_status(self, experiment_id: str, trial_id: str) -> str | None:
        rows = self._read(
            "SELECT qc_status FROM qc_summary WHERE video_id = %s LIMIT 1",
            (trial_id,),
        )
        return str(rows[0]["qc_status"]) if rows else None

    def media_path(self, experiment_id: str, trial_id: str, kind: str) -> Path | None:
        if kind == "overlay":
            return self.media.overlay_path(trial_id)
        if kind == "source":
            row = self._video_row(experiment_id, trial_id)
            return self.media.source_path(row.get("source_video_path"))
        return None


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    return float(value)


def _frame(row: dict[str, Any]) -> TrackFrame:
    center = _point(row.get("center_x"), row.get("center_y"))
    head = _point(row.get("head_x"), row.get("head_y"))
    tail = _point(row.get("tail_x"), row.get("tail_y"))
    return TrackFrame(
        frame=int(row["frame_idx"]),
        time_s=_as_float(row.get("time_s")),
        status=cast(Literal["ok", "miss", "coord"], str(row.get("status") or "miss")),
        center=center,
        head=head,
        tail=tail,
    )


def _point(x: Any, y: Any) -> list[float] | None:
    if x is None or y is None:
        return None
    return [float(x), float(y)]
