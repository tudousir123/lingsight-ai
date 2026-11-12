import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import EmailStr, field_validator
from pydantic import Field as PydanticField
from sqlalchemy import (
    CHAR,
    BigInteger,
    Column,
    Dialect,
    Text,
    TypeDecorator,
    UniqueConstraint,
)
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlmodel import Field, SQLModel

VIDEO_ID_MAX_LENGTH = 4096


def get_datetime_utc() -> datetime:
    return datetime.now(UTC)


class Char36UUID(TypeDecorator[uuid.UUID]):
    """UUID as CHAR(36) on every backend.

    MySQL has no native UUID type and SQLAlchemy's Uuid(native_uuid=False)
    would store CHAR(32) without dashes; CHAR(36) keeps the canonical,
    human-readable form (same as MySQL's UUID() output) and stays portable.
    """

    impl = CHAR(36)
    cache_ok = True

    def process_bind_param(
        self, value: uuid.UUID | None, dialect: Dialect
    ) -> str | None:
        if value is None:
            return value
        return str(value)

    def process_result_value(
        self, value: str | None, dialect: Dialect
    ) -> uuid.UUID | None:
        if value is None:
            return value
        return uuid.UUID(value)


# Shared properties
class UserBase(SQLModel):
    email: EmailStr = Field(unique=True, index=True, max_length=255)
    is_active: bool = True
    is_superuser: bool = False
    full_name: str | None = Field(default=None, max_length=255)


# Properties to receive via API on creation
class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)


class UserRegister(SQLModel):
    email: EmailStr = Field(max_length=255)
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = Field(default=None, max_length=255)


# Properties to receive via API on update, all are optional
class UserUpdate(SQLModel):
    email: EmailStr | None = Field(default=None, max_length=255)
    is_active: bool | None = None
    is_superuser: bool | None = None
    full_name: str | None = Field(default=None, max_length=255)
    password: str | None = Field(default=None, min_length=8, max_length=128)


class UserUpdateMe(SQLModel):
    full_name: str | None = Field(default=None, max_length=255)
    email: EmailStr | None = Field(default=None, max_length=255)


class UpdatePassword(SQLModel):
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


# Database model, database table inferred from class name
class User(UserBase, table=True):
    id: uuid.UUID = Field(
        default_factory=uuid.uuid4, primary_key=True, sa_type=Char36UUID
    )
    hashed_password: str
    created_at: datetime | None = Field(default_factory=get_datetime_utc)


class ExperimentAccess(SQLModel, table=True):
    """Explicit permission to browse one research experiment/dataset."""

    __tablename__ = "experiment_access"

    user_id: uuid.UUID = Field(
        foreign_key="user.id",
        primary_key=True,
        ondelete="CASCADE",
        sa_type=Char36UUID,
    )
    experiment_id: str = Field(primary_key=True, max_length=64)


class TrialReview(SQLModel, table=True):
    """Human preparation review of one trial, bound to the reviewed sources.

    Separate from the inference ``qc_status``: this row only records what a
    researcher manually acknowledged about pool boundary, markers, platform
    reference and tracking. One row per (user, experiment, trial, source version); drafts are
    partial, ``confirmed`` requires all four acknowledgements server-side.
    """

    __tablename__ = "trial_review"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "experiment_id",
            "trial_id",
            "source_version",
            name="uq_trial_review_source",
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4, primary_key=True, sa_type=Char36UUID
    )
    user_id: uuid.UUID = Field(
        foreign_key="user.id",
        nullable=False,
        index=True,
        ondelete="CASCADE",
        sa_type=Char36UUID,
    )
    experiment_id: str = Field(nullable=False, max_length=64)
    trial_id: str = Field(nullable=False, max_length=128)
    source_version: str = Field(nullable=False, max_length=64)
    boundary_ok: bool = False
    markers_ok: bool = False
    platform_ok: bool = False
    tracking_ok: bool = False
    state: str = Field(default="draft", max_length=16)
    confirmed_at: datetime | None = None
    created_at: datetime | None = Field(default_factory=get_datetime_utc)
    updated_at: datetime | None = Field(default_factory=get_datetime_utc)


class Project(SQLModel, table=True):
    """User-owned research organization unit (GLOSSARY: 项目/Project).

    Members reference items owned by other services (agent tasks, inference
    videos) by id; the platform only owns the grouping, never the items.
    """

    __tablename__ = "project"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_project_user_name"),)

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4, primary_key=True, sa_type=Char36UUID
    )
    user_id: uuid.UUID = Field(
        foreign_key="user.id",
        nullable=False,
        ondelete="CASCADE",
        sa_type=Char36UUID,
    )
    name: str = Field(nullable=False, max_length=80)
    video_source_id: str | None = Field(default=None, max_length=64)
    video_directory: str | None = Field(
        default=None, sa_column=Column(Text, nullable=True)
    )
    video_directory_label: str | None = Field(default=None, max_length=255)
    created_at: datetime | None = Field(default_factory=get_datetime_utc)
    updated_at: datetime | None = Field(default_factory=get_datetime_utc)


class ProjectMember(SQLModel, table=True):
    """Reference from a project to one upstream-owned item.

    ``member_kind``/``member_id`` have no foreign key on purpose: the
    referenced rows live in the agent/inference services, not this database.
    """

    __tablename__ = "project_member"

    project_id: uuid.UUID = Field(
        foreign_key="project.id",
        primary_key=True,
        ondelete="CASCADE",
        sa_type=Char36UUID,
    )
    member_kind: str = Field(primary_key=True, max_length=16)
    member_key: str = Field(primary_key=True, max_length=64)
    member_id: str = Field(sa_column=Column(Text, nullable=False))
    label: str | None = Field(default=None, max_length=255)
    added_at: datetime | None = Field(default_factory=get_datetime_utc)


class PublishedResult(SQLModel, table=True):
    """Published inference result: task-level summary and publish record.

    One row per inference task (``task_id`` is the upstream task id, no
    foreign key — the row lives in lingsight-inference). Written only after a
    human review passed upstream; whole-version semantics live in
    ``published_frame`` which cascades on this row. Mirrors the v3 ``videos``
    shape plus publish provenance (artifact hashes, review snapshot,
    content fingerprint for idempotent replay).
    """

    __tablename__ = "published_result"

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4, primary_key=True, sa_type=Char36UUID
    )
    # The unique constraint is the index; no separate task_id index.
    task_id: str = Field(nullable=False, max_length=36, unique=True)
    project_id: uuid.UUID = Field(
        foreign_key="project.id",
        nullable=False,
        index=True,
        ondelete="CASCADE",
        sa_type=Char36UUID,
    )
    user_id: uuid.UUID = Field(
        foreign_key="user.id",
        nullable=False,
        ondelete="CASCADE",
        sa_type=Char36UUID,
    )
    video_id: str = Field(nullable=False, max_length=VIDEO_ID_MAX_LENGTH)
    fps: float = Field(nullable=False)
    total_frames: int = Field(nullable=False)
    valid_frames: int = Field(nullable=False)
    frames_with_heading: int = Field(nullable=False)
    proposal_frames: int = Field(nullable=False)
    video_sha256: str = Field(nullable=False, max_length=64)
    first_frame_model_sha256: str = Field(nullable=False, max_length=64)
    mark_model_sha256: str = Field(nullable=False, max_length=64)
    tracking_model_sha256: str = Field(nullable=False, max_length=64)
    v9_model_sha256: str = Field(nullable=False, max_length=64)
    tracking_json_sha256: str = Field(nullable=False, max_length=64)
    keypoints_json_sha256: str = Field(nullable=False, max_length=64)
    provenance_json_sha256: str = Field(nullable=False, max_length=64)
    overlay_sha256: str = Field(nullable=False, max_length=64)
    overlay_bytes: int = Field(nullable=False, sa_type=BigInteger)
    heading_algorithm: str = Field(nullable=False, max_length=64)
    keypoint_protocol: str = Field(nullable=False, max_length=128)
    content_fingerprint: str = Field(nullable=False, max_length=64)
    review_tracking_ok: bool = Field(nullable=False, default=True)
    review_note: str | None = Field(default=None, max_length=2000)
    published_at: datetime | None = Field(default_factory=get_datetime_utc)


class PublishedFrame(SQLModel, table=True):
    """Per-frame row of a published result, in the v3 ``frames`` shape.

    Only frames with a heading go in (``ok`` and ``ok_proposal`` alike);
    invalid frames stay out — the summary counts in ``published_result``
    carry the denominators. ``head``/``tail`` are the v9 artifact values;
    ``keypoint_correction`` is the polarity marker the frozen heading step
    applied (swap it when aligning with the v3 form). ``task_id`` references
    the unique column in ``published_result`` so the whole version is
    replaced/deleted together.
    """

    __tablename__ = "published_frame"

    task_id: str = Field(
        foreign_key="published_result.task_id",
        primary_key=True,
        max_length=36,
        ondelete="CASCADE",
    )
    frame_idx: int = Field(primary_key=True)
    mask_valid: bool = Field(nullable=False, default=True)
    centroid_x: float | None = Field(default=None)
    centroid_y: float | None = Field(default=None)
    contour_area: float | None = Field(default=None)
    mask_rle_counts: str | None = Field(default=None, sa_column=Column(LONGTEXT))
    mask_width: int | None = Field(default=None)
    mask_height: int | None = Field(default=None)
    rle_format: str | None = Field(default=None, max_length=32)
    head_x: float | None = Field(default=None)
    head_y: float | None = Field(default=None)
    tail_x: float | None = Field(default=None)
    tail_y: float | None = Field(default=None)
    heading_angle_deg: float = Field(nullable=False)
    is_proposal: bool = Field(nullable=False, default=False)
    keypoint_correction: str = Field(nullable=False, max_length=32, default="")


# Properties to return via API, id is always required
class UserPublic(UserBase):
    id: uuid.UUID
    created_at: datetime | None = None


class UsersPublic(SQLModel):
    data: list[UserPublic]
    count: int


# Generic message
class Message(SQLModel):
    message: str


# JSON payload containing access token
class Token(SQLModel):
    access_token: str
    token_type: str = "bearer"


# Contents of JWT token
class TokenPayload(SQLModel):
    sub: str | None = None


class NewPassword(SQLModel):
    token: str
    new_password: str = Field(min_length=8, max_length=128)


ProjectMemberKind = Literal["agent_task", "video"]


class ProjectNameBase(SQLModel):
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        name = value.strip()
        if not name:
            raise ValueError("项目名称不能为空白")
        return name


class ProjectCreate(ProjectNameBase):
    pass


class ProjectRename(ProjectNameBase):
    pass


class ProjectMemberAdd(SQLModel):
    kind: ProjectMemberKind
    id: str = Field(min_length=1, max_length=VIDEO_ID_MAX_LENGTH)
    label: str | None = Field(default=None, max_length=255)


class ProjectMemberPublic(SQLModel):
    kind: ProjectMemberKind
    id: str
    label: str | None = None
    added_at: datetime | None = None


class ProjectVideoFolderInput(SQLModel):
    source_id: str = PydanticField(
        min_length=1, max_length=64, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]*$"
    )
    path: str = Field(default="", max_length=4096)

    @field_validator("path")
    @classmethod
    def relative_directory(cls, value: str) -> str:
        if (
            value.startswith("/")
            or "\\" in value
            or any(ord(c) < 32 for c in value)
            or ".." in value.split("/")
        ):
            raise ValueError("请选择来源内的相对目录")
        return "/".join(p for p in value.split("/") if p and p != ".")


class ProjectVideoFolderPublic(ProjectVideoFolderInput):
    label: str


class ProjectPublic(SQLModel):
    id: uuid.UUID
    name: str
    created_at: datetime | None = None
    updated_at: datetime | None = None
    members: list[ProjectMemberPublic] = []
    video_folder: ProjectVideoFolderPublic | None = None


class ProjectsPublic(SQLModel):
    data: list[ProjectPublic]
    count: int


class ProjectImportItem(ProjectNameBase):
    """One browser-local project folder from the pre-entity localStorage era."""

    task_ids: list[Annotated[str, Field(min_length=1, max_length=128)]] = Field(
        default_factory=list,
        max_length=5000,
    )


class ProjectImportRequest(SQLModel):
    projects: list[ProjectImportItem] = Field(default_factory=list, max_length=100)


class ProjectImportResult(SQLModel):
    created: int
    skipped: int


# --- published inference results (ticket #43) ---------------------------------
#
# Request/response shapes of the publish pipeline. The gate and conversion
# rules live in app/publishing.py; these only pin the wire contract.


class PublishRequest(SQLModel):
    """Publish one reviewed inference task's results into a project."""

    task_id: str = Field(min_length=36, max_length=36)

    @field_validator("task_id")
    @classmethod
    def canonical_task_id(cls, value: str) -> str:
        # This identifier enters a service URL; length alone allows traversal.
        return str(uuid.UUID(value))


class PublishedResultPublic(SQLModel):
    task_id: str
    project_id: uuid.UUID
    video_id: str
    fps: float
    total_frames: int
    valid_frames: int
    frames_with_heading: int
    proposal_frames: int
    heading_algorithm: str
    keypoint_protocol: str
    video_sha256: str
    content_fingerprint: str
    review_note: str | None = None
    published_at: datetime | None = None
    # True when this call replayed the already-published identical version
    # instead of writing a new one.
    replayed: bool = False


class PublishedResultsPublic(SQLModel):
    data: list[PublishedResultPublic]
    count: int


class PublishedFramePublic(SQLModel):
    """One frame row of a published result (no mask RLE — too large to list)."""

    frame_idx: int
    mask_valid: bool
    centroid_x: float | None = None
    centroid_y: float | None = None
    contour_area: float | None = None
    head_x: float | None = None
    head_y: float | None = None
    tail_x: float | None = None
    tail_y: float | None = None
    heading_angle_deg: float
    is_proposal: bool
    keypoint_correction: str


class PublishedFramesPublic(SQLModel):
    data: list[PublishedFramePublic]
    count: int
    offset: int
    limit: int
