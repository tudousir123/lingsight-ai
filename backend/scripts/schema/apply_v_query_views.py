"""Apply the v_query_* read-only views to water_maze (ticket #7 / M1-T8).

Root-only and idempotent: recreates the views (CREATE OR REPLACE VIEW),
re-grants SELECT on them to ``lingsight_ro``, and verifies the projection
against the semantic layer — replaying the script any number of times
leaves the same state. The base tables are owned by the research
pipeline; this script never creates or alters them.

Run from backend/ with the root password passed through the process
environment only (same command line, nothing written to disk):

    export METRICS_DB_PW=$(docker exec healthad-mysql printenv MYSQL_ROOT_PASSWORD)
    uv run python -m scripts.schema.apply_v_query_views

Optional env overrides: METRICS_DB_HOST / METRICS_DB_PORT / METRICS_DB_USER /
METRICS_DB_NAME (defaults 127.0.0.1:3306 root@water_maze).
"""

import logging
import sys

from sqlalchemy import Connection, text

from app.text_to_sql.semantic import load
from app.text_to_sql.views import (
    V_QUERY_FRAME_PREDICTIONS_GRANT,
    ensure_v_query_views,
)
from scripts.metrics._db import metrics_engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("apply_v_query_views")


def _base_table_exists(conn: Connection) -> bool:
    result = conn.execute(
        text(
            "SELECT COUNT(*) FROM information_schema.tables "
            "WHERE table_schema = DATABASE() AND table_name = 'frame_predictions'"
        )
    )
    return int(result.scalar_one()) == 1


def _view_columns(conn: Connection) -> list[str]:
    result = conn.execute(
        text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = DATABASE() "
            "AND table_name = 'v_query_frame_predictions' "
            "ORDER BY ordinal_position"
        )
    )
    return [str(row[0]) for row in result]


def main() -> int:
    engine = metrics_engine()
    layer = load()
    expected = list(layer.tables["v_query_frame_predictions"].columns)

    with engine.connect() as conn:
        if not _base_table_exists(conn):
            logger.error(
                "base table frame_predictions not found — this script only "
                "builds views over existing research tables"
            )
            return 1

        ensure_v_query_views(conn)
        conn.commit()
        logger.info("applied CREATE OR REPLACE VIEW v_query_frame_predictions")

        # GRANT names the account host '@%', which PyMySQL would read as a
        # format specifier — go through the raw DBAPI cursor instead.
        raw = conn.connection
        raw.cursor().execute(V_QUERY_FRAME_PREDICTIONS_GRANT)  # type: ignore[attr-defined]
        conn.commit()
        logger.info("granted SELECT ON v_query_frame_predictions TO lingsight_ro")

        actual = _view_columns(conn)
        logger.info("view projection (%d columns): %s", len(actual), ", ".join(actual))
        if actual != expected:
            logger.error(
                "view projection drifted from the semantic layer whitelist: "
                "view=%s semantic=%s",
                actual,
                expected,
            )
            return 1

        count = conn.execute(
            text("SELECT COUNT(*) FROM v_query_frame_predictions")
        ).scalar_one()
        logger.info("view row count: %d", int(count))

        grants = conn.exec_driver_sql("SHOW GRANTS FOR lingsight_ro").fetchall()
        for (grant,) in grants:
            logger.info("grant: %s", str(grant))

    logger.info("done — script is replayable and leaves the same state")
    return 0


if __name__ == "__main__":
    sys.exit(main())
