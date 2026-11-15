"""Platform-owned authorization and immutable confirmation records."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Column, UniqueConstraint
from sqlalchemy.dialects.mysql import DATETIME
from sqlmodel import Field, SQLModel

from app.models import Char36UUID, get_datetime_utc


class InferenceBinding(SQLModel, table=True):
    __tablename__ = "inference_binding"
    __table_args__ = (UniqueConstraint("owner_user_id", "idempotency_key"),)
    id: uuid.UUID = Field(
        default_factory=uuid.uuid4, primary_key=True, sa_type=Char36UUID
    )
    owner_user_id: uuid.UUID = Field(
        foreign_key="user.id", ondelete="CASCADE", sa_type=Char36UUID, index=True
    )
    project_id: uuid.UUID = Field(
        foreign_key="project.id", ondelete="CASCADE", sa_type=Char36UUID, index=True
    )
    video_id: str = Field(max_length=4096)
    source_kind: str = Field(max_length=32)
    source_id: str = Field(max_length=255)
    upstream_video_id: str = Field(max_length=4096)
    video_sha256: str | None = Field(default=None, max_length=64)
    original_video_sha256: str | None = Field(default=None, max_length=64)
    input_width: int | None = None
    input_height: int | None = None
    input_frame_count: int | None = None
    idempotency_key: uuid.UUID = Field(sa_type=Char36UUID)
    task_id: str | None = Field(default=None, max_length=36, unique=True)
    confirmation_id: uuid.UUID | None = Field(default=None, sa_type=Char36UUID)
    created_at: datetime = Field(default_factory=get_datetime_utc)


class PreannotationConfirmation(SQLModel, table=True):
    __tablename__ = "preannotation_confirmation"
    __table_args__ = (UniqueConstraint("owner_user_id", "idempotency_key"),)
    id: uuid.UUID = Field(
        default_factory=uuid.uuid4, primary_key=True, sa_type=Char36UUID
    )
    binding_id: uuid.UUID = Field(
        foreign_key="inference_binding.id",
        ondelete="CASCADE",
        sa_type=Char36UUID,
        index=True,
    )
    owner_user_id: uuid.UUID = Field(
        foreign_key="user.id", ondelete="CASCADE", sa_type=Char36UUID
    )
    idempotency_key: uuid.UUID = Field(sa_type=Char36UUID)
    request_sha256: str = Field(max_length=64)
    candidate_version: str = Field(max_length=64)
    video_sha256: str = Field(max_length=64)
    width: int
    height: int
    frame_count: int
    geometry: dict[str, Any] = Field(sa_column=Column(JSON, nullable=False))
    confirmed_at: datetime = Field(
        default_factory=get_datetime_utc, sa_type=DATETIME(fsp=6)
    )
    dispatch_status: str = Field(default="pending", max_length=16)
    dispatch_error: str | None = Field(default=None, max_length=64)
    dispatch_attempted: bool = False
