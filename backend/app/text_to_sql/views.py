"""`v_query_*` read-only view DDL for water_maze (ticket #7 / M1-T8).

water_maze is an external research database, so its Text-to-SQL query
surface is managed by idempotent DDL applied by a replayable root script
(`scripts/schema/apply_v_query_views.py`) — deliberately outside Alembic,
which only migrates the app's own schema (same pattern as
``app.metrics.store``). The same constants are used by the view tests, so
the tested DDL is exactly what production runs.

The view is the single query entry point for frame data: it projects
exactly the 12 curated columns the semantic layer whitelists, straight
from the base table (no computed columns). ``mask_rle_*`` and the other
excluded columns physically do not exist in the view, so even a direct
``SELECT mask_rle_counts FROM v_query_frame_predictions`` fails with
"Unknown column" — the exclusion is enforced by the schema, not just by
the AST whitelist (docs/08 risk 8, docs/09 D24).
"""

from sqlalchemy import Connection

V_QUERY_FRAME_PREDICTIONS_DDL = """
CREATE OR REPLACE VIEW v_query_frame_predictions AS
SELECT
  video_id,
  frame_idx,
  time_s,
  center_x,
  center_y,
  head_x,
  head_y,
  tail_x,
  tail_y,
  status,
  head_tail_mode,
  head_tail_corrected
FROM frame_predictions
"""

#: Grant applied together with the view by the root script only — the app
#: account never manages privileges. Idempotent: re-granting is a no-op.
V_QUERY_FRAME_PREDICTIONS_GRANT = (
    "GRANT SELECT ON water_maze.v_query_frame_predictions TO 'lingsight_ro'@'%'"
)


def ensure_v_query_views(conn: Connection) -> None:
    """(Re)create the v_query_* views; safe to replay any number of times."""
    conn.exec_driver_sql(V_QUERY_FRAME_PREDICTIONS_DDL)
