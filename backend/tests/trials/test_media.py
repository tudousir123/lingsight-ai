import os
from pathlib import Path
from typing import Any

import pytest

from app.core.research import ResearchDatabaseSettings
from app.trials.assets import ResearchTrialAssets
from app.trials.catalog import TrialCatalog
from app.trials.media import ResearchTrialMedia, describe_media
from app.trials.settings import TrialsSettings


@pytest.mark.parametrize("kind", ["source", "overlay"])
def test_directory_and_materials_agree_on_playable_media(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, kind: str
) -> None:
    mounted = tmp_path / "mounted"
    mounted.mkdir()
    overlays = tmp_path / "overlays"
    overlays.mkdir()
    media = (
        mounted / "video.mp4"
        if kind == "source"
        else overlays / "t_adaptive_overlay.mp4"
    )
    media.write_bytes(b"synthetic-video")
    settings = TrialsSettings(
        _env_file=None,
        TRIALS_VIDEOS_ROOT=mounted,
        TRIALS_SOURCE_PREFIX="/remote/videos",
        TRIALS_OVERLAY_DIR=overlays,
    )
    row: dict[str, Any] = {
        "video_id": "t",
        "dataset_id": "e",
        "source_video_path": "/remote/videos/video.mp4",
        "group_name": "g",
        "mouse_id": "1",
        "phase": "training_day",
        "date_dir": "0804",
        "session_no": 1,
        "session_label": "第1次",
        "trial_no": "1",
        "result_video_id": "t",
    }

    def read_rows(*_args: object) -> list[dict[str, Any]]:
        return [row]

    monkeypatch.setattr("app.trials.catalog.read_rows", read_rows)
    monkeypatch.setattr("app.trials.assets.read_rows", read_rows)
    research = ResearchDatabaseSettings(_env_file=None)
    catalog = TrialCatalog(research, settings)
    assets = ResearchTrialAssets(research, settings)
    trial = catalog.get_trial("e", "t")
    assert trial is not None and trial["media_available"] is True
    material = assets.get_media("e", "t")
    assert material.status == "available"
    assert material.kind == kind
    assert assets.media_path("e", "t", kind) == media
    media.unlink()
    trial = catalog.get_trial("e", "t")
    assert trial is not None and trial["media_available"] is False
    assert assets.get_media("e", "t").status == "missing"


def test_same_size_media_replacement_changes_fingerprint(tmp_path: Path) -> None:
    path = tmp_path / "video.mp4"
    path.write_bytes(b"first")
    stat = path.stat()
    first = describe_media(
        "e", "t", source=path, overlay=None, missing_reason="missing"
    )
    path.write_bytes(b"other")
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))
    second = describe_media(
        "e", "t", source=path, overlay=None, missing_reason="missing"
    )
    assert first.fingerprint != second.fingerprint
    assert second.fingerprint is not None and second.fingerprint.startswith("sha256:")


def test_source_mount_does_not_accept_sibling_prefix_or_escape(tmp_path: Path) -> None:
    root = tmp_path / "videos"
    root.mkdir()
    (tmp_path / "outside.mp4").write_bytes(b"outside")
    resolver = ResearchTrialMedia(
        TrialsSettings(
            _env_file=None,
            TRIALS_VIDEOS_ROOT=root,
            TRIALS_SOURCE_PREFIX="/remote/videos",
        )
    )
    assert resolver.source_path("/remote/videos/../outside.mp4") is None
    assert resolver.source_path("/remote/videos-other/outside.mp4") is None
