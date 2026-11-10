"""Authenticated experiment and trial directory + single-trial flow."""

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlmodel import select

from app.api.deps import CurrentUser, MediaUserDep, SessionDep
from app.core.research import get_research_database_settings
from app.models import ExperimentAccess
from app.trials.assets import ResearchTrialAssets
from app.trials.catalog import CatalogUnavailable, TrialCatalog
from app.trials.fixture_store import FileTrialStore, FixtureUnavailable
from app.trials.schemas import (
    ExperimentsPublic,
    ExperimentSummary,
    PreparationPublic,
    ResultPublic,
    ReviewPublic,
    ReviewUpdate,
    TrialsPublic,
    TrialSummary,
)
from app.trials.service import (
    ConfirmationRejected,
    SourceVersionConflict,
    TrialAssetsProtocol,
    TrialCatalogProtocol,
    TrialNotFound,
    load_trial,
    preparation_bundle,
    result_bundle,
    save_review,
)
from app.trials.settings import get_trials_settings

router = APIRouter(prefix="/experiments", tags=["experiments"])


@lru_cache(maxsize=4)
def _fixture_store(fixture_dir: Path) -> FileTrialStore:
    return FileTrialStore(fixture_dir)


def _fixture_or_503() -> FileTrialStore:
    fixture_dir = get_trials_settings().TRIALS_FIXTURE_DIR
    assert fixture_dir is not None
    try:
        return _fixture_store(fixture_dir)
    except FixtureUnavailable as error:
        raise HTTPException(
            status_code=503, detail=f"Trial fixture unavailable: {error}"
        ) from error


def get_trial_catalog() -> TrialCatalogProtocol:
    """Bounded trial catalog: research DB, or the synthetic fixture dir."""
    if get_trials_settings().TRIALS_FIXTURE_DIR is not None:
        return _fixture_or_503()
    return TrialCatalog(get_research_database_settings())


def get_trial_assets() -> TrialAssetsProtocol:
    """Material resolver for one trial: research side, or the fixture."""
    if get_trials_settings().TRIALS_FIXTURE_DIR is not None:
        return _fixture_or_503()
    return ResearchTrialAssets(get_research_database_settings(), get_trials_settings())


CatalogDep = Annotated[TrialCatalogProtocol, Depends(get_trial_catalog)]
AssetsDep = Annotated[TrialAssetsProtocol, Depends(get_trial_assets)]


def _allowed_ids(session: SessionDep, current_user: CurrentUser) -> set[str] | None:
    if current_user.is_superuser:
        return None
    grants = session.exec(
        select(ExperimentAccess.experiment_id).where(
            ExperimentAccess.user_id == current_user.id
        )
    )
    return set(grants.all())


def _check_access(
    experiment_id: str, session: SessionDep, current_user: CurrentUser
) -> None:
    allowed = _allowed_ids(session, current_user)
    if allowed is not None and experiment_id not in allowed:
        raise HTTPException(status_code=403, detail="Experiment access denied")


@router.get("", response_model=ExperimentsPublic)
def list_experiments(
    session: SessionDep, current_user: CurrentUser, catalog: CatalogDep
) -> ExperimentsPublic:
    try:
        return ExperimentsPublic(
            data=[
                ExperimentSummary.model_validate(row)
                for row in catalog.list_experiments(_allowed_ids(session, current_user))
            ]
        )
    except CatalogUnavailable:
        raise HTTPException(status_code=503, detail="Research catalog unavailable")


@router.get("/{experiment_id}/trials", response_model=TrialsPublic)
def list_trials(
    experiment_id: str,
    session: SessionDep,
    current_user: CurrentUser,
    catalog: CatalogDep,
    group_name: str | None = None,
    mouse_id: str | None = None,
    phase: str | None = None,
    date_dir: str | None = None,
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> TrialsPublic:
    _check_access(experiment_id, session, current_user)
    try:
        rows, count = catalog.list_trials(
            experiment_id,
            group_name=group_name,
            mouse_id=mouse_id,
            phase=phase,
            date_dir=date_dir,
            skip=skip,
            limit=limit,
        )
        return TrialsPublic(
            data=[TrialSummary.model_validate(row) for row in rows], count=count
        )
    except CatalogUnavailable:
        raise HTTPException(status_code=503, detail="Research catalog unavailable")


@router.get("/{experiment_id}/trials/{trial_id}", response_model=TrialSummary)
def get_trial(
    experiment_id: str,
    trial_id: str,
    session: SessionDep,
    current_user: CurrentUser,
    catalog: CatalogDep,
) -> TrialSummary:
    _check_access(experiment_id, session, current_user)
    try:
        row = catalog.get_trial(experiment_id, trial_id)
    except CatalogUnavailable:
        raise HTTPException(status_code=503, detail="Research catalog unavailable")
    if row is None:
        raise HTTPException(status_code=404, detail="Trial not found in experiment")
    return TrialSummary.model_validate(row)


@router.get(
    "/{experiment_id}/trials/{trial_id}/preparation",
    response_model=PreparationPublic,
)
def get_preparation(
    experiment_id: str,
    trial_id: str,
    session: SessionDep,
    current_user: CurrentUser,
    catalog: CatalogDep,
    assets: AssetsDep,
) -> PreparationPublic:
    _check_access(experiment_id, session, current_user)
    try:
        return preparation_bundle(
            catalog, assets, session, current_user, experiment_id, trial_id
        )
    except TrialNotFound:
        raise HTTPException(status_code=404, detail="Trial not found in experiment")
    except CatalogUnavailable:
        raise HTTPException(status_code=503, detail="Research catalog unavailable")


@router.put(
    "/{experiment_id}/trials/{trial_id}/review",
    response_model=ReviewPublic,
)
def put_review(
    experiment_id: str,
    trial_id: str,
    update: ReviewUpdate,
    session: SessionDep,
    current_user: CurrentUser,
    catalog: CatalogDep,
    assets: AssetsDep,
) -> ReviewPublic:
    _check_access(experiment_id, session, current_user)
    try:
        return save_review(
            session,
            current_user,
            experiment_id,
            trial_id,
            update,
            catalog=catalog,
            assets=assets,
        )
    except TrialNotFound:
        raise HTTPException(status_code=404, detail="Trial not found in experiment")
    except SourceVersionConflict as error:
        raise HTTPException(status_code=409, detail=str(error))
    except ConfirmationRejected as error:
        raise HTTPException(status_code=422, detail=str(error))
    except CatalogUnavailable:
        raise HTTPException(status_code=503, detail="Research catalog unavailable")


@router.get(
    "/{experiment_id}/trials/{trial_id}/result",
    response_model=ResultPublic,
)
def get_result(
    experiment_id: str,
    trial_id: str,
    session: SessionDep,
    current_user: CurrentUser,
    catalog: CatalogDep,
    assets: AssetsDep,
) -> ResultPublic:
    _check_access(experiment_id, session, current_user)
    try:
        return result_bundle(
            catalog, assets, session, current_user, experiment_id, trial_id
        )
    except TrialNotFound:
        raise HTTPException(status_code=404, detail="Trial not found in experiment")
    except CatalogUnavailable:
        raise HTTPException(status_code=503, detail="Research catalog unavailable")


# --- media serving -----------------------------------------------------------
#
# Media auth (bearer header or `?token=` session JWT for <video> elements)
# lives in app.api.deps next to the other platform dependencies.

@router.get("/{experiment_id}/trials/{trial_id}/media/{kind}")
def get_trial_media(
    experiment_id: str,
    trial_id: str,
    kind: Literal["source", "overlay"],
    session: SessionDep,
    current_user: MediaUserDep,
    catalog: CatalogDep,
    assets: AssetsDep,
) -> FileResponse:
    _check_access(experiment_id, session, current_user)
    try:
        trial = load_trial(catalog, experiment_id, trial_id)
        media_file = assets.media_path(experiment_id, trial_id, kind)
    except TrialNotFound:
        raise HTTPException(status_code=404, detail="Trial not found in experiment")
    except CatalogUnavailable:
        raise HTTPException(status_code=503, detail="Research catalog unavailable")
    if media_file is None or not media_file.is_file():
        raise HTTPException(
            status_code=404,
            detail=f"该试次没有可用的 {kind} 视频文件",
        )
    return FileResponse(
        media_file,
        media_type="video/mp4",
        filename=str(trial.get("video_name") or f"{trial_id}.mp4"),
    )
