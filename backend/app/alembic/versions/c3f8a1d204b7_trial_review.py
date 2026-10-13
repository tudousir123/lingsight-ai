"""Store human preparation reviews per trial (ticket #21).

Revision ID: c3f8a1d204b7
Revises: b19a1e7c90a1
"""

import sqlalchemy as sa
from alembic import op

from app.models import Char36UUID

revision = "c3f8a1d204b7"
down_revision = "b19a1e7c90a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "trial_review",
        sa.Column("id", Char36UUID(length=36), nullable=False),
        sa.Column("user_id", Char36UUID(length=36), nullable=False),
        sa.Column("experiment_id", sa.String(length=64), nullable=False),
        sa.Column("trial_id", sa.String(length=128), nullable=False),
        sa.Column("source_version", sa.String(length=64), nullable=False),
        sa.Column("boundary_ok", sa.Boolean(), nullable=False),
        sa.Column("markers_ok", sa.Boolean(), nullable=False),
        sa.Column("platform_ok", sa.Boolean(), nullable=False),
        sa.Column("tracking_ok", sa.Boolean(), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "experiment_id", "trial_id"),
    )
    op.create_index("ix_trial_review_user_id", "trial_review", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_trial_review_user_id", table_name="trial_review")
    op.drop_table("trial_review")
