"""Explicit whole-library grants; existing normal accounts receive no grant.

Revision ID: 69a
Revises: d9f0a1b2c3e4
"""

import sqlalchemy as sa
from alembic import op

revision = "69a"
down_revision = "d9f0a1b2c3e4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "whole_library_access",
        sa.Column(
            "user_id",
            sa.CHAR(36),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("granted", sa.Boolean(), nullable=False),
        sa.Column("reason", sa.String(1000), nullable=False),
        sa.Column("updated_by", sa.CHAR(36), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("revision", sa.CHAR(36), nullable=False),
    )
    op.create_table(
        "library_access_audit",
        sa.Column("id", sa.CHAR(36), primary_key=True),
        sa.Column("user_id", sa.CHAR(36), nullable=False),
        sa.Column("actor_user_id", sa.CHAR(36), nullable=False),
        sa.Column("previous_granted", sa.Boolean(), nullable=False),
        sa.Column("granted", sa.Boolean(), nullable=False),
        sa.Column("reason", sa.String(1000), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_library_access_audit_user_id", "library_access_audit", ["user_id"]
    )


def downgrade() -> None:
    op.drop_table("library_access_audit")
    op.drop_table("whole_library_access")
