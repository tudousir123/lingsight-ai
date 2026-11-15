import uuid
from collections.abc import Generator
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Query, status
from fastapi.security import OAuth2PasswordBearer
from jwt.exceptions import InvalidTokenError
from pydantic import ValidationError
from sqlmodel import Session

from app import crud
from app.core import security
from app.core.config import settings
from app.core.db import engine
from app.models import Project, TokenPayload, User

reusable_oauth2 = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/login/access-token"
)


def get_db() -> Generator[Session]:
    with Session(engine) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_db)]
TokenDep = Annotated[str, Depends(reusable_oauth2)]


def user_from_token(session: Session, token: str) -> User:
    """Resolve a user from a raw JWT, shared by header and query-token auth."""
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[security.ALGORITHM]
        )
        token_data = TokenPayload(**payload)
    except InvalidTokenError, ValidationError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Could not validate credentials",
        )
    user = session.get(User, token_data.sub)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return user


def get_current_user(session: SessionDep, token: TokenDep) -> User:
    return user_from_token(session, token)


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_current_active_superuser(current_user: CurrentUser) -> User:
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=403, detail="The user doesn't have enough privileges"
        )
    return current_user


def ensure_workspace_user(user: User) -> User:
    """Every active platform account has its own workspace."""
    if not user.is_active:
        raise HTTPException(403, "Inactive user")
    return user


def owned_project(
    session: Session, current_user: User, project_id: uuid.UUID
) -> Project:
    """Resolve one of the caller's projects or 404 (shared by both routers)."""
    project = crud.get_project(
        session=session, user_id=current_user.id, project_id=project_id
    )
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project


# --- media auth ---------------------------------------------------------------
#
# <video>/<img> elements cannot send an Authorization header, so media routes
# additionally accept the session JWT as a `token` query parameter. URLs are
# assembled client-side; the token is the caller's own short-lived session
# token (and reaches access logs — an accepted trade-off, see ADR history).

_media_oauth2 = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/login/access-token", auto_error=False
)


def get_media_user(
    session: SessionDep,
    token: Annotated[str | None, Depends(_media_oauth2)] = None,
    query_token: Annotated[str | None, Query(alias="token")] = None,
) -> User:
    """Resolve the caller from a bearer header or a `token` query parameter."""
    raw = token or query_token
    if not raw:
        raise HTTPException(status_code=403, detail="Not authenticated")
    return user_from_token(session, raw)


MediaUserDep = Annotated[User, Depends(get_media_user)]
