"""Persist owned media and project-scoped upload receipts."""

from alembic import op

from app.upload_models import UploadedVideo, UploadReceipt

revision = "f69b00000002"
down_revision = "d9f0a1b2c3e4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    UploadedVideo.__table__.create(op.get_bind())
    UploadReceipt.__table__.create(op.get_bind())


def downgrade() -> None:
    UploadReceipt.__table__.drop(op.get_bind())
    UploadedVideo.__table__.drop(op.get_bind())
