"""Verified inference bindings and immutable preannotations.

Revision ID: 69c
Revises: f69b00000002
"""
from alembic import op
import sqlalchemy as sa
from app.inference_models import InferenceBinding, PreannotationConfirmation

revision = "69c"
down_revision = "f69b00000002"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("published_result", sa.Column("source_kind", sa.String(32), nullable=False, server_default="filesystem"))
    op.add_column("published_result", sa.Column("original_video_sha256", sa.String(64), nullable=True))
    op.add_column("published_result", sa.Column("confirmation_id", sa.String(36), nullable=True))
    InferenceBinding.__table__.create(op.get_bind())
    PreannotationConfirmation.__table__.create(op.get_bind())


def downgrade():
    PreannotationConfirmation.__table__.drop(op.get_bind())
    InferenceBinding.__table__.drop(op.get_bind())
    op.drop_column("published_result", "confirmation_id")
    op.drop_column("published_result", "original_video_sha256")
    op.drop_column("published_result", "source_kind")
