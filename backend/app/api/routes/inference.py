"""Restricted gateway to the personal video inference service."""

import uuid
from typing import Any

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, ConfigDict, ValidationError
from sqlalchemy.exc import IntegrityError
from sqlmodel import col, select
from starlette.responses import StreamingResponse

from app.api.deps import (
    CurrentUser,
    MediaUserDep,
    SessionDep,
    ensure_workspace_user,
    owned_project,
)
from app.api.gateway import (
    UUID_PATTERN,
    GatewayPolicy,
    LiteralSet,
    OperationTable,
    UpstreamService,
    forward,
)
from app.core.config import settings
from app.inference_access import (
    authorize_binding,
    encode_video,
    ensure_library_video_member,
    ensure_video_folder_access,
    failure,
    owned_binding,
    relative_path,
    task_public,
    within,
)
from app.inference_client import (
    InferenceArtifactTooLarge,
    InferenceClient,
    InferenceNotFound,
    InferenceUnconfigured,
    InferenceUnreachable,
    InferenceUpstreamError,
)
from app.inference_models import InferenceBinding

router = APIRouter(prefix="/inference", tags=["inference"])

# Declared operation surface; same single-source role as the agent table
# (platform whitelist + generated frontend route templates).
OPERATIONS = OperationTable(
    operations={
        "GET": (
            "sources",
            "videos",
            "tasks",
            "tasks/{task_id}",
            "tasks/{task_id}/artifacts/{artifact_name}",
        ),
        "POST": (
            "tasks",
            "tasks/{task_id}/confirm",
            "tasks/{task_id}/cancel",
            "tasks/{task_id}/retry",
            "tasks/{task_id}/review",
        ),
    },
    params={
        "task_id": UUID_PATTERN,
        "artifact_name": LiteralSet(
            (
                "candidate.jpg",
                "overlay.mp4",
                "tracking.json",
                "keypoints.json",
                "provenance.json",
            )
        ),
    },
)

# 512_000 covers polygon confirmation payloads; 120 s covers overlay video
# streaming. Range and the directory listing's ?path= are this service's
# special cases.
POLICY = GatewayPolicy(
    body_cap_bytes=512_000,
    read_timeout_s=120,
    range_streaming=True,
    forward_client_accept=True,
    forward_path_query_routes=frozenset({"videos"}),
    forward_query_parameters={"videos": ("source_id",)},
)

UNKNOWN_OPERATION = "Unknown inference operation"


def _service() -> UpstreamService:
    return UpstreamService(
        base_url=settings.INFERENCE_BASE_URL,
        api_token=settings.INFERENCE_API_TOKEN,
        unconfigured_detail="视频推理服务尚未配置",
        connect_error_detail="暂时无法连接视频推理服务",
        upstream_error_detail="视频推理服务暂时不可用",
    )


@router.get("/{path:path}/artifacts/{name}")
async def inference_artifact(
    path: str,
    name: str,
    request: Request,
    current_user: MediaUserDep,
    session: SessionDep,
) -> StreamingResponse:
    # Media elements cannot send an Authorization header, so artifacts
    # authenticate through deps.get_media_user (header or ?token=).
    full = f"{path}/artifacts/{name}"
    OPERATIONS.check("GET", full, UNKNOWN_OPERATION)
    ensure_workspace_user(current_user)
    owned_binding(session, current_user, path.split("/")[1])
    return await forward(request, full, _service(), POLICY)


class TaskCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_id: uuid.UUID
    video_id: str


async def bounded_json(request: Request) -> Any:
    import json

    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > POLICY.body_cap_bytes:
            raise failure(413, "payload_too_large", "Request body too large")
    try:
        return json.loads(body)
    except ValueError, UnicodeError:
        raise failure(422, "invalid_input", "Invalid JSON") from None


def idempotency_key(request: Request) -> uuid.UUID:
    try:
        return uuid.UUID(request.headers.get("Idempotency-Key", ""))
    except ValueError:
        raise failure(422, "invalid_input", "Idempotency-Key must be a UUID") from None


def upstream_error(exc: Exception) -> None:
    if isinstance(exc, InferenceNotFound):
        raise failure(404, "resource_not_found", "Inference resource not found")
    if isinstance(exc, (InferenceUnconfigured, InferenceUnreachable)):
        raise failure(503, "service_unavailable", "Inference service unavailable")
    if isinstance(exc, InferenceUpstreamError) and exc.status_code in (409, 422):
        raise failure(
            exc.status_code,
            "state_conflict" if exc.status_code == 409 else "invalid_input",
            "Inference request refused",
        )
    raise failure(502, "upstream_error", "Inference service failed")


UPSTREAM_ERRORS = (
    InferenceUnconfigured,
    InferenceUnreachable,
    InferenceUpstreamError,
    InferenceNotFound,
    InferenceArtifactTooLarge,
)


@router.api_route("/{path:path}", methods=["GET", "POST"])
async def inference_gateway(
    path: str,
    request: Request,
    current_user: CurrentUser,
    session: SessionDep,
    response: Response,
) -> Any:
    OPERATIONS.check(request.method, path, UNKNOWN_OPERATION)
    ensure_workspace_user(current_user)
    client = InferenceClient()
    try:
        if path == "tasks" and request.method == "POST":
            try:
                data = TaskCreate.model_validate(await bounded_json(request))
            except ValidationError:
                raise failure(
                    422, "invalid_input", "project_id and video_id are required"
                ) from None
            key = idempotency_key(request)
            project = owned_project(session, current_user, data.project_id)
            existing = session.exec(
                select(InferenceBinding).where(
                    InferenceBinding.owner_user_id == current_user.id,
                    InferenceBinding.idempotency_key == key,
                )
            ).first()
            if existing:
                if (
                    existing.project_id != data.project_id
                    or existing.video_id != data.video_id
                ):
                    raise failure(
                        409,
                        "idempotency_conflict",
                        "Idempotency key has different input",
                    )
                authorize_binding(session, current_user, existing)
                if not existing.task_id:
                    raise failure(
                        503,
                        "service_unavailable",
                        "Task creation outcome is unresolved; do not create another task",
                    )
                return task_public(client.fetch_task(existing.task_id), existing)
            from app.upload_models import UploadedVideo
            from app.uploads import inference_input, owned_video

            upload = session.get(UploadedVideo, data.video_id)
            if upload is not None or data.video_id.startswith("upload-"):
                upload = owned_video(session, current_user, project.id, data.video_id)
                source, relative = inference_input(upload)
                binding = InferenceBinding(
                    owner_user_id=current_user.id,
                    project_id=project.id,
                    video_id=upload.video_id,
                    source_kind="user_upload",
                    source_id=source,
                    upstream_video_id=encode_video(source, relative),
                    video_sha256=upload.inference_sha256,
                    original_video_sha256=upload.sha256,
                    idempotency_key=key,
                )
            else:
                ensure_library_video_member(
                    session, current_user, project, data.video_id
                )
                binding = InferenceBinding(
                    owner_user_id=current_user.id,
                    project_id=project.id,
                    video_id=data.video_id,
                    source_kind="filesystem",
                    source_id=project.video_source_id or "",
                    upstream_video_id=data.video_id,
                    idempotency_key=key,
                )
            session.add(binding)
            try:
                session.commit()
            except IntegrityError:
                session.rollback()
                raise failure(
                    409, "state_conflict", "Task creation already in progress"
                ) from None
            # An ambiguous HTTP result leaves the durable reservation. Never retry create blindly.
            task = client.request_json(
                "POST",
                "tasks",
                {"video_id": binding.upstream_video_id},
                idempotency_key=str(key),
            )
            try:
                binding.task_id = str(uuid.UUID(task["id"]))
            except ValueError, KeyError, TypeError:
                raise failure(502, "upstream_error", "Invalid task identity") from None
            result = task_public(task, binding)
            session.add(binding)
            session.commit()
            response.status_code = 202
            return result
        if path == "tasks":
            project_id = request.query_params.get("project_id")
            query = select(InferenceBinding).where(
                InferenceBinding.owner_user_id == current_user.id,
                col(InferenceBinding.task_id).is_not(None),
            )
            if project_id:
                try:
                    project = owned_project(
                        session, current_user, uuid.UUID(project_id)
                    )
                except ValueError:
                    raise failure(422, "invalid_input", "Invalid project ID") from None
                query = query.where(InferenceBinding.project_id == project.id)
            items = []
            for binding in session.exec(query).all():
                try:
                    authorize_binding(session, current_user, binding)
                except Exception as exc:
                    from fastapi import HTTPException

                    if isinstance(exc, HTTPException) and exc.status_code in (
                        403,
                        404,
                        409,
                    ):
                        continue
                    raise
                if binding.task_id:
                    items.append(
                        task_public(client.fetch_task(binding.task_id), binding)
                    )
            return items
        if path == "sources":
            from app.inference_access import InferenceAccessSettings
            from app.scope import allowed_experiment_ids

            allowed = allowed_experiment_ids(session, current_user)
            mapping = InferenceAccessSettings().INFERENCE_EXPERIMENT_DIRECTORIES
            visible = {
                source
                for source, experiments in mapping.items()
                if any(
                    allowed is None or experiment in allowed
                    for experiment in experiments
                )
            }
            items = (
                client.request_json("GET", "sources").get("items", [])
                if visible
                else []
            )
            source_items = [item for item in items if item.get("id") in visible]
            source_items.append(
                {
                    "id": f"upload-{current_user.id.hex}",
                    "label": "My uploads",
                    "kind": "user_upload",
                    "available": True,
                }
            )
            return source_items
        if path == "videos":
            source = request.query_params.get("source_id", "legacy")
            directory = relative_path(request.query_params.get("path", ""))
            ensure_video_folder_access(session, current_user, source, directory)
            try:
                project = owned_project(
                    session,
                    current_user,
                    uuid.UUID(request.query_params.get("project_id", "")),
                )
            except ValueError:
                raise failure(422, "invalid_input", "project_id is required") from None
            if (
                project.video_source_id != source
                or project.video_directory is None
                or not within(directory, project.video_directory)
            ):
                raise failure(
                    404, "resource_not_found", "Directory is not in project folder"
                )
            return client.fetch_directory(source, directory)["items"]
        task_id = path.split("/")[1]
        binding = owned_binding(session, current_user, task_id)
        if path.endswith("/confirm"):
            raise failure(
                409,
                "project_confirmation_required",
                "Use project preannotation confirmations",
            )
        if request.method == "GET":
            return task_public(client.fetch_task(task_id), binding)
        payload = await bounded_json(request) if path.endswith("/review") else None
        if path.endswith("/retry") and binding.confirmation_id:
            from app.preannotations import verify_consumed_confirmation

            verify_consumed_confirmation(session, binding, client.fetch_task(task_id))
        return task_public(client.request_json("POST", path, payload), binding)
    except UPSTREAM_ERRORS as exc:
        upstream_error(exc)
