"""Project entity API: user-owned research organization units (ticket #42).

Projects group references to items owned by other services (agent tasks,
inference videos). This router owns the grouping only — task and video
ownership stays with the agent/inference services (ADR-0012 unchanged).
"""

import uuid
from typing import Annotated, Any, cast

from fastapi import APIRouter, HTTPException, Path, Response, status
from sqlalchemy.exc import IntegrityError

from app import crud
from app.api.deps import CurrentUser, SessionDep, ensure_workspace_user, owned_project
from app.inference_client import (
    InferenceArtifactTooLarge,
    InferenceClient,
    InferenceNotFound,
    InferenceUnconfigured,
    InferenceUnreachable,
    InferenceUpstreamError,
)
from app.models import (
    VIDEO_ID_MAX_LENGTH,
    Message,
    Project,
    ProjectCreate,
    ProjectImportRequest,
    ProjectImportResult,
    ProjectMember,
    ProjectMemberAdd,
    ProjectMemberKind,
    ProjectMemberPublic,
    ProjectPublic,
    ProjectRename,
    ProjectsPublic,
    ProjectVideoFolderInput,
    ProjectVideoFolderPublic,
    get_datetime_utc,
)

router = APIRouter(prefix="/projects", tags=["projects"])

DUPLICATE_NAME_DETAIL = "同名项目已存在"


def _member_public(member: ProjectMember) -> ProjectMemberPublic:
    return ProjectMemberPublic(
        kind=cast(ProjectMemberKind, member.member_kind),
        id=member.member_id,
        label=member.label,
        added_at=member.added_at,
    )


def _public(project: Project, members: list[ProjectMember]) -> ProjectPublic:
    return ProjectPublic(
        id=project.id,
        name=project.name,
        created_at=project.created_at,
        updated_at=project.updated_at,
        members=[_member_public(member) for member in members],
        video_folder=(
            ProjectVideoFolderPublic(
                source_id=project.video_source_id,
                path=project.video_directory,
                label=project.video_directory_label or "根目录",
            )
            if project.video_source_id is not None
            and project.video_directory is not None
            else None
        ),
    )


@router.get("/", response_model=ProjectsPublic)
def list_projects(session: SessionDep, current_user: CurrentUser) -> Any:
    """List the current user's projects with their member references."""
    projects = crud.list_projects(session=session, user_id=current_user.id)
    members = crud.list_project_members(
        session=session, project_ids=[project.id for project in projects]
    )
    data = [_public(project, members.get(project.id, [])) for project in projects]
    return ProjectsPublic(data=data, count=len(data))


@router.post("/", response_model=ProjectPublic)
def create_project(
    session: SessionDep, current_user: CurrentUser, project_in: ProjectCreate
) -> Any:
    """Create a project for the current user."""
    try:
        project = crud.create_project(
            session=session, user_id=current_user.id, name=project_in.name
        )
    except IntegrityError:
        raise HTTPException(status_code=409, detail=DUPLICATE_NAME_DETAIL) from None
    return _public(project, [])


@router.patch("/{project_id}", response_model=ProjectPublic)
def rename_project(
    session: SessionDep,
    current_user: CurrentUser,
    project_id: uuid.UUID,
    project_in: ProjectRename,
) -> Any:
    """Rename one of the current user's projects."""
    project = owned_project(session, current_user, project_id)
    try:
        project = crud.rename_project(
            session=session, project=project, name=project_in.name
        )
    except IntegrityError:
        raise HTTPException(status_code=409, detail=DUPLICATE_NAME_DETAIL) from None
    members = crud.list_project_members(session=session, project_ids=[project.id])
    return _public(project, members.get(project.id, []))


@router.put("/{project_id}/video-folder", response_model=ProjectPublic)
def select_project_video_folder(
    session: SessionDep,
    current_user: CurrentUser,
    project_id: uuid.UUID,
    folder: ProjectVideoFolderInput,
) -> Any:
    """Persist one readable source-relative directory, without starting inference."""
    project = owned_project(session, current_user, project_id)
    ensure_workspace_user(current_user)
    try:
        InferenceClient().fetch_directory(folder.source_id, folder.path)
    except InferenceUnconfigured:
        raise HTTPException(503, "视频推理服务尚未配置") from None
    except InferenceUnreachable:
        raise HTTPException(503, "暂时无法连接视频推理服务") from None
    except InferenceNotFound:
        raise HTTPException(404, "目录不存在或不在允许的来源内") from None
    except InferenceUpstreamError as exc:
        raise HTTPException(
            503 if exc.status_code == 503 else 502,
            "视频来源暂时不可用，请检查连接后重试",
        ) from None
    except InferenceArtifactTooLarge:
        raise HTTPException(502, "视频目录过大，请选择更小的目录") from None
    project.video_source_id = folder.source_id
    project.video_directory = folder.path
    project.video_directory_label = folder.path.rsplit("/", 1)[-1][:255] or "根目录"
    project.updated_at = get_datetime_utc()
    session.add(project)
    session.commit()
    session.refresh(project)
    members = crud.list_project_members(session=session, project_ids=[project.id])
    return _public(project, members.get(project.id, []))


@router.delete("/{project_id}", response_model=Message)
def delete_project(
    session: SessionDep, current_user: CurrentUser, project_id: uuid.UUID
) -> Any:
    """Delete one of the current user's projects; member references cascade."""
    project = owned_project(session, current_user, project_id)
    crud.delete_project(session=session, project=project)
    return Message(message="项目已删除")


@router.post("/{project_id}/members", response_model=ProjectMemberPublic)
def add_project_member(
    session: SessionDep,
    current_user: CurrentUser,
    project_id: uuid.UUID,
    member_in: ProjectMemberAdd,
    response: Response,
) -> Any:
    """Add (or refresh the label of) one member reference; idempotent."""
    project = owned_project(session, current_user, project_id)
    member, created = crud.add_project_member(
        session=session,
        project=project,
        member_kind=member_in.kind,
        member_id=member_in.id,
        label=member_in.label,
    )
    if created:
        response.status_code = status.HTTP_201_CREATED
    return _member_public(member)


@router.delete(
    "/{project_id}/members/{member_kind}/{member_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def remove_project_member(
    session: SessionDep,
    current_user: CurrentUser,
    project_id: uuid.UUID,
    member_kind: ProjectMemberKind,
    member_id: Annotated[str, Path(min_length=1, max_length=VIDEO_ID_MAX_LENGTH)],
) -> None:
    """Remove one member reference; the referenced item itself is untouched."""
    project = owned_project(session, current_user, project_id)
    removed = crud.remove_project_member(
        session=session,
        project=project,
        member_kind=member_kind,
        member_id=member_id,
    )
    if not removed:
        raise HTTPException(status_code=404, detail="成员不在项目中")


@router.post("/import", response_model=ProjectImportResult)
def import_projects(
    session: SessionDep,
    current_user: CurrentUser,
    import_in: ProjectImportRequest,
) -> Any:
    """Import pre-entity browser-local projects once, idempotently.

    Replaying the same payload creates nothing new and never overwrites the
    projects and memberships the user has reorganized server-side.
    """
    return crud.import_local_projects(
        session=session,
        user_id=current_user.id,
        items=import_in.projects,
    )
