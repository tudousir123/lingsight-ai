"""Persisted library grants and an audit history independent of user deletion."""

import uuid
from datetime import datetime

from pydantic import StrictBool, field_validator
from sqlmodel import Field, SQLModel
from sqlmodel._compat import SQLModelConfig

from app.models import Char36UUID, get_datetime_utc


class WholeLibraryAccess(SQLModel, table=True):
    __tablename__ = "whole_library_access"
    user_id: uuid.UUID = Field(
        primary_key=True, foreign_key="user.id", ondelete="CASCADE", sa_type=Char36UUID
    )
    granted: bool = False
    reason: str = Field(max_length=1000)
    updated_by: uuid.UUID = Field(sa_type=Char36UUID)
    updated_at: datetime = Field(default_factory=get_datetime_utc)
    revision: uuid.UUID = Field(default_factory=uuid.uuid4, sa_type=Char36UUID)


class LibraryAccessAudit(SQLModel, table=True):
    __tablename__ = "library_access_audit"
    id: uuid.UUID = Field(
        default_factory=uuid.uuid4, primary_key=True, sa_type=Char36UUID
    )
    user_id: uuid.UUID = Field(index=True, sa_type=Char36UUID)
    actor_user_id: uuid.UUID = Field(sa_type=Char36UUID)
    previous_granted: bool
    granted: bool
    reason: str = Field(max_length=1000)
    created_at: datetime = Field(default_factory=get_datetime_utc)


class LibraryAccessUpdate(SQLModel):
    model_config = SQLModelConfig(extra="forbid")
    granted: StrictBool
    reason: str = Field(min_length=1, max_length=1000)

    @field_validator("reason", mode="before")
    @classmethod
    def trim_reason(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class LibraryAccessPublic(SQLModel):
    user_id: uuid.UUID
    granted: bool
    effective: bool
    reason: str | None
    updated_at: datetime | None
    updated_by: uuid.UUID | None
