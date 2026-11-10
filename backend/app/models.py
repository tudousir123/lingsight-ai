import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import EmailStr, field_validator
from sqlalchemy import CHAR, Dialect, TypeDecorator, UniqueConstraint
from sqlmodel import Field, SQLModel


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
    member_id: str = Field(primary_key=True, max_length=128)
    label: str | None = Field(default=None, max_length=255)
    added_at: datetime | None = Field(default_factory=get_datetime_utc)


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
    id: str = Field(min_length=1, max_length=128)
    label: str | None = Field(default=None, max_length=255)


class ProjectMemberPublic(SQLModel):
    kind: ProjectMemberKind
    id: str
    label: str | None = None
    added_at: datetime | None = None


class ProjectPublic(SQLModel):
    id: uuid.UUID
    name: str
    created_at: datetime | None = None
    updated_at: datetime | None = None
    members: list[ProjectMemberPublic] = []


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
