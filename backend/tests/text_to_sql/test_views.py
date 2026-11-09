"""v_query_* view DDL (ticket #7, extended by #15): the curated projection is physical.

Runs against the pytest MySQL database (app_tN, compose service `db`) with
a stand-in frame_predictions base table that reproduces the production
shape — no access to the external water_maze server from pytest, same
pattern as tests/metrics/test_store.py. The mask family (RLE + decode
parameters + derived columns) is part of the projection since the
2026-10-13 user decision (ADR-0007); pipeline-internal IoU columns stay
out.
"""

from collections.abc import Generator

import pytest
from sqlalchemy import Connection, text
from sqlalchemy.exc import OperationalError

from app.core.db import engine
from app.text_to_sql.semantic import load
from app.text_to_sql.views import ensure_v_query_views

# Stand-in for the real water_maze.frame_predictions: the curated columns
# (trajectory + mask family) plus the still-excluded internal quality
# columns the physical-absence assertions exercise.
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
  mask_valid    TINYINT NULL,
  mask_centroid_x DOUBLE NULL,
  mask_centroid_y DOUBLE NULL,
  mask_area_px  DOUBLE NULL,
  mask_bbox_x1  DOUBLE NULL,
  mask_bbox_y1  DOUBLE NULL,
  mask_bbox_x2  DOUBLE NULL,
  mask_bbox_y2  DOUBLE NULL,
  mask_rle_counts LONGTEXT NULL,
  mask_width    INT NULL,
  mask_height   INT NULL,
  rle_format    VARCHAR(32) NULL,
  prev_mask_iou DOUBLE NULL,
  instant_static_by_iou TINYINT NULL,
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
    "mask_valid",
    "mask_centroid_x",
    "mask_centroid_y",
    "mask_area_px",
    "mask_bbox_x1",
    "mask_bbox_y1",
    "mask_bbox_x2",
    "mask_bbox_y2",
    "mask_rle_counts",
    "mask_width",
    "mask_height",
    "rle_format",
}


@pytest.fixture()
def frame_view(db: object) -> Generator[Connection]:
    with engine.connect() as conn:
        conn.exec_driver_sql("DROP VIEW IF EXISTS v_query_frame_predictions")
        conn.exec_driver_sql("DROP TABLE IF EXISTS frame_predictions")
        conn.commit()
        conn.exec_driver_sql(BASE_TABLE_DDL)
        conn.exec_driver_sql(
            "INSERT INTO frame_predictions "
            "(video_id, frame_idx, time_s, center_x, center_y, head_x, head_y, "
            " tail_x, tail_y, status, head_tail_mode, head_tail_corrected, "
            " mask_valid, mask_centroid_x, mask_centroid_y, mask_area_px, "
            " mask_bbox_x1, mask_bbox_y1, mask_bbox_x2, mask_bbox_y2, "
            " mask_rle_counts, mask_width, mask_height, rle_format, "
            " prev_mask_iou, instant_static_by_iou) VALUES "
            "('v1', 0, 0.0, 10.0, 20.0, 9.0, 19.0, 11.0, 21.0, 'ok', "
            " 'heatmap_peak', 0, 1, 10.5, 20.5, 350.5, 5.0, 15.0, 20.0, 30.0, "
            " 'rle-payload', 640, 480, 'col_counts', 0.99, 0), "
            "('v1', 1, 0.033, NULL, NULL, NULL, NULL, NULL, NULL, 'miss', "
            " NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, "
            " NULL, NULL, NULL, NULL, NULL, NULL)"
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
    # Ticket #7 acceptance 1, widened by #15/ADR-0007: the view exposes the
    # 24 curated columns (12 trajectory + 12 mask family).
    assert view_columns(frame_view) == CURATED_COLUMNS


def test_view_ddl_matches_the_semantic_layer_whitelist() -> None:
    # The YAML whitelist and the DDL projection are two renderings of one
    # curated column list — this pins them together so they cannot drift.
    layer = load()
    assert set(layer.tables["v_query_frame_predictions"].columns) == CURATED_COLUMNS


def test_internal_quality_columns_are_physically_absent(
    frame_view: Connection,
) -> None:
    # ADR-0007: the mask family is open, but pipeline-internal IoU quality
    # columns stay excluded — they do not exist in the view, so MySQL
    # itself refuses the query (error 1054 surfaces as OperationalError).
    for excluded in ("prev_mask_iou", "instant_static_by_iou"):
        with pytest.raises(OperationalError, match="Unknown column"):
            frame_view.execute(
                text(f"SELECT {excluded} FROM v_query_frame_predictions LIMIT 1")  # noqa: S608
            )


def test_star_projection_width_is_24(frame_view: Connection) -> None:
    row = frame_view.execute(
        text("SELECT * FROM v_query_frame_predictions ORDER BY frame_idx LIMIT 1")
    ).one()
    assert len(row) == 24


def test_view_reads_base_rows_without_transformation(
    frame_view: Connection,
) -> None:
    # Straight projection, no computed columns: the ok frame comes back
    # exactly as stored (mask family included), and the miss frame keeps
    # its NULL coordinates and NULL mask.
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
        1,
        10.5,
        20.5,
        350.5,
        5.0,
        15.0,
        20.0,
        30.0,
        "rle-payload",
        640,
        480,
        "col_counts",
    )
    miss = frame_view.execute(
        text(
            "SELECT center_x, head_x, tail_y, mask_rle_counts, status "
            "FROM v_query_frame_predictions "
            "WHERE video_id = 'v1' AND frame_idx = 1"
        )
    ).one()
    assert tuple(miss) == (None, None, None, None, "miss")


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
