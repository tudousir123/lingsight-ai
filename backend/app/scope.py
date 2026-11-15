"""Current platform data authorization; project grouping never grants access."""

import hashlib
import json
import uuid
from typing import Any, TypeGuard, get_args

import httpx
from fastapi import HTTPException
from sqlmodel import Session, select

from app.api.deps import owned_project
from app.contracts import DataScope, ErrorCode
from app.core.config import settings
from app.models import ExperimentAccess, User
from app.scope_models import WholeLibraryAccess


def has_whole_library_access(session: Session, user: User) -> bool:
    if not user.is_active:
        return False
    if user.is_superuser:
        return True
    grant = session.get(WholeLibraryAccess, user.id)
    return grant is not None and grant.granted


def allowed_experiment_ids(session: Session, user: User) -> set[str] | None:
    if has_whole_library_access(session, user):
        return None
    if not user.is_active:
        return set()
    return set(
        session.exec(
            select(ExperimentAccess.experiment_id).where(
                ExperimentAccess.user_id == user.id
            )
        ).all()
    )


AGENT_CAPABILITIES = {
    "user_scope": "platform-user-v1",
    "data_scope": "authorized-v1",
    "qa_completion": "intent-v1",
    "project_scope": "immutable-v1",
}


def capable_agent(capabilities: object, *, project: bool = False) -> bool:
    return (
        isinstance(capabilities, dict)
        and all(
            capabilities.get(key) == value for key, value in AGENT_CAPABILITIES.items()
        )
        and (not project or capabilities.get("project_data_configured") is True)
    )


def is_data_scope(value: object) -> TypeGuard[DataScope]:
    return isinstance(value, str) and value in get_args(DataScope)


def authorize_scope(
    session: Session, user: User, data_scope: DataScope, project_id: uuid.UUID | None
) -> dict[str, Any]:
    if not user.is_active:
        raise HTTPException(
            403, {"code": ErrorCode.PERMISSION_DENIED, "message": "Inactive account"}
        )
    publications: list[str] = []
    if data_scope == "project":
        if project_id is None:
            raise HTTPException(
                422, {"code": ErrorCode.INVALID_INPUT, "message": "project_id required"}
            )
        owned_project(session, user, project_id)
        # Publication visibility includes current original-input authorization;
        # a stale project reference alone never grants data access.
        from app.inference_access import visible_publication_ids

        publications = sorted(visible_publication_ids(session, user, project_id))
    elif project_id is not None:
        raise HTTPException(
            422, {"code": ErrorCode.INVALID_INPUT, "message": "project_id forbidden"}
        )
    elif data_scope == "whole_library" and not has_whole_library_access(session, user):
        raise HTTPException(
            403,
            {
                "code": ErrorCode.PERMISSION_DENIED,
                "message": "Whole-library access denied",
            },
        )
    grant = session.get(WholeLibraryAccess, user.id)
    revision_inputs = {
        "user_id": str(user.id),
        "superuser": user.is_superuser,
        "grant_revision": str(grant.revision) if grant else None,
        "experiment_ids": sorted(allowed_experiment_ids(session, user) or []),
        "data_scope": data_scope,
        "project_id": str(project_id) if project_id else None,
        "publications": publications,
    }
    revision = hashlib.sha256(
        json.dumps(revision_inputs, sort_keys=True).encode()
    ).hexdigest()
    return {
        "allowed": True,
        "user_id": str(user.id),
        "data_scope": data_scope,
        "project_id": str(project_id) if project_id else None,
        "authorization_revision": revision,
        "allowed_publication_task_ids": publications,
    }


def ensure_agent_task_owner(session: Session, user: User, task_id: str) -> None:
    """Verify a task against the capable Agent, never infer owner from references."""
    try:
        parsed_id = uuid.UUID(task_id)
    except ValueError, AttributeError:
        raise HTTPException(
            404, {"code": ErrorCode.RESOURCE_NOT_FOUND, "message": "Task not found"}
        ) from None
    if not settings.AGENT_API_TOKEN:
        raise HTTPException(
            503, {"code": ErrorCode.SERVICE_UNAVAILABLE, "message": "Agent unavailable"}
        )
    headers = {
        "Authorization": f"Bearer {settings.AGENT_API_TOKEN}",
        "X-LingSight-User-Id": str(user.id),
    }
    try:
        with httpx.Client(
            timeout=10, trust_env=False, follow_redirects=False
        ) as client:
            base = settings.AGENT_BASE_URL.rstrip("/")
            capabilities = client.get(f"{base}/v1/capabilities", headers=headers)
            if capabilities.status_code != 200 or not capable_agent(
                capabilities.json()
            ):
                raise HTTPException(
                    503,
                    {
                        "code": ErrorCode.SERVICE_UNAVAILABLE,
                        "message": "Agent capabilities unavailable",
                    },
                )
            response = client.get(f"{base}/v1/tasks/{parsed_id}", headers=headers)
            if response.status_code in {403, 404}:
                raise HTTPException(
                    response.status_code,
                    {
                        "code": ErrorCode.PERMISSION_DENIED
                        if response.status_code == 403
                        else ErrorCode.RESOURCE_NOT_FOUND,
                        "message": "Task unavailable",
                    },
                )
            if response.status_code != 200:
                raise HTTPException(
                    503,
                    {
                        "code": ErrorCode.SERVICE_UNAVAILABLE,
                        "message": "Agent unavailable",
                    },
                )
            task = response.json()
    except httpx.HTTPError, ValueError:
        raise HTTPException(
            503, {"code": ErrorCode.SERVICE_UNAVAILABLE, "message": "Agent unavailable"}
        ) from None
    if (
        not isinstance(task, dict)
        or task.get("owner_user_id") != str(user.id)
        or task.get("id") != str(parsed_id)
    ):
        raise HTTPException(
            404, {"code": ErrorCode.RESOURCE_NOT_FOUND, "message": "Task not found"}
        )
    data_scope = task.get("data_scope")
    if not is_data_scope(data_scope):
        raise HTTPException(
            503,
            {
                "code": ErrorCode.SERVICE_UNAVAILABLE,
                "message": "Invalid Agent task scope",
            },
        )
    try:
        project_id = (
            uuid.UUID(task["project_id"])
            if task.get("project_id") is not None
            else None
        )
    except ValueError, TypeError, AttributeError:
        raise HTTPException(
            503,
            {"code": ErrorCode.SERVICE_UNAVAILABLE, "message": "Invalid Agent project"},
        ) from None
    authorize_scope(session, user, data_scope, project_id)
