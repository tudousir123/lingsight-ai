"""Unit tests for the deterministic trial derivations (#20-#23)."""

import math

from app.trials.derive import (
    platform_entry_candidate,
    source_version,
    speed_series,
)
from app.trials.schemas import (
    GeometryBundle,
    MarkersGeometry,
    MediaInfo,
    PlatformGeometry,
    PoolGeometry,
    TrackBundle,
    TrackFrame,
)


def frame(
    idx: int,
    center: list[float] | None,
    *,
    status: str = "ok",
    time_s: float | None = None,
) -> TrackFrame:
    return TrackFrame(
        frame=idx,
        time_s=time_s if time_s is not None else idx / 30.0,
        status=status,  # type: ignore[arg-type]
        center=center,
        head=[center[0] + 1, center[1]] if center else None,
        tail=[center[0] - 1, center[1]] if center else None,
    )


class TestSpeedSeries:
    def test_constant_motion(self) -> None:
        frames = [frame(i, [i * 3.0, 0]) for i in range(10)]
        speeds = speed_series(frames, fps=30)
        # window 3: |(i+3)*3 - (i-3)*3| / 0.2 = 9/0.2 = 45 px/s
        assert speeds[3] == 90.0
        assert speeds == [None, None, None] + [90.0] * 4 + [None, None, None]

    def test_miss_frames_leave_gaps_not_interpolation(self) -> None:
        frames = [frame(i, [i * 3.0, 0]) for i in range(12)]
        frames[5] = frame(5, None, status="miss")
        speeds = speed_series(frames, fps=30)
        # the miss frame itself reports no speed, and windows that would
        # bridge across it (endpoint at 5) are None — gaps stay gaps
        assert speeds[5] is None
        assert speeds[8] is None  # window 5..11 has a missing endpoint
        assert speeds[3] == 90.0
        assert speeds[4] == 90.0
        assert speeds[9] is None  # hi=12 out of range: trailing edge
        assert speeds[10] is None and speeds[11] is None  # trailing edge

    def test_coord_frames_count_as_observations(self) -> None:
        frames = [frame(i, [i * 3.0, 0]) for i in range(10)]
        frames[5] = frame(5, [15.0, 0], status="coord")
        speeds = speed_series(frames, fps=30)
        assert speeds[5] == 90.0


class TestPlatformEntryCandidate:
    def _geometry(self) -> GeometryBundle:
        return GeometryBundle(
            pool=PoolGeometry(status="available", cx=100, cy=100, r=50, source="s"),
            markers=MarkersGeometry(status="missing", reason="无标注"),
            platform=PlatformGeometry(
                status="available", cx=200, cy=100, r=10, source="s"
            ),
        )

    def test_first_center_entry_is_reported(self) -> None:
        frames = [
            frame(0, [0.0, 100.0]),
            frame(1, [185.0, 100.0]),  # outside (distance 15 > r=10)
            frame(2, [195.0, 100.0]),  # inside the circle
            frame(3, [300.0, 100.0]),
        ]
        candidate = platform_entry_candidate(frames, self._geometry())
        assert candidate is not None
        assert candidate.frame == 2
        assert math.isclose(candidate.time_s, 2 / 30.0)

    def test_missing_center_frames_are_skipped(self) -> None:
        frames = [
            frame(0, None, status="miss"),
            frame(1, [195.0, 100.0]),
        ]
        candidate = platform_entry_candidate(frames, self._geometry())
        assert candidate is not None
        assert candidate.frame == 1

    def test_no_entry_yields_none(self) -> None:
        frames = [frame(0, [0.0, 0.0]), frame(1, [10.0, 10.0])]
        assert platform_entry_candidate(frames, self._geometry()) is None

    def test_missing_platform_yields_none(self) -> None:
        geometry = GeometryBundle(
            pool=PoolGeometry(status="available", cx=100, cy=100, r=50, source="s"),
            markers=MarkersGeometry(status="missing", reason="无标注"),
            platform=PlatformGeometry(status="missing", reason="无标定"),
        )
        frames = [frame(0, [200.0, 100.0])]
        assert platform_entry_candidate(frames, geometry) is None


class TestSourceVersion:
    def _bundle(self) -> tuple[MediaInfo, GeometryBundle, TrackBundle]:
        media = MediaInfo(
            kind="overlay", status="available", url="/x", fingerprint="bytes:10"
        )
        geometry = GeometryBundle(
            pool=PoolGeometry(status="available", cx=1, cy=2, r=3, source="s"),
            markers=MarkersGeometry(status="available", shapes=[]),
            platform=PlatformGeometry(status="available", cx=1, cy=2, r=3),
        )
        track = TrackBundle(
            status="available",
            fps=30,
            width=640,
            height=360,
            frames=[frame(0, [1.0, 1.0])],
            valid_frames=1,
            kp_frames=1,
        )
        return media, geometry, track

    def test_stable_for_same_materials(self) -> None:
        media, geometry, track = self._bundle()
        first = source_version("t", media, geometry, track)
        second = source_version("t", media, geometry, track)
        assert first == second
        assert len(first) == 16

    def test_changes_with_media_fingerprint(self) -> None:
        media, geometry, track = self._bundle()
        first = source_version("t", media, geometry, track)
        heavier = media.model_copy(update={"fingerprint": "bytes:999"})
        assert source_version("t", heavier, geometry, track) != first

    def test_changes_with_track_and_geometry(self) -> None:
        media, geometry, track = self._bundle()
        first = source_version("t", media, geometry, track)
        other_track = track.model_copy(update={"valid_frames": 2})
        assert source_version("t", media, geometry, other_track) != first
        other_platform = geometry.platform.model_copy(update={"cx": 9.0})
        other_geometry = geometry.model_copy(update={"platform": other_platform})
        assert source_version("t", media, other_geometry, track) != first
