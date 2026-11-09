from datetime import UTC, datetime
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text

from tests.runtime import configure_application

configure_application()
from app.core.db import engine


def test_review_migration_preserves_history_and_refuses_lossy_downgrade():
    cfg = Config("alembic.ini")
    command.downgrade(cfg, "c3f8a1d204b7")
    user_id, first_id = str(uuid4()), str(uuid4())
    now = datetime.now(UTC).replace(tzinfo=None)
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO user (id,email,is_active,is_superuser,hashed_password) VALUES (:id,'migration@example.com',1,0,'unused')"
            ),
            {"id": user_id},
        )
        conn.execute(
            text(
                "INSERT INTO trial_review (id,user_id,experiment_id,trial_id,source_version,boundary_ok,markers_ok,platform_ok,tracking_ok,state,confirmed_at,created_at,updated_at) VALUES (:id,:user,'e','t','old-version',1,1,1,1,'confirmed',:now,:now,:now)"
            ),
            {"id": first_id, "user": user_id, "now": now},
        )
    # Reproduce a previous two-statement upgrade interrupted after ADD INDEX.
    with engine.begin() as conn:
        conn.execute(
            text(
                "ALTER TABLE trial_review ADD CONSTRAINT uq_trial_review_source UNIQUE (user_id, experiment_id, trial_id, source_version)"
            )
        )
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        assert (
            conn.execute(text("SELECT id FROM trial_review")).scalar_one() == first_id
        )
        # Reproduce the equivalent interrupted downgrade with both keys present.
        conn.execute(
            text(
                "ALTER TABLE trial_review ADD CONSTRAINT uq_trial_review_identity UNIQUE (user_id, experiment_id, trial_id)"
            )
        )
    command.downgrade(cfg, "c3f8a1d204b7")
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        assert (
            conn.execute(text("SELECT id FROM trial_review")).scalar_one() == first_id
        )
        conn.execute(
            text(
                "INSERT INTO trial_review (id,user_id,experiment_id,trial_id,source_version,boundary_ok,markers_ok,platform_ok,tracking_ok,state,confirmed_at,created_at,updated_at) VALUES (:id,:user,'e','t','new-version',1,1,1,1,'confirmed',:now,:now,:now)"
            ),
            {"id": str(uuid4()), "user": user_id, "now": now},
        )
    with pytest.raises(RuntimeError, match="discarding review history"):
        command.downgrade(cfg, "c3f8a1d204b7")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM trial_review")).scalar_one() == 2
        assert (
            conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            == "d4e5f6a7b8c9"
        )
    engine.dispose()
