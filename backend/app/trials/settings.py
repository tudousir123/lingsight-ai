"""Trial-flow settings: filesystem roots and fixture mode (tickets #20-#23).

Every path arrives through the environment (never literals), following the
pattern of ``app.text_to_sql.settings``. All paths are optional: an unset
root means the corresponding material is reported as unavailable with a
reason instead of guessed.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class TrialsSettings(BaseSettings):
    """Env-driven configuration for the trial analysis flow."""

    model_config = SettingsConfigDict(
        # Same .env as app.core.config (one level above ./backend/).
        env_file="../.env",
        env_ignore_empty=True,
        extra="ignore",
    )

    #: When set, the trial catalog and assets are served from this synthetic
    #: fixture directory instead of the research database (CI / demo stack).
    TRIALS_FIXTURE_DIR: Path | None = None

    #: Local mount of the research videos root; the research DB stores paths
    #: under TRIALS_SOURCE_PREFIX (e.g. /volume1/DATAS/...) which are mapped
    #: onto this root to resolve playable media files.
    TRIALS_VIDEOS_ROOT: Path | None = None
    TRIALS_SOURCE_PREFIX: str = "/volume1/DATAS"

    #: Directory holding ``{video_id}_adaptive_overlay.mp4`` files rendered by
    #: the offline inference pipeline. Unset = overlay video unavailable.
    TRIALS_OVERLAY_DIR: Path | None = None

    #: JSON file with the human scene annotation of the four maze markers
    #: (``{"shapes": [{"label": ..., "points": [[x, y], ...]}], ...}``).
    #: Unset = marker geometry unavailable.
    TRIALS_SCENE_MARKERS_JSON: Path | None = None


@lru_cache(maxsize=1)
def get_trials_settings() -> TrialsSettings:
    """Cached singleton; tests override via the FastAPI dependency."""
    return TrialsSettings()
