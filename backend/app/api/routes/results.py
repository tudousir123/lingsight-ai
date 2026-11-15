"""Published inference results: publish endpoint and project data view.

Publishing is a platform-side pipeline (app/publishing.py) that pulls a
reviewed task's artifacts from the inference service with the service token
and writes them into this project. The read side gives the project page its
published-results view: task-level summaries plus paginated per-frame rows
(no mask RLE — that column is for the Agent's DBHub reads, not HTTP lists).
"""

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Response, status

from app import crud, publishing
from app.api.deps import CurrentUser, SessionDep, ensure_workspace_user, owned_project
from app.inference_access import visible_publication_ids
from app.inference_client import InferenceClient
from app.models import (
    PublishedFrame,
    PublishedFramePublic,
    PublishedFramesPublic,
    PublishedResult,
    PublishedResultPublic,
    PublishedResultsPublic,
    PublishRequest,
)

router = APIRouter(prefix="/projects", tags=["results"])

MAX_FRAME_PAGE = 1000
DEFAULT_FRAME_PAGE = 200


def _frame_public(frame: PublishedFrame) -> PublishedFramePublic:
    return PublishedFramePublic(
        frame_idx=frame.frame_idx,
        mask_valid=frame.mask_valid,
        centroid_x=frame.centroid_x,
        centroid_y=frame.centroid_y,
        contour_area=frame.contour_area,
        head_x=frame.head_x,
        head_y=frame.head_y,
        tail_x=frame.tail_x,
        tail_y=frame.tail_y,
        heading_angle_deg=frame.heading_angle_deg,
        is_proposal=frame.is_proposal,
        keypoint_correction=frame.keypoint_correction,
    )


@router.post("/{project_id}/results", response_model=PublishedResultPublic)
def publish_result(
    session: SessionDep,
    current_user: CurrentUser,
    project_id: uuid.UUID,
    request: PublishRequest,
    response: Response,
) -> Any:
    """Publish one reviewed inference task's results into this project."""
    ensure_workspace_user(current_user)
    project = owned_project(session, current_user, project_id)
    result, replayed = publishing.publish_task_results(
        session,
        InferenceClient(),
        project_id=project.id,
        user_id=current_user.id,
        task_id=request.task_id,
    )
    # A replay of the identical version answers 200 without rewriting.
    response.status_code = status.HTTP_200_OK if replayed else status.HTTP_201_CREATED
    return publishing.result_public(result, replayed=replayed)


@router.get("/{project_id}/results", response_model=PublishedResultsPublic)
def list_results(
    session: SessionDep, current_user: CurrentUser, project_id: uuid.UUID
) -> Any:
    """List this project's published inference results (task summaries)."""
    project = owned_project(session, current_user, project_id)
    results = crud.list_published_results(session, project_id=project.id)
    visible = set(visible_publication_ids(session, current_user, project.id))
    data = [
        publishing.result_public(result)
        for result in results
        if result.task_id in visible
    ]
    return PublishedResultsPublic(data=data, count=len(data))


@router.get(
    "/{project_id}/results/{task_id}/frames", response_model=PublishedFramesPublic
)
def list_result_frames(
    session: SessionDep,
    current_user: CurrentUser,
    project_id: uuid.UUID,
    task_id: str,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=DEFAULT_FRAME_PAGE, ge=1, le=MAX_FRAME_PAGE),
) -> Any:
    """One published result's per-frame rows, paginated (no mask RLE)."""
    project = owned_project(session, current_user, project_id)
    result: PublishedResult | None = crud.get_published_result(
        session, project_id=project.id, task_id=task_id
    )
    if not result or task_id not in visible_publication_ids(
        session, current_user, project.id
    ):
        raise HTTPException(status_code=404, detail="该项目没有该任务的已发布结果")
    frames = crud.list_published_frames(
        session, task_id=task_id, offset=offset, limit=limit
    )
    count = crud.count_published_frames(session, task_id=task_id)
    return PublishedFramesPublic(
        data=[_frame_public(frame) for frame in frames],
        count=count,
        offset=offset,
        limit=limit,
    )
