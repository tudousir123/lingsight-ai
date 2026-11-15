"""Project video preannotation read/confirm HTTP contract."""

import uuid
from typing import Any

from fastapi import APIRouter, Request, Response
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import col, select
from starlette.concurrency import run_in_threadpool

from app.api.deps import CurrentUser, SessionDep, owned_project
from app.api.routes.inference import (
    UPSTREAM_ERRORS,
    bounded_json,
    idempotency_key,
    upstream_error,
)
from app.contracts import ErrorCode
from app.inference_access import failure, owned_binding
from app.inference_client import InferenceClient
from app.inference_models import InferenceBinding, PreannotationConfirmation
from app.models import Project
from app.preannotations import (
    ConfirmationInput,
    candidate_snapshot,
    confirmation_public,
    dispatch_confirmation,
    fingerprint,
    latest_confirmation,
    validate_geometry,
)

router = APIRouter(prefix="/projects", tags=["preannotations"])


@router.get("/{project_id}/videos/{video_id}/preannotation")
def get_preannotation(
    project_id: uuid.UUID,
    video_id: str,
    task_id: uuid.UUID,
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    owned_project(session, current_user, project_id)
    binding = owned_binding(session, current_user, str(task_id))
    if binding.project_id != project_id or binding.video_id != video_id:
        raise failure(404, ErrorCode.RESOURCE_NOT_FOUND, "Candidate not found")
    try:
        task = InferenceClient().fetch_task(str(task_id))
        candidate = candidate_snapshot(task, binding)
        if (
            task.get("status") != "waiting_for_review"
            and binding.confirmation_id is None
        ):
            raise failure(
                409, ErrorCode.STATE_CONFLICT, "Candidate not ready for review"
            )
        return candidate
    except UPSTREAM_ERRORS as exc:
        upstream_error(exc)


@router.get("/{project_id}/videos/{video_id}/preannotation-confirmation")
def get_confirmation(
    project_id: uuid.UUID,
    video_id: str,
    session: SessionDep,
    current_user: CurrentUser,
    confirmation_id: uuid.UUID | None = None,
) -> Any:
    owned_project(session, current_user, project_id)
    query = (
        select(PreannotationConfirmation)
        .join(
            InferenceBinding,
            col(PreannotationConfirmation.binding_id) == col(InferenceBinding.id),
        )
        .where(
            InferenceBinding.project_id == project_id,
            InferenceBinding.video_id == video_id,
            InferenceBinding.owner_user_id == current_user.id,
        )
    )
    if confirmation_id:
        query = query.where(PreannotationConfirmation.id == confirmation_id)
    row = session.exec(
        query.order_by(
            col(PreannotationConfirmation.confirmed_at).desc(),
            col(PreannotationConfirmation.id).desc(),
        )
    ).first()
    if row is None:
        raise failure(404, ErrorCode.RESOURCE_NOT_FOUND, "Confirmation not found")
    binding = session.get(InferenceBinding, row.binding_id)
    assert binding is not None and binding.task_id is not None
    binding = owned_binding(session, current_user, binding.task_id)
    return confirmation_public(row, binding)


@router.post("/{project_id}/videos/{video_id}/preannotation-confirmations")
async def confirm_preannotation(
    project_id: uuid.UUID,
    video_id: str,
    request: Request,
    response: Response,
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    owned_project(session, current_user, project_id)
    try:
        data = ConfirmationInput.model_validate(await bounded_json(request))
    except ValidationError:
        raise failure(
            422, ErrorCode.INVALID_GEOMETRY, "Invalid confirmation fields"
        ) from None
    key = idempotency_key(request)
    return await run_in_threadpool(
        save_confirmation,
        project_id,
        video_id,
        data,
        key,
        response,
        session,
        current_user,
    )


def save_confirmation(
    project_id: uuid.UUID,
    video_id: str,
    data: ConfirmationInput,
    key: uuid.UUID,
    response: Response,
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    session.exec(
        select(Project).where(Project.id == project_id).with_for_update()
    ).one()
    binding = owned_binding(session, current_user, str(data.task_id), lock=True)
    if binding.project_id != project_id or binding.video_id != video_id:
        raise failure(404, ErrorCode.RESOURCE_NOT_FOUND, "Task video not found")
    digest = fingerprint(data.model_dump(mode="json"))
    row = session.exec(
        select(PreannotationConfirmation).where(
            PreannotationConfirmation.owner_user_id == current_user.id,
            PreannotationConfirmation.idempotency_key == key,
        )
    ).first()
    client = InferenceClient()
    if row:
        if row.request_sha256 != digest or row.binding_id != binding.id:
            raise failure(
                409,
                ErrorCode.IDEMPOTENCY_CONFLICT,
                "Idempotency key has different confirmation",
            )
        if binding.confirmation_id != row.id:
            return confirmation_public(row, binding)
        session.commit()
        dispatch_confirmation(session, client, row, binding)
        session.refresh(row)
        return confirmation_public(row, binding)
    latest = latest_confirmation(session, binding)
    if (latest.id if latest else None) != data.expected_confirmation_id:
        raise failure(409, ErrorCode.STALE_VERSION, "Latest confirmation changed")
    bound = (
        session.get(PreannotationConfirmation, binding.confirmation_id)
        if binding.confirmation_id
        else None
    )
    if bound and (bound.dispatch_attempted or bound.dispatch_status != "failed"):
        raise failure(
            409, ErrorCode.STATE_CONFLICT, "Confirmation has already been dispatched"
        )
    try:
        task = client.fetch_task(str(data.task_id))
        candidate = candidate_snapshot(task, binding)
    except UPSTREAM_ERRORS as exc:
        upstream_error(exc)
        raise AssertionError("unreachable")
    if task.get("status") != "waiting_for_review" or task.get("confirmed") is not None:
        raise failure(
            409, ErrorCode.STATE_CONFLICT, "Task already tracking or not ready"
        )
    if candidate["candidate_version"] != data.candidate_version:
        raise failure(409, ErrorCode.STALE_VERSION, "Candidate changed")
    geometry = validate_geometry(data, candidate)
    row = PreannotationConfirmation(
        binding_id=binding.id,
        owner_user_id=current_user.id,
        idempotency_key=key,
        request_sha256=digest,
        candidate_version=data.candidate_version,
        video_sha256=candidate["video_sha256"],
        width=candidate["width"],
        height=candidate["height"],
        frame_count=candidate["frame_count"],
        geometry=geometry,
    )
    binding.confirmation_id = row.id
    binding.video_sha256 = row.video_sha256
    session.add(row)
    session.add(binding)
    try:
        session.commit()
    except SQLAlchemyError:
        session.rollback()
        raise failure(
            503, ErrorCode.SERVICE_UNAVAILABLE, "Confirmation could not be saved"
        ) from None
    dispatch_confirmation(session, client, row, binding)
    session.refresh(row)
    response.status_code = 201
    return confirmation_public(row, binding)
