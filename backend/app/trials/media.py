"""One policy for playable trial media and the bytes a review acknowledges."""

import hashlib
import os
from functools import lru_cache
from pathlib import Path

from app.trials.schemas import MediaInfo, MediaKind
from app.trials.settings import TrialsSettings


def media_url(experiment_id: str, trial_id: str, kind: str) -> str:
    from app.core.config import settings

    return (
        f"{settings.API_V1_STR}/experiments/{experiment_id}"
        f"/trials/{trial_id}/media/{kind}"
    )


def _revision(stat: os.stat_result) -> tuple[int, int, int, int, int]:
    return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns


@lru_cache(maxsize=128)
def _content_digest(path: Path, revision: tuple[int, int, int, int, int]) -> str:
    with path.open("rb") as stream:
        if _revision(os.fstat(stream.fileno())) != revision:
            raise OSError("Media changed before reading")
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if _revision(os.fstat(stream.fileno())) != revision:
            raise OSError("Media changed while reading")
    if _revision(path.stat()) != revision:
        raise OSError("Media replaced while reading")
    return f"sha256:{digest}"


def describe_media(
    experiment_id: str,
    trial_id: str,
    *,
    source: Path | None,
    overlay: Path | None,
    missing_reason: str,
) -> MediaInfo:
    path = overlay or source
    if path is None:
        return MediaInfo(kind="source", status="missing", reason=missing_reason)
    kind: MediaKind = "overlay" if overlay is not None else "source"
    try:
        fingerprint = _content_digest(path, _revision(path.stat()))
    except OSError:
        return MediaInfo(
            kind=kind,
            status="missing",
            reason="视频文件不可读或正在更新，请稍后重新加载",
        )
    return MediaInfo(
        kind=kind,
        status="available",
        url=media_url(experiment_id, trial_id, kind),
        fingerprint=fingerprint,
    )


class ResearchTrialMedia:
    """Resolve configured mounts for both directory and trial materials."""

    def __init__(self, settings: TrialsSettings) -> None:
        self.settings = settings

    def source_path(self, source: str | None) -> Path | None:
        root = self.settings.TRIALS_VIDEOS_ROOT
        if not source or root is None:
            return None
        try:
            relative = Path(source).relative_to(self.settings.TRIALS_SOURCE_PREFIX)
            path = (root / relative).resolve()
            path.relative_to(root.resolve())
        except ValueError:
            return None
        return path if path.is_file() else None

    def overlay_path(self, trial_id: str) -> Path | None:
        root = self.settings.TRIALS_OVERLAY_DIR
        if root is None:
            return None
        path = (root / f"{trial_id}_adaptive_overlay.mp4").resolve()
        if not path.is_relative_to(root.resolve()):
            return None
        return path if path.is_file() else None

    def available(self, source: str | None, trial_id: str) -> bool:
        return (
            self.overlay_path(trial_id) is not None
            or self.source_path(source) is not None
        )
