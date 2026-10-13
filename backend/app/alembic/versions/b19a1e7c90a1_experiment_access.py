"""Store per-user experiment access for the trial catalog.

Revision ID: b19a1e7c90a1
Revises: da969c656440
"""

import sqlalchemy as sa
from alembic import op

from app.models import Char36UUID

revision = "b19a1e7c90a1"
down_revision = "da969c656440"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "experiment_access",
        sa.Column("user_id", Char36UUID(length=36), nullable=False),
        sa.Column("experiment_id", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "experiment_id"),
    )


def downgrade() -> None:
    op.drop_table("experiment_access")
