"""Synthetic trial fixture: catalog + assets from one committed JSON (#20-#23).

The fixture is fully non-sensitive (synthetic swim path, generated video) and
backs the Playwright browser flow and FastAPI route tests where the research
database is unavailable. It implements the same interfaces as the research
stores, including per-field missing states (trial without track, without
media, without platform or markers).
"""

import json
from pathlib import Path
from typing import Any

from app.trials.derive import build_track_bundle, pool_source_label
from app.trials.media import describe_media
from app.trials.schemas import (
    REASON_NO_POOL,
    REASON_NO_TRACK,
    GeometryBundle,
    MarkersGeometry,
    MediaInfo,
    MetricValue,
    PlatformGeometry,
    PoolGeometry,
    TrackBundle,
    TrackFrame,
)

FIXTURE_FILE = "fixture.json"


class FixtureUnavailable(Exception):
    """Fixture directory missing or malformed."""


class FileTrialStore:
    """Read-only store over ``fixture.json`` + media files in one directory."""

    def __init__(self, fixture_dir: Path) -> None:
        self.fixture_dir = fixture_dir
        path = fixture_dir / FIXTURE_FILE
        try:
            self.data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise FixtureUnavailable(f"cannot load {path}: {error}") from error
        self._trials: dict[tuple[str, str], dict[str, Any]] = {
            (row["experiment_id"], row["id"]): row
            for row in self.data.get("trials", [])
        }

    # --- catalog interface (same dicts as TrialCatalog) -----------------------

    def list_experiments(self, allowed_ids: set[str] | None) -> list[dict[str, Any]]:
        if allowed_ids is not None and not allowed_ids:
            return []
        counts: dict[str, int] = {}
        for row in self.data.get("trials", []):
            counts[row["experiment_id"]] = counts.get(row["experiment_id"], 0) + 1
        experiments = [
            {
                "id": item["id"],
                "name": item["name"],
                "trial_count": counts.get(item["id"], 0),
            }
            for item in self.data.get("experiments", [])
            if allowed_ids is None or item["id"] in allowed_ids
        ]
        return experiments

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
    ) -> tuple[list[dict[str, Any]], int]:
        rows = [
            self._summary(row)
            for row in self.data.get("trials", [])
            if row["experiment_id"] == experiment_id
            and (group_name is None or row.get("group_name") == group_name)
            and (mouse_id is None or row.get("mouse_id") == mouse_id)
            and (phase is None or row.get("phase") == phase)
            and (date_dir is None or row.get("date_dir") == date_dir)
        ]
        return rows[skip : skip + limit], len(rows)

    def get_trial(self, experiment_id: str, trial_id: str) -> dict[str, Any] | None:
        row = self._trials.get((experiment_id, trial_id))
        return self._summary(row) if row is not None else None

    def _summary(self, row: dict[str, Any]) -> dict[str, Any]:
        media = row.get("media") or {}
        source = self._media_file(media.get("source"))
        overlay = self._media_file(media.get("overlay"))
        return {
            "id": row["id"],
            "experiment_id": row["experiment_id"],
            "video_name": row.get("video_name", row["id"]),
            "group_name": row["group_name"],
            "mouse_id": row["mouse_id"],
            "phase": row["phase"],
            "date_dir": str(row["date_dir"]),
            "training_day": row.get("training_day"),
            "session_no": row["session_no"],
            "session_label": row["session_label"],
            "trial_no": row["trial_no"],
            "media_available": source is not None or overlay is not None,
            "result_available": row.get("track") is not None,
        }

    def _media_file(self, relative: str | None) -> Path | None:
        if not relative:
            return None
        path = self.fixture_dir / relative
        return path if path.is_file() else None

    def _row(self, experiment_id: str, trial_id: str) -> dict[str, Any]:
        row = self._trials.get((experiment_id, trial_id))
        if row is None:
            raise KeyError(trial_id)
        return row

    # --- assets interface ------------------------------------------------------

    def get_media(self, experiment_id: str, trial_id: str) -> MediaInfo:
        row = self._row(experiment_id, trial_id)
        media = row.get("media") or {}
        source = self._media_file(media.get("source"))
        overlay = self._media_file(media.get("overlay"))
        return describe_media(
            experiment_id,
            trial_id,
            source=source,
            overlay=overlay,
            missing_reason="视频文件不可用（合成夹具未提供该试次的媒体文件）",
        )

    def get_geometry(self, experiment_id: str, trial_id: str) -> GeometryBundle:
        row = self._row(experiment_id, trial_id)
        pool_row = row.get("pool")
        pool = (
            PoolGeometry(
                status="available",
                **{**pool_row, "source": pool_source_label(pool_row.get("source"))},
            )
            if pool_row
            else PoolGeometry(status="missing", reason=REASON_NO_POOL)
        )
        markers_row = row.get("markers")
        markers = (
            MarkersGeometry(status="available", **markers_row)
            if markers_row
            else MarkersGeometry(
                status="missing", reason="该实验没有可用的标志物场景标注"
            )
        )
        platform_row = row.get("platform")
        platform = (
            PlatformGeometry(status="available", **platform_row)
            if platform_row
            else PlatformGeometry(
                status="missing",
                reason=f"实验日期 {row['date_dir']} 没有平台标定记录",
            )
        )
        return GeometryBundle(pool=pool, markers=markers, platform=platform)

    def get_track(self, experiment_id: str, trial_id: str) -> TrackBundle:
        row = self._row(experiment_id, trial_id)
        track_row = row.get("track")
        if track_row is None:
            return TrackBundle(
                status="missing",
                reason=REASON_NO_TRACK,
            )
        frames = [TrackFrame.model_validate(item) for item in track_row["frames"]]
        return build_track_bundle(
            frames=frames,
            fps=float(row["fps"]),
            width=int(row["width"]),
            height=int(row["height"]),
            source=track_row.get("source"),
        )

    def get_metrics(self, experiment_id: str, trial_id: str) -> list[MetricValue]:
        row = self._row(experiment_id, trial_id)
        return [MetricValue.model_validate(item) for item in row.get("metrics", [])]

    def get_qc_status(self, experiment_id: str, trial_id: str) -> str | None:
        row = self._row(experiment_id, trial_id)
        return row.get("qc_status")

    def media_path(self, experiment_id: str, trial_id: str, kind: str) -> Path | None:
        row = self._row(experiment_id, trial_id)
        media = row.get("media") or {}
        return self._media_file(media.get(kind))
