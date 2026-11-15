"""Current permission callback for trusted Agent workers; never browser JWTs."""

import secrets
import uuid
from typing import Annotated, Any, Self

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, model_validator
from sqlalchemy.exc import SQLAlchemyError

from app.api.deps import SessionDep
from app.contracts import DataScope, ErrorCode
from app.core.config import settings
from app.models import User
from app.scope import authorize_scope

router = APIRouter(prefix="/internal/agent", tags=["internal-agent"])


def authorize_service(authorization: Annotated[str | None, Header()] = None) -> None:
    token = settings.AGENT_AUTHORIZATION_TOKEN
    if not token:
        raise HTTPException(
            503,
            {
                "code": ErrorCode.SERVICE_UNAVAILABLE,
                "message": "Authorization callback not configured",
            },
        )
    if authorization is None or not secrets.compare_digest(
        authorization.encode(), f"Bearer {token}".encode()
    ):
        raise HTTPException(
            401,
            {
                "code": ErrorCode.AUTHENTICATION_REQUIRED,
                "message": "Service authentication required",
            },
        )


class AuthorizationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: uuid.UUID
    data_scope: DataScope
    project_id: uuid.UUID | None

    @model_validator(mode="after")
    def scope_combination(self) -> Self:
        if (self.data_scope == "project") != (self.project_id is not None):
            raise ValueError("project_id must be set only for project scope")
        return self


@router.post("/authorize", dependencies=[Depends(authorize_service)])
def authorize(body: AuthorizationInput, session: SessionDep) -> dict[str, Any]:
    try:
        user = session.get(User, body.user_id)
        if user is None or not user.is_active:
            raise HTTPException(
                403,
                {"code": ErrorCode.PERMISSION_DENIED, "message": "Account unavailable"},
            )
        return authorize_scope(session, user, body.data_scope, body.project_id)
    except HTTPException as error:
        if error.status_code == 404:
            raise HTTPException(
                404,
                {"code": ErrorCode.RESOURCE_NOT_FOUND, "message": "Project not found"},
            ) from None
        raise
    except SQLAlchemyError:
        raise HTTPException(
            503,
            {
                "code": ErrorCode.SERVICE_UNAVAILABLE,
                "message": "Authorization temporarily unavailable",
            },
        ) from None
