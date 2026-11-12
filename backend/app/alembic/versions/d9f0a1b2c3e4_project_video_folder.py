"""Persist each project's chosen source-relative video folder.

Revision ID: d9f0a1b2c3e4
Revises: c8e9f0a1b2d3
"""

import sqlalchemy as sa
from alembic import op

revision = "d9f0a1b2c3e4"
down_revision = "c8e9f0a1b2d3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("project", sa.Column("video_source_id", sa.String(64), nullable=True))
    op.add_column("project", sa.Column("video_directory", sa.Text(), nullable=True))
    op.add_column(
        "project", sa.Column("video_directory_label", sa.String(255), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("project", "video_directory_label")
    op.drop_column("project", "video_directory")
    op.drop_column("project", "video_source_id")
