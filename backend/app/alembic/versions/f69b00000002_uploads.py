"""Persist owned media and project-scoped upload receipts."""

import sqlalchemy as sa
from alembic import op

revision = "f69b00000002"
down_revision = "69a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "uploaded_video",
        sa.Column("video_id", sa.String(64), primary_key=True),
        sa.Column(
            "owner_user_id",
            sa.CHAR(36),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source_id", sa.String(64), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("format", sa.String(3), nullable=False),
        sa.Column("bytes", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("storage_key", sa.String(255), nullable=False),
        sa.Column("inference_storage_key", sa.String(255), nullable=False),
        sa.Column("inference_sha256", sa.String(64), nullable=False),
        sa.Column("preview_storage_key", sa.String(255), nullable=False),
        sa.Column("preview_sha256", sa.String(64), nullable=False),
        sa.Column("conversion", sa.String(64), nullable=False),
        sa.Column("frame_digest", sa.String(64), nullable=False),
        sa.Column("time_base", sa.String(64), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("frame_count", sa.Integer(), nullable=False),
        sa.Column("fps", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_uploaded_video_owner_user_id", "uploaded_video", ["owner_user_id"]
    )
    op.create_table(
        "upload_receipt",
        sa.Column("id", sa.CHAR(36), primary_key=True),
        sa.Column(
            "owner_user_id",
            sa.CHAR(36),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            sa.CHAR(36),
            sa.ForeignKey("project.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("idempotency_key", sa.String(36), nullable=False),
        sa.Column(
            "video_id",
            sa.String(64),
            sa.ForeignKey("uploaded_video.video_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "owner_user_id", "project_id", "idempotency_key", name="uq_upload_receipt"
        ),
    )


def downgrade() -> None:
    op.drop_table("upload_receipt")
    op.drop_table("uploaded_video")
