"""Deterministic derivations over one trial's offline track (#20-#23).

Pure functions, shared by the research and fixture stores so the口径 exists
exactly once: per-frame speed, honest gap handling (missing frames are never
interpolated), the platform-entry geometric candidate, and the source-version
fingerprint that binds a human review to the materials it acknowledged.
"""

import hashlib
import json
import math
from collections.abc import Sequence

from app.trials.schemas import (
    GeometryBundle,
    MediaInfo,
    PlatformEntryCandidate,
    TrackBundle,
    TrackFrame,
)

#: Speed window: displacement between centers at i±3 frames over 6/fps
#: seconds — same definition as the approved local sample preview.
SPEED_WINDOW = 3


def pool_source_label(source: object) -> str:
    """Human-readable provenance of the pool circle parameters."""
    value = str(source or "")
    if value == "per_video_measured":
        return "逐视频测量（videos.pool_*）"
    return value or "水池参数来源未标记"


def build_track_bundle(
    *,
    frames: list[TrackFrame],
    fps: float,
    width: int,
    height: int,
    source: str | None,
) -> TrackBundle:
    """Assemble the track bundle with counts and the per-frame speed series."""
    valid, kp = count_frames(frames)
    return TrackBundle(
        status="available",
        source=source,
        fps=fps,
        width=width,
        height=height,
        frames=frames,
        speed=speed_series(frames, fps),
        valid_frames=valid,
        kp_frames=kp,
    )


def speed_series(
    frames: Sequence[TrackFrame], fps: float, window: int = SPEED_WINDOW
) -> list[float | None]:
    """Per-frame speed in px/s; None where the window is incomplete.

    A frame needs a center at both ends of the window, so leading/trailing
    frames and miss frames (or windows spanning a miss) yield None — gaps
    stay gaps, they are never interpolated.
    """
    centers: list[tuple[float, float] | None] = [
        (f.center[0], f.center[1]) if f.center is not None else None for f in frames
    ]
    dt = (2 * window) / fps if fps > 0 else 0.0
    speeds: list[float | None] = []
    for i in range(len(centers)):
        lo, hi = i - window, i + window
        if lo < 0 or hi >= len(centers) or dt <= 0 or centers[i] is None:
            # A frame without its own observation has no speed to report.
            speeds.append(None)
            continue
        a, b = centers[lo], centers[hi]
        if a is None or b is None:
            speeds.append(None)
            continue
        speeds.append(math.dist(a, b) / dt)
    return speeds


def platform_entry_candidate(
    frames: Sequence[TrackFrame],
    platform: GeometryBundle | None,
) -> PlatformEntryCandidate | None:
    """First center-point entry into the platform calibration circle.

    Geometric candidate only: the validated mount/contact events live in
    trial_metrics (mask-based, ADR-0006) and are displayed as their own
    metrics — never inferred from this intersection.
    """
    if platform is None or platform.platform.status != "available":
        return None
    circle = platform.platform
    assert circle.cx is not None and circle.cy is not None and circle.r is not None
    for frame in frames:
        if frame.center is None:
            continue
        if math.dist(frame.center, (circle.cx, circle.cy)) <= circle.r:
            time_s = frame.time_s
            if time_s is None:
                continue
            return PlatformEntryCandidate(frame=frame.frame, time_s=time_s)
    return None


def count_frames(frames: Sequence[TrackFrame]) -> tuple[int, int]:
    """(valid ok frames, frames with head+tail keypoints)."""
    valid = sum(1 for f in frames if f.status == "ok")
    kp = sum(1 for f in frames if f.head is not None and f.tail is not None)
    return valid, kp


def source_version(
    trial_id: str,
    video: MediaInfo,
    geometry: GeometryBundle,
    track: TrackBundle,
) -> str:
    """Fingerprint of the materials a preparation review acknowledges.

    Covers media content, geometry and the full tracking material, including
    timing and calibration dimensions. Version 2 intentionally invalidates
    older count-only fingerprints; historical reviews remain stored.
    """
    payload = {
        "version": 2,
        "trial_id": trial_id,
        "media": {
            "kind": video.kind,
            "status": video.status,
            "fingerprint": video.fingerprint,
        },
        "pool": geometry.pool.model_dump(mode="json"),
        "markers": geometry.markers.model_dump(mode="json"),
        "platform": geometry.platform.model_dump(mode="json"),
        "track": track.model_dump(mode="json"),
    }
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]
