"""Keep preparation reviews for each version of trial materials.

Revision ID: d4e5f6a7b8c9
Revises: c3f8a1d204b7
"""

import sqlalchemy as sa
from alembic import op

revision = "d4e5f6a7b8c9"
down_revision = "c3f8a1d204b7"
branch_labels = None
depends_on = None

_IDENTITY = ["user_id", "experiment_id", "trial_id"]
_VERSIONED = [*_IDENTITY, "source_version"]


def _keys() -> tuple[str | None, str | None]:
    constraints = sa.inspect(op.get_bind()).get_unique_constraints("trial_review")
    identity = next(
        (c["name"] for c in constraints if c["column_names"] == _IDENTITY), None
    )
    versioned = next(
        (c["name"] for c in constraints if c["column_names"] == _VERSIONED), None
    )
    return identity, versioned


def upgrade() -> None:
    old, new = _keys()
    if old is None and new is not None:
        return  # A previously interrupted migration already changed the schema.
    if old is None:
        raise RuntimeError(
            "Expected a named unique key for the existing review identity"
        )
    quote = op.get_bind().dialect.identifier_preparer.quote
    if new is not None:
        # Recover from the former two-statement migration interrupted between DDLs.
        op.execute(f"ALTER TABLE trial_review DROP INDEX {quote(old)}")
    else:
        # One MySQL ALTER avoids exposing an intermediate schema between DDLs.
        op.execute(
            f"ALTER TABLE trial_review DROP INDEX {quote(old)}, "
            "ADD CONSTRAINT uq_trial_review_source "
            "UNIQUE (user_id, experiment_id, trial_id, source_version)"
        )


def downgrade() -> None:
    duplicates = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT 1 FROM trial_review GROUP BY user_id, experiment_id, trial_id "
                "HAVING COUNT(*) > 1 LIMIT 1"
            )
        )
        .first()
    )
    if duplicates:
        raise RuntimeError(
            "Cannot downgrade without discarding review history; preserve/export it first"
        )
    old, new = _keys()
    if old is not None and new is None:
        return
    if new is None:
        raise RuntimeError("Expected a named unique key for versioned reviews")
    quote = op.get_bind().dialect.identifier_preparer.quote
    if old is not None:
        op.execute(f"ALTER TABLE trial_review DROP INDEX {quote(new)}")
    else:
        op.execute(
            f"ALTER TABLE trial_review DROP INDEX {quote(new)}, "
            "ADD CONSTRAINT uq_trial_review_identity UNIQUE (user_id, experiment_id, trial_id)"
        )
