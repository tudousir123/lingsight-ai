"""Platform-owned media; projects only reference the immutable video id."""

import uuid
from datetime import datetime

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

from app.models import Char36UUID, get_datetime_utc


class UploadedVideo(SQLModel, table=True):
    __tablename__ = "uploaded_video"
    video_id: str = Field(primary_key=True, max_length=64)
    owner_user_id: uuid.UUID = Field(
        foreign_key="user.id", ondelete="CASCADE", sa_type=Char36UUID, index=True
    )
    source_id: str = Field(max_length=64)
    filename: str = Field(max_length=255)
    format: str = Field(max_length=3)
    bytes: int
    sha256: str = Field(max_length=64)
    storage_key: str = Field(max_length=255)
    inference_storage_key: str = Field(max_length=255)
    inference_sha256: str = Field(max_length=64)
    preview_storage_key: str = Field(max_length=255)
    preview_sha256: str = Field(max_length=64)
    conversion: str = Field(max_length=64)
    frame_digest: str = Field(max_length=64)
    time_base: str = Field(max_length=64)
    width: int
    height: int
    frame_count: int
    fps: float
    created_at: datetime = Field(default_factory=get_datetime_utc)


class UploadReceipt(SQLModel, table=True):
    __tablename__ = "upload_receipt"
    __table_args__ = (
        UniqueConstraint(
            "owner_user_id", "project_id", "idempotency_key", name="uq_upload_receipt"
        ),
    )
    id: uuid.UUID = Field(
        default_factory=uuid.uuid4, primary_key=True, sa_type=Char36UUID
    )
    owner_user_id: uuid.UUID = Field(
        foreign_key="user.id", ondelete="CASCADE", sa_type=Char36UUID
    )
    project_id: uuid.UUID = Field(
        foreign_key="project.id", ondelete="CASCADE", sa_type=Char36UUID
    )
    idempotency_key: str = Field(max_length=36)
    video_id: str = Field(
        foreign_key="uploaded_video.video_id", ondelete="CASCADE", max_length=64
    )
