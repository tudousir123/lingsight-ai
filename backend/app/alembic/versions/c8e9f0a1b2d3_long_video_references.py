"""Preserve long opaque video references without oversized MySQL indexes.

Revision ID: c8e9f0a1b2d3
Revises: b7d8e9f0a1c2
"""

import sqlalchemy as sa
from alembic import op

revision = "c8e9f0a1b2d3"
down_revision = "b7d8e9f0a1c2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "project_member", sa.Column("member_key", sa.String(64), nullable=True)
    )
    op.execute("UPDATE project_member SET member_key = SHA2(member_id, 256)")
    # One ALTER keeps a leading project_id index available for the existing FK.
    op.execute(
        "ALTER TABLE project_member DROP PRIMARY KEY, MODIFY member_id TEXT NOT NULL, MODIFY member_key VARCHAR(64) NOT NULL, ADD PRIMARY KEY (project_id, member_kind, member_key)"
    )


def downgrade() -> None:
    oversized = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT COUNT(*) FROM project_member WHERE CHAR_LENGTH(member_id) > 128"
            )
        )
        .scalar_one()
    )
    if oversized:
        raise RuntimeError(
            "Cannot downgrade: long video references exist; preserve them before rollback"
        )
    op.execute(
        "ALTER TABLE project_member DROP PRIMARY KEY, MODIFY member_id VARCHAR(128) NOT NULL, ADD PRIMARY KEY (project_id, member_kind, member_id)"
    )
    op.drop_column("project_member", "member_key")
