"""Published inference results: v3-form summary + per-frame rows (ticket #43).

Revision ID: b7d8e9f0a1c2
Revises: a1b2c3d4e5f6
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.mysql import LONGTEXT

from app.models import Char36UUID

revision = "b7d8e9f0a1c2"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "published_result",
        sa.Column("id", Char36UUID(length=36), nullable=False),
        sa.Column("task_id", sa.String(length=36), nullable=False),
        sa.Column("project_id", Char36UUID(length=36), nullable=False),
        sa.Column("user_id", Char36UUID(length=36), nullable=False),
        sa.Column("video_id", sa.String(length=4096), nullable=False),
        sa.Column("fps", sa.Double(), nullable=False),
        sa.Column("total_frames", sa.Integer(), nullable=False),
        sa.Column("valid_frames", sa.Integer(), nullable=False),
        sa.Column("frames_with_heading", sa.Integer(), nullable=False),
        sa.Column("proposal_frames", sa.Integer(), nullable=False),
        sa.Column("video_sha256", sa.String(length=64), nullable=False),
        sa.Column("first_frame_model_sha256", sa.String(length=64), nullable=False),
        sa.Column("mark_model_sha256", sa.String(length=64), nullable=False),
        sa.Column("tracking_model_sha256", sa.String(length=64), nullable=False),
        sa.Column("v9_model_sha256", sa.String(length=64), nullable=False),
        sa.Column("tracking_json_sha256", sa.String(length=64), nullable=False),
        sa.Column("keypoints_json_sha256", sa.String(length=64), nullable=False),
        sa.Column("provenance_json_sha256", sa.String(length=64), nullable=False),
        sa.Column("overlay_sha256", sa.String(length=64), nullable=False),
        sa.Column("overlay_bytes", sa.BigInteger(), nullable=False),
        sa.Column("heading_algorithm", sa.String(length=64), nullable=False),
        sa.Column("keypoint_protocol", sa.String(length=128), nullable=False),
        sa.Column("content_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("review_tracking_ok", sa.Boolean(), nullable=False),
        sa.Column("review_note", sa.String(length=2000), nullable=True),
        sa.Column("published_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["project_id"], ["project.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("task_id", name="uq_published_result_task"),
    )
    op.create_index(
        op.f("ix_published_result_project_id"), "published_result", ["project_id"]
    )
    op.create_table(
        "published_frame",
        sa.Column("task_id", sa.String(length=36), nullable=False),
        sa.Column("frame_idx", sa.Integer(), nullable=False),
        sa.Column("mask_valid", sa.Boolean(), nullable=False),
        sa.Column("centroid_x", sa.Double(), nullable=True),
        sa.Column("centroid_y", sa.Double(), nullable=True),
        sa.Column("contour_area", sa.Double(), nullable=True),
        sa.Column("mask_rle_counts", LONGTEXT(), nullable=True),
        sa.Column("mask_width", sa.Integer(), nullable=True),
        sa.Column("mask_height", sa.Integer(), nullable=True),
        sa.Column("rle_format", sa.String(length=32), nullable=True),
        sa.Column("head_x", sa.Double(), nullable=True),
        sa.Column("head_y", sa.Double(), nullable=True),
        sa.Column("tail_x", sa.Double(), nullable=True),
        sa.Column("tail_y", sa.Double(), nullable=True),
        sa.Column("heading_angle_deg", sa.Double(), nullable=False),
        sa.Column("is_proposal", sa.Boolean(), nullable=False),
        sa.Column("keypoint_correction", sa.String(length=32), nullable=False),
        sa.ForeignKeyConstraint(
            ["task_id"],
            ["published_result.task_id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("task_id", "frame_idx"),
    )


def downgrade() -> None:
    op.drop_table("published_frame")
    op.drop_index(
        op.f("ix_published_result_project_id"), table_name="published_result"
    )
    op.drop_table("published_result")
