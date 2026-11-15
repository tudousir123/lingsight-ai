"""Current permission callback for trusted Agent workers; never browser JWTs."""

import secrets
import uuid
from typing import Annotated, Any, Self

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, model_validator
from sqlalchemy.exc import SQLAlchemyError

from app.api.deps import SessionDep
from app.core.config import settings
from app.models import User
from app.scope import DataScope, authorize_scope

router = APIRouter(prefix="/internal/agent", tags=["internal-agent"])


def authorize_service(authorization: Annotated[str | None, Header()] = None) -> None:
    token = settings.AGENT_AUTHORIZATION_TOKEN
    if not token:
        raise HTTPException(
            503,
            {
                "code": "service_unavailable",
                "message": "Authorization callback not configured",
            },
        )
    if authorization is None or not secrets.compare_digest(
        authorization, f"Bearer {token}"
    ):
        raise HTTPException(
            401,
            {
                "code": "authentication_required",
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
                403, {"code": "permission_denied", "message": "Account unavailable"}
            )
        return authorize_scope(session, user, body.data_scope, body.project_id)
    except SQLAlchemyError:
        raise HTTPException(
            503,
            {
                "code": "service_unavailable",
                "message": "Authorization temporarily unavailable",
            },
        ) from None
