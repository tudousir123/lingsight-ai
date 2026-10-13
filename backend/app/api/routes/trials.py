"""Authenticated experiment and trial directory."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import select

from app.api.deps import CurrentUser, SessionDep
from app.models import ExperimentAccess
from app.text_to_sql.settings import get_research_settings
from app.trials.catalog import CatalogUnavailable, TrialCatalog

router = APIRouter(prefix="/experiments", tags=["experiments"])


class ExperimentSummary(BaseModel):
    id: str
    name: str
    trial_count: int


class ExperimentsPublic(BaseModel):
    data: list[ExperimentSummary]


class TrialSummary(BaseModel):
    id: str
    experiment_id: str
    video_name: str
    group_name: str
    mouse_id: str
    phase: str
    date_dir: str
    training_day: int | None
    session_no: int
    session_label: str
    trial_no: str
    media_available: bool
    result_available: bool


class TrialsPublic(BaseModel):
    data: list[TrialSummary]
    count: int


def get_trial_catalog() -> TrialCatalog:
    return TrialCatalog(get_research_settings())


CatalogDep = Annotated[TrialCatalog, Depends(get_trial_catalog)]


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
