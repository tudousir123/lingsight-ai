"""Verified inference bindings and immutable preannotations.

Revision ID: 69c
Revises: f69b00000002
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

revision = "69c"
down_revision = "f69b00000002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("published_result", sa.Column("source_kind", sa.String(32), nullable=False, server_default="filesystem"))
    op.add_column("published_result", sa.Column("original_video_sha256", sa.String(64), nullable=True))
    op.add_column("published_result", sa.Column("confirmation_id", sa.String(36), nullable=True))
    op.create_table("inference_binding",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_user_id", sa.String(36), sa.ForeignKey("user.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("project.id", ondelete="CASCADE"), nullable=False),
        sa.Column("video_id", sa.String(4096), nullable=False),
        sa.Column("source_kind", sa.String(32), nullable=False),
        sa.Column("source_id", sa.String(255), nullable=False),
        sa.Column("upstream_video_id", sa.String(4096), nullable=False),
        sa.Column("video_sha256", sa.String(64), nullable=True),
        sa.Column("original_video_sha256", sa.String(64), nullable=True),
        sa.Column("idempotency_key", sa.String(36), nullable=False),
        sa.Column("input_width", sa.Integer(), nullable=True),
        sa.Column("input_height", sa.Integer(), nullable=True),
        sa.Column("input_frame_count", sa.Integer(), nullable=True),
        sa.Column("task_id", sa.String(36), unique=True, nullable=True),
        sa.Column("confirmation_id", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("owner_user_id", "idempotency_key"),
    )
    op.create_index("ix_inference_binding_owner_user_id", "inference_binding", ["owner_user_id"])
    op.create_index("ix_inference_binding_project_id", "inference_binding", ["project_id"])
    op.create_table("preannotation_confirmation",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("binding_id", sa.String(36), sa.ForeignKey("inference_binding.id", ondelete="CASCADE"), nullable=False),
        sa.Column("owner_user_id", sa.String(36), sa.ForeignKey("user.id", ondelete="CASCADE"), nullable=False),
        sa.Column("idempotency_key", sa.String(36), nullable=False),
        sa.Column("request_sha256", sa.String(64), nullable=False),
        sa.Column("candidate_version", sa.String(64), nullable=False),
        sa.Column("video_sha256", sa.String(64), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("frame_count", sa.Integer(), nullable=False),
        sa.Column("geometry", sa.JSON(), nullable=False),
        sa.Column("confirmed_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.Column("dispatch_status", sa.String(16), nullable=False),
        sa.Column("dispatch_error", sa.String(64), nullable=True),
        sa.Column("dispatch_attempted", sa.Boolean(), nullable=False),
        sa.UniqueConstraint("owner_user_id", "idempotency_key"),
    )
    op.create_index("ix_preannotation_confirmation_binding_id", "preannotation_confirmation", ["binding_id"])


def downgrade() -> None:
    op.drop_table("preannotation_confirmation")
    op.drop_table("inference_binding")
    op.drop_column("published_result", "confirmation_id")
    op.drop_column("published_result", "original_video_sha256")
    op.drop_column("published_result", "source_kind")
