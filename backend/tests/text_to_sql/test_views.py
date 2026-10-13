"""v_query_* view DDL (ticket #7): the curated-column projection is physical.

Runs against the pytest MySQL database (app_t7, compose service `db`) with
a stand-in frame_predictions base table that reproduces the production
shape (curated + excluded columns) — no access to the external water_maze
server from pytest, same pattern as tests/metrics/test_store.py.
"""

from collections.abc import Generator

import pytest
from sqlalchemy import Connection, text
from sqlalchemy.exc import OperationalError

from app.core.db import engine
from app.text_to_sql.semantic import load
from app.text_to_sql.views import ensure_v_query_views

# Stand-in for the real water_maze.frame_predictions: the 12 curated
# columns plus a representative slice of the excluded family (the full
# production DDL has 27 columns; the mask/rle members below are what the
# physical-absence assertions exercise).
BASE_TABLE_DDL = """
CREATE TABLE frame_predictions (
  video_id      VARCHAR(128) NOT NULL,
  frame_idx     INT NOT NULL,
  time_s        DOUBLE NULL,
  center_x      DOUBLE NULL,
  center_y      DOUBLE NULL,
  head_x        DOUBLE NULL,
  head_y        DOUBLE NULL,
  tail_x        DOUBLE NULL,
  tail_y        DOUBLE NULL,
  status        VARCHAR(8) NULL,
  head_tail_mode VARCHAR(32) NULL,
  head_tail_corrected TINYINT NOT NULL DEFAULT '0',
  mask_rle_counts LONGTEXT NULL,
  mask_width    INT NULL,
  rle_format    VARCHAR(32) NULL,
  PRIMARY KEY (video_id, frame_idx)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
"""

CURATED_COLUMNS = {
    "video_id",
    "frame_idx",
    "time_s",
    "center_x",
    "center_y",
    "head_x",
    "head_y",
    "tail_x",
    "tail_y",
    "status",
    "head_tail_mode",
    "head_tail_corrected",
}


@pytest.fixture()
def frame_view() -> Generator[Connection]:
    with engine.connect() as conn:
        conn.exec_driver_sql("DROP VIEW IF EXISTS v_query_frame_predictions")
        conn.exec_driver_sql("DROP TABLE IF EXISTS frame_predictions")
        conn.commit()
        conn.exec_driver_sql(BASE_TABLE_DDL)
        conn.exec_driver_sql(
            "INSERT INTO frame_predictions "
            "(video_id, frame_idx, time_s, center_x, center_y, head_x, head_y, "
            " tail_x, tail_y, status, head_tail_mode, head_tail_corrected, "
            " mask_rle_counts, mask_width, rle_format) VALUES "
            "('v1', 0, 0.0, 10.0, 20.0, 9.0, 19.0, 11.0, 21.0, 'ok', "
            " 'heatmap_peak', 0, 'rle-payload', 640, 'col_counts'), "
            "('v1', 1, 0.033, NULL, NULL, NULL, NULL, NULL, NULL, 'miss', "
            " NULL, 0, NULL, NULL, NULL)"
        )
        conn.commit()
        ensure_v_query_views(conn)
        conn.commit()
        yield conn
        conn.exec_driver_sql("DROP VIEW IF EXISTS v_query_frame_predictions")
        conn.exec_driver_sql("DROP TABLE IF EXISTS frame_predictions")
        conn.commit()


def view_columns(conn: Connection) -> set[str]:
    result = conn.execute(
        text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = DATABASE() "
            "AND table_name = 'v_query_frame_predictions'"
        )
    )
    return {str(row[0]) for row in result}


def test_view_projects_exactly_the_curated_columns(frame_view: Connection) -> None:
    # Ticket #7 acceptance 1: the view exposes the 12 curated frame columns.
    assert view_columns(frame_view) == CURATED_COLUMNS


def test_view_ddl_matches_the_semantic_layer_whitelist(
    frame_view: Connection,
) -> None:
    # The YAML whitelist and the DDL projection are two renderings of one
    # curated column list — this pins them together so they cannot drift.
    layer = load()
    assert set(layer.tables["v_query_frame_predictions"].columns) == CURATED_COLUMNS


def test_excluded_columns_are_physically_absent(frame_view: Connection) -> None:
    # Ticket #7 acceptance 2 (schema-level half): mask_rle_counts and its
    # family do not exist in the view, so MySQL itself refuses the query
    # (error 1054 surfaces as OperationalError) — defense in depth under
    # the AST whitelist.
    for excluded in ("mask_rle_counts", "mask_width", "rle_format"):
        with pytest.raises(OperationalError, match="Unknown column"):
            frame_view.execute(
                text(f"SELECT {excluded} FROM v_query_frame_predictions LIMIT 1")  # noqa: S608
            )


def test_star_projection_width_is_12(frame_view: Connection) -> None:
    row = frame_view.execute(
        text("SELECT * FROM v_query_frame_predictions ORDER BY frame_idx LIMIT 1")
    ).one()
    assert len(row) == 12


def test_view_reads_base_rows_without_transformation(
    frame_view: Connection,
) -> None:
    # Straight projection, no computed columns: the ok frame comes back
    # exactly as stored, and the miss frame keeps its NULL coordinates.
    ok = frame_view.execute(
        text(
            "SELECT * FROM v_query_frame_predictions "
            "WHERE video_id = 'v1' AND frame_idx = 0"
        )
    ).one()
    assert tuple(ok) == (
        "v1",
        0,
        0.0,
        10.0,
        20.0,
        9.0,
        19.0,
        11.0,
        21.0,
        "ok",
        "heatmap_peak",
        0,
    )
    miss = frame_view.execute(
        text(
            "SELECT center_x, head_x, tail_y, status "
            "FROM v_query_frame_predictions "
            "WHERE video_id = 'v1' AND frame_idx = 1"
        )
    ).one()
    assert tuple(miss) == (None, None, None, "miss")


def test_apply_is_idempotent(frame_view: Connection) -> None:
    # CREATE OR REPLACE VIEW: replaying the DDL keeps the view queryable
    # with the same projection and the same rows.
    ensure_v_query_views(frame_view)
    frame_view.commit()
    assert view_columns(frame_view) == CURATED_COLUMNS
    count = frame_view.execute(
        text("SELECT COUNT(*) FROM v_query_frame_predictions")
    ).scalar_one()
    assert count == 2
