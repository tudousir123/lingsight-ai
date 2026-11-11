"""Project entity: user-owned research organization unit (ticket #42).

Revision ID: a1b2c3d4e5f6
Revises: d4e5f6a7b8c9
"""

import sqlalchemy as sa
from alembic import op

from app.models import Char36UUID

revision = "a1b2c3d4e5f6"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project",
        sa.Column("id", Char36UUID(length=36), nullable=False),
        sa.Column("user_id", Char36UUID(length=36), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_project_user_name"),
    )
    op.create_table(
        "project_member",
        sa.Column("project_id", Char36UUID(length=36), nullable=False),
        sa.Column("member_kind", sa.String(length=16), nullable=False),
        sa.Column("member_id", sa.String(length=128), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=True),
        sa.Column("added_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["project_id"], ["project.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("project_id", "member_kind", "member_id"),
    )


def downgrade() -> None:
    op.drop_table("project_member")
    op.drop_table("project")
