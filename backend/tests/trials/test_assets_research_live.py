"""Live research-DB checks for the trial assets layer (env-gated).

Skipped unless the water_maze research DB is reachable with the
lingsight_ro account and the local media roots are configured — CI runs the
structure layer only; these run on the research machine to prove the real
geometry / track / metrics / media resolution end to end.
"""

from pathlib import Path

import pytest

from app.text_to_sql.settings import get_research_settings
from app.metrics.definitions import ALGO_VERSION, ALGO_VERSION_EVENTS
from app.trials.assets import ResearchTrialAssets
from app.trials.catalog import CatalogUnavailable, TrialCatalog
from app.trials.settings import get_trials_settings

pytestmark = [pytest.mark.env_gated]

_SKIP_DB = (
    "needs the water_maze research DB with LINGSIGHT_RO_PASSWORD "
    "(lingsight_ro); CI runs the structure layer only"
)
_SKIP_MEDIA = "needs TRIALS_VIDEOS_ROOT / TRIALS_OVERLAY_DIR pointing at the local media"
_SKIP_MARKERS = "needs TRIALS_SCENE_MARKERS_JSON pointing at the marker annotation"

#: The trial the approved prototype previewed: 0809 probe, one video = one trial.
SAMPLE_VIDEO_ID = "0809第一象限-A2-2-4"


@pytest.fixture(scope="module")
def catalog() -> TrialCatalog:
    settings = get_research_settings()
    try:
        TrialCatalog(settings).list_experiments(None)
    except CatalogUnavailable:
        pytest.skip(_SKIP_DB)
    return TrialCatalog(settings)


@pytest.fixture(scope="module")
def assets(catalog: TrialCatalog) -> ResearchTrialAssets:
    return ResearchTrialAssets(get_research_settings(), get_trials_settings())


@pytest.fixture(scope="module")
def dataset_id(catalog: TrialCatalog) -> str:
    experiments = catalog.list_experiments(None)
    assert experiments, "research DB exposes no datasets"
    return str(experiments[0]["id"])


def test_catalog_lists_the_sample_trial(
    catalog: TrialCatalog, dataset_id: str
) -> None:
    trial = catalog.get_trial(dataset_id, SAMPLE_VIDEO_ID)
    assert trial is not None
    assert trial["group_name"] == "A2"
    assert trial["mouse_id"] == "2"
    assert trial["phase"] == "probe_platform_present"
    assert trial["result_available"] is True


def test_geometry_uses_db_pool_and_e1_platform(
    assets: ResearchTrialAssets, dataset_id: str
) -> None:
    geometry = assets.get_geometry(dataset_id, SAMPLE_VIDEO_ID)
    assert geometry.pool.status == "available"
    assert geometry.pool.cx is not None and geometry.pool.r is not None
    assert "逐视频测量" in geometry.pool.source
    # 0809 probe platform: E1 consensus row, never pixel detection
    assert geometry.platform.status == "available"
    assert geometry.platform.cx == pytest.approx(1501.7, abs=0.1)
    assert geometry.platform.cy == pytest.approx(622.6, abs=0.1)
    assert geometry.platform.r == 46.0
    assert "E1" in geometry.platform.source


def test_markers_available_when_configured(
    assets: ResearchTrialAssets, dataset_id: str
) -> None:
    if get_trials_settings().TRIALS_SCENE_MARKERS_JSON is None:
        pytest.skip(_SKIP_MARKERS)
    geometry = assets.get_geometry(dataset_id, SAMPLE_VIDEO_ID)
    assert geometry.markers.status == "available"
    assert len(geometry.markers.shapes) == 4
    labels = {shape.label for shape in geometry.markers.shapes}
    assert labels == {"pentacle", "rectangle", "triangle", "round"}


def test_track_reads_frame_view(
    assets: ResearchTrialAssets, dataset_id: str
) -> None:
    track = assets.get_track(dataset_id, SAMPLE_VIDEO_ID)
    assert track.status == "available"
    assert track.fps == 30.0
    assert (track.width, track.height) == (2560, 1440)
    assert len(track.frames) == 244
    assert track.valid_frames > 0
    statuses = {frame.status for frame in track.frames}
    assert statuses <= {"ok", "miss", "coord"}
    # speed series is parallel and keeps gaps
    assert len(track.speed) == len(track.frames)
    assert any(speed is None for speed in track.speed)


def test_metrics_carry_both_algo_versions(
    assets: ResearchTrialAssets, dataset_id: str
) -> None:
    metrics = assets.get_metrics(dataset_id, SAMPLE_VIDEO_ID)
    by_metric = {row.metric: row for row in metrics}
    assert by_metric["dist_px"].algo_version == ALGO_VERSION
    assert by_metric["escape_latency_s"].algo_version == ALGO_VERSION_EVENTS
    assert by_metric["mount_s"].calc_status == "ok"
    assert by_metric["mount_s"].value is not None


def test_media_resolves_real_files(
    assets: ResearchTrialAssets, dataset_id: str
) -> None:
    settings = get_trials_settings()
    if settings.TRIALS_VIDEOS_ROOT is None and settings.TRIALS_OVERLAY_DIR is None:
        pytest.skip(_SKIP_MEDIA)
    media = assets.get_media(dataset_id, SAMPLE_VIDEO_ID)
    assert media.status == "available"
    assert media.fingerprint
    if media.kind == "overlay":
        path = assets.media_path(dataset_id, SAMPLE_VIDEO_ID, "overlay")
    else:
        path = assets.media_path(dataset_id, SAMPLE_VIDEO_ID, "source")
    assert path is not None and Path(path).is_file()
    assert Path(path).stat().st_size > 100_000
