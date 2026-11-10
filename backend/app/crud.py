import uuid
from typing import Any

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from app.core.security import get_password_hash, verify_password
from app.models import (
    Project,
    ProjectImportItem,
    ProjectImportResult,
    ProjectMember,
    PublishedFrame,
    PublishedResult,
    User,
    UserCreate,
    UserUpdate,
)


def create_user(*, session: Session, user_create: UserCreate) -> User:
    db_obj = User.model_validate(
        user_create, update={"hashed_password": get_password_hash(user_create.password)}
    )
    session.add(db_obj)
    session.commit()
    session.refresh(db_obj)
    return db_obj


def update_user(*, session: Session, db_user: User, user_in: UserUpdate) -> Any:
    user_data = user_in.model_dump(exclude_unset=True)
    extra_data = {}
    if "password" in user_data:
        password = user_data["password"]
        hashed_password = get_password_hash(password)
        extra_data["hashed_password"] = hashed_password
    db_user.sqlmodel_update(user_data, update=extra_data)
    session.add(db_user)
    session.commit()
    session.refresh(db_user)
    return db_user


def get_user_by_email(*, session: Session, email: str) -> User | None:
    statement = select(User).where(User.email == email)
    session_user = session.exec(statement).first()
    return session_user


# Dummy hash to use for timing attack prevention when user is not found
# This is an Argon2 hash of a random password, used to ensure constant-time comparison
DUMMY_HASH = "$argon2id$v=19$m=65536,t=3,p=4$MjQyZWE1MzBjYjJlZTI0Yw$YTU4NGM5ZTZmYjE2NzZlZjY0ZWY3ZGRkY2U2OWFjNjk"


def authenticate(*, session: Session, email: str, password: str) -> User | None:
    db_user = get_user_by_email(session=session, email=email)
    if not db_user:
        # Prevent timing attacks by running password verification even when user doesn't exist
        # This ensures the response time is similar whether or not the email exists
        verify_password(password, DUMMY_HASH)
        return None
    verified, updated_password_hash = verify_password(password, db_user.hashed_password)
    if not verified:
        return None
    if updated_password_hash:
        db_user.hashed_password = updated_password_hash
        session.add(db_user)
        session.commit()
        session.refresh(db_user)
    return db_user


def create_project(*, session: Session, user_id: uuid.UUID, name: str) -> Project:
    """Create one project; callers translate IntegrityError into a conflict."""
    project = Project(user_id=user_id, name=name)
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


def get_project(
    *, session: Session, user_id: uuid.UUID, project_id: uuid.UUID
) -> Project | None:
    statement = select(Project).where(
        Project.id == project_id, Project.user_id == user_id
    )
    return session.exec(statement).first()


def list_projects(*, session: Session, user_id: uuid.UUID) -> list[Project]:
    statement = (
        select(Project)
        .where(Project.user_id == user_id)
        .order_by(col(Project.created_at), col(Project.id))
    )
    return list(session.exec(statement).all())


def rename_project(*, session: Session, project: Project, name: str) -> Project:
    project.name = name
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


def delete_project(*, session: Session, project: Project) -> None:
    session.delete(project)
    session.commit()


def list_project_members(
    *, session: Session, project_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[ProjectMember]]:
    if not project_ids:
        return {}
    statement = (
        select(ProjectMember)
        .where(col(ProjectMember.project_id).in_(project_ids))
        .order_by(col(ProjectMember.added_at), col(ProjectMember.member_id))
    )
    grouped: dict[uuid.UUID, list[ProjectMember]] = {}
    for member in session.exec(statement).all():
        grouped.setdefault(member.project_id, []).append(member)
    return grouped


def add_project_member(
    *,
    session: Session,
    project: Project,
    member_kind: str,
    member_id: str,
    label: str | None,
) -> tuple[ProjectMember, bool]:
    """Add or update one member reference; returns (member, created)."""
    member = session.get(ProjectMember, (project.id, member_kind, member_id))
    created = member is None
    if member is None:
        member = ProjectMember(
            project_id=project.id, member_kind=member_kind, member_id=member_id
        )
        session.add(member)
    if label is not None:
        member.label = label
        session.add(member)
    session.commit()
    session.refresh(member)
    return member, created


def remove_project_member(
    *, session: Session, project: Project, member_kind: str, member_id: str
) -> bool:
    member = session.get(ProjectMember, (project.id, member_kind, member_id))
    if member is None:
        return False
    session.delete(member)
    session.commit()
    return True


def import_local_projects(
    *, session: Session, user_id: uuid.UUID, items: list[ProjectImportItem]
) -> ProjectImportResult:
    """Import browser-local projects once, idempotently.

    A project whose name already exists (compared case-insensitively, matching
    MySQL's default collation) is skipped entirely: neither its members nor
    anything else the user reorganized server-side is overwritten.
    """
    created = 0
    skipped = 0
    for item in items:
        exists = session.exec(
            select(Project.id).where(
                Project.user_id == user_id,
                func.lower(Project.name) == item.name.lower(),
            )
        ).first()
        if exists is not None:
            skipped += 1
            continue
        try:
            project = create_project(session=session, user_id=user_id, name=item.name)
        except IntegrityError:
            # Another request imported the same name concurrently.
            session.rollback()
            skipped += 1
            continue
        for task_id in dict.fromkeys(item.task_ids):
            session.add(
                ProjectMember(
                    project_id=project.id,
                    member_kind="agent_task",
                    member_id=task_id,
                )
            )
        session.commit()
        created += 1
    return ProjectImportResult(created=created, skipped=skipped)


# --- published inference results (#43) ----------------------------------------
# Read side only; the publish pipeline (gate, validation, whole-version
# write, read-back) lives in app/publishing.py.


def list_published_results(
    session: Session, *, project_id: uuid.UUID
) -> list[PublishedResult]:
    return list(
        session.exec(
            select(PublishedResult)
            .where(col(PublishedResult.project_id) == project_id)
            .order_by(
                col(PublishedResult.published_at).desc(), col(PublishedResult.task_id)
            )
        ).all()
    )


def get_published_result(
    session: Session, *, project_id: uuid.UUID, task_id: str
) -> PublishedResult | None:
    return session.exec(
        select(PublishedResult).where(
            col(PublishedResult.project_id) == project_id,
            col(PublishedResult.task_id) == task_id,
        )
    ).first()


def count_published_frames(session: Session, *, task_id: str) -> int:
    return session.exec(
        select(func.count())
        .select_from(PublishedFrame)
        .where(col(PublishedFrame.task_id) == task_id)
    ).one()


def list_published_frames(
    session: Session, *, task_id: str, offset: int, limit: int
) -> list[PublishedFrame]:
    return list(
        session.exec(
            select(PublishedFrame)
            .where(col(PublishedFrame.task_id) == task_id)
            .order_by(col(PublishedFrame.frame_idx))
            .offset(offset)
            .limit(limit)
        ).all()
    )
