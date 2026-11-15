"""Current input authorization, never inferred from shared task references."""

import base64
import json
import uuid
from pathlib import PurePosixPath
from typing import Any

from fastapi import HTTPException
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlmodel import Session, select

from app.api.deps import owned_project
from app.contracts import ErrorCode
from app.inference_models import InferenceBinding
from app.models import Project, PublishedResult, User


class InferenceAccessSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")
    # Explicit source -> experiment -> relative directory. Never infer from names.
    INFERENCE_EXPERIMENT_DIRECTORIES: dict[str, dict[str, str]] = {}


def failure(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, {"code": code, "message": message})


def relative_path(value: str) -> str:
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or "\\" in value or "\x00" in value:
        raise failure(422, ErrorCode.INVALID_INPUT, "Invalid source-relative path")
    return "" if str(path) == "." else str(path)


def within(path: str, directory: str) -> bool:
    return directory == "" or path == directory or path.startswith(directory + "/")


def ensure_video_folder_access(
    session: Session, user: User, source_id: str, path: str
) -> None:
    from app.media_settings import MediaSettings
    from app.scope import allowed_experiment_ids

    path = relative_path(path)
    if source_id == MediaSettings().PLATFORM_MEDIA_INFERENCE_SOURCE_ID:
        raise failure(
            403,
            ErrorCode.PERMISSION_DENIED,
            "Platform media is accessible only through owned uploads",
        )
    if source_id.startswith("upload-"):
        raise failure(
            422, ErrorCode.INVALID_INPUT, "Use the project videos API for user uploads"
        )
    mapping = InferenceAccessSettings().INFERENCE_EXPERIMENT_DIRECTORIES.get(
        source_id, {}
    )
    allowed = allowed_experiment_ids(session, user)
    if not mapping or not any(
        (allowed is None or experiment in allowed)
        and within(path, relative_path(directory))
        for experiment, directory in mapping.items()
    ):
        raise failure(
            403, ErrorCode.PERMISSION_DENIED, "Video source scope is not authorized"
        )


def encode_video(source: str, path: str) -> str:
    raw = json.dumps(
        {"s": source, "p": relative_path(path)},
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return "v1." + base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode_video(video_id: str) -> tuple[str, str]:
    try:
        value = video_id[3:] if video_id.startswith("v1.") else video_id
        raw = base64.b64decode(
            value + "=" * (-len(value) % 4), altchars=b"-_", validate=True
        ).decode()
        if video_id.startswith("v1."):
            data = json.loads(raw)
            if not isinstance(data, dict) or set(data) != {"s", "p"}:
                raise ValueError
            source, path = data["s"], data["p"]
        else:
            source, path = "legacy", raw
        if (
            not isinstance(source, str)
            or not isinstance(path, str)
            or not path
            or not path.lower().endswith(".mp4")
        ):
            raise ValueError
        return source, relative_path(path)
    except ValueError, UnicodeError, TypeError, KeyError:
        raise failure(
            422, ErrorCode.INVALID_INPUT, "Invalid video identifier"
        ) from None


def ensure_library_video_member(
    session: Session, user: User, project: Project, video_id: str
) -> None:
    from app.inference_client import InferenceClient

    source, path = decode_video(video_id)
    directory = str(PurePosixPath(path).parent)
    directory = "" if directory == "." else directory
    if (
        source != project.video_source_id
        or project.video_directory is None
        or not within(path, project.video_directory)
    ):
        raise failure(
            404, ErrorCode.RESOURCE_NOT_FOUND, "Video is not in the project folder"
        )
    ensure_video_folder_access(session, user, source, directory)
    from app.inference_client import (
        InferenceArtifactTooLarge,
        InferenceNotFound,
        InferenceUnconfigured,
        InferenceUnreachable,
        InferenceUpstreamError,
    )

    try:
        listing = InferenceClient().fetch_directory(source, directory)
    except InferenceUnconfigured, InferenceUnreachable:
        raise failure(
            503, ErrorCode.SERVICE_UNAVAILABLE, "Video source unavailable"
        ) from None
    except InferenceNotFound:
        raise failure(404, ErrorCode.RESOURCE_NOT_FOUND, "Video not found") from None
    except InferenceUpstreamError, InferenceArtifactTooLarge:
        raise failure(502, ErrorCode.UPSTREAM_ERROR, "Video source failed") from None
    if not any(
        item.get("type") == "video" and item.get("id") == video_id
        for item in listing["items"]
        if isinstance(item, dict)
    ):
        raise failure(404, ErrorCode.RESOURCE_NOT_FOUND, "Video not found")


def authorize_binding(session: Session, user: User, binding: InferenceBinding) -> None:
    if binding.owner_user_id != user.id:
        raise failure(404, ErrorCode.RESOURCE_NOT_FOUND, "Task not found")
    project = owned_project(session, user, binding.project_id)
    if binding.source_kind == "user_upload":
        from app.uploads import owned_video

        video = owned_video(session, user, project.id, binding.video_id)
        if (
            video.inference_sha256 != binding.video_sha256
            or video.sha256 != binding.original_video_sha256
        ):
            raise failure(409, ErrorCode.STATE_CONFLICT, "Video input changed")
    else:
        source, path = decode_video(binding.video_id)
        if (
            project.video_source_id != source
            or project.video_directory is None
            or not within(path, project.video_directory)
        ):
            raise failure(
                404, ErrorCode.RESOURCE_NOT_FOUND, "Video is not in project folder"
            )
        ensure_video_folder_access(
            session, user, source, relative_path(str(PurePosixPath(path).parent))
        )


def owned_binding(
    session: Session, user: User, task_id: str, *, lock: bool = False
) -> InferenceBinding:
    query = select(InferenceBinding).where(
        InferenceBinding.task_id == task_id, InferenceBinding.owner_user_id == user.id
    )
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    binding = session.exec(query).first()
    if binding is None:
        raise failure(404, ErrorCode.RESOURCE_NOT_FOUND, "Task not found")
    authorize_binding(session, user, binding)
    return binding


def visible_publication_ids(
    session: Session, user: User, project_id: uuid.UUID
) -> list[str]:
    owned_project(session, user, project_id)
    visible = []
    for result in session.exec(
        select(PublishedResult).where(
            PublishedResult.project_id == project_id, PublishedResult.user_id == user.id
        )
    ).all():
        try:
            binding = owned_binding(session, user, result.task_id)
            if (
                binding.project_id == project_id
                and binding.video_id == result.video_id
                and binding.video_sha256 == result.video_sha256
                and binding.confirmation_id == result.confirmation_id
            ):
                visible.append(result.task_id)
        except HTTPException as exc:
            if exc.status_code not in (403, 404, 409):
                raise
    return visible


def geometry_public(value: Any) -> Any:
    if not isinstance(value, dict):
        return None
    result: dict[str, Any] = {}
    for key, fields in (
        ("seed", ("frame", "x", "y")),
        ("pool", ("cx", "cy", "radius")),
    ):
        item = value.get(key)
        result[key] = (
            {name: item.get(name) for name in fields}
            if isinstance(item, dict)
            else None
        )
    result["marks"] = (
        [
            {
                key: mark[key]
                for key in ("label", "polygon", "confidence")
                if key in mark
            }
            for mark in value.get("marks", [])
            if isinstance(mark, dict)
        ]
        if isinstance(value.get("marks"), list)
        else []
    )
    return result


def candidate_public(value: Any) -> Any:
    if not isinstance(value, dict):
        return None
    return {
        **geometry_public(value),
        **{
            key: value.get(key)
            for key in (
                "width",
                "height",
                "frame_count",
                "fps",
                "video_sha256",
                "candidate_frame",
            )
        },
    }


def task_public(task: dict[str, Any], binding: InferenceBinding) -> dict[str, Any]:
    if (
        task.get("id") != binding.task_id
        or task.get("video_id") != binding.upstream_video_id
    ):
        raise failure(502, ErrorCode.UPSTREAM_ERROR, "Inference task identity mismatch")
    return {
        **{key: task.get(key) for key in ("id", "status", "stage")},
        "error": "Inference task failed" if task.get("error") else None,
        "candidate": candidate_public(task.get("candidate")),
        "confirmed": geometry_public(task.get("confirmed")),
        "review": {key: task["review"].get(key) for key in ("tracking_ok", "note")}
        if isinstance(task.get("review"), dict)
        else None,
        "video_id": binding.video_id,
        "project_id": str(binding.project_id),
        "source_kind": binding.source_kind,
        "confirmation_id": str(binding.confirmation_id)
        if binding.confirmation_id
        else None,
    }
