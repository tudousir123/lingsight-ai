"""`v_query_*` read-only view DDL for water_maze (ticket #7 / M1-T8).

water_maze is an external research database, so its Text-to-SQL query
surface is managed by idempotent DDL applied by a replayable root script
(`scripts/schema/apply_v_query_views.py`) — deliberately outside Alembic,
which only migrates the app's own schema (same pattern as
``app.metrics.store``). The same constants are used by the view tests, so
the tested DDL is exactly what production runs.

The view is the single query entry point for frame data: it projects
exactly the 24 curated columns the semantic layer whitelists, straight
from the base table (no computed columns) — 12 trajectory columns plus
the mask family (RLE encoding, decode parameters, derived columns) opened
by the 2026-10-13 user decision (ADR-0007). Pipeline-internal quality
columns (``prev_mask_iou`` / ``instant_static_by_iou``) physically do not
exist in the view: even a direct ``SELECT prev_mask_iou FROM
v_query_frame_predictions`` fails with "Unknown column" — that exclusion
is enforced by the schema, not just by the AST whitelist.
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
  head_tail_corrected,
  mask_valid,
  mask_centroid_x,
  mask_centroid_y,
  mask_area_px,
  mask_bbox_x1,
  mask_bbox_y1,
  mask_bbox_x2,
  mask_bbox_y2,
  mask_rle_counts,
  mask_width,
  mask_height,
  rle_format
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
