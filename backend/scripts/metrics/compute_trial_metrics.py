"""Compute trial metrics from frame_predictions into water_maze.trial_metrics.

ADR-0003 / ticket #4: SQL below only retrieves raw frame rows; every
metric value is computed by deterministic Python (app.metrics) and
written idempotently (one DELETE+INSERT transaction per algo_version).

Run from backend/ with the password passed through the process
environment only (same command line, nothing written to disk):

    export METRICS_DB_PW=$(docker exec healthad-mysql printenv MYSQL_ROOT_PASSWORD)
    uv run python -m scripts.metrics.compute_trial_metrics

Optional env overrides: METRICS_DB_HOST / METRICS_DB_PORT / METRICS_DB_USER /
METRICS_DB_NAME (defaults 127.0.0.1:3306 root@water_maze).

The run ends with ``scripts.metrics.validate_expected_cells`` (research-DB
anchor check via lingsight_ro, needs LINGSIGHT_RO_PASSWORD in the root
.env): a recompute that leaves stale eval anchors behind fails loudly.
"""

import logging
from collections import Counter
from collections.abc import Iterator
from typing import Any

from sqlalchemy import Connection, text

from app.metrics.compute import FrameObservation, PoolGeometry, compute_trial_metrics
from app.metrics.definitions import ALGO_VERSION
from app.metrics.store import ensure_trial_metrics_table, write_trial_metrics
from scripts.metrics._db import metrics_engine
from scripts.metrics.validate_expected_cells import main as validate_expected_cells

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("compute_trial_metrics")

FRAMES_SQL = text(
    "SELECT video_id, frame_idx, time_s, center_x, center_y, status, "
    "head_x, head_y, tail_x, tail_y "
    "FROM frame_predictions ORDER BY video_id, frame_idx"
)
POOLS_SQL = text("SELECT video_id, pool_cx, pool_cy, pool_r FROM videos")

_PARTITION_ROWS = 2000


def _num(value: Any) -> float | None:
    return None if value is None else float(value)


def _observation(row: Any) -> FrameObservation:
    return FrameObservation(
        frame_idx=int(row[1]),
        time_s=_num(row[2]),
        center_x=_num(row[3]),
        center_y=_num(row[4]),
        status=str(row[5]),
        head_x=_num(row[6]),
        head_y=_num(row[7]),
        tail_x=_num(row[8]),
        tail_y=_num(row[9]),
    )


def stream_videos(conn: Connection) -> Iterator[tuple[str, list[FrameObservation]]]:
    """Yield (video_id, frames) grouped from the ORDER BY video_id stream."""
    result = conn.execute(FRAMES_SQL)
    current_id: str | None = None
    frames: list[FrameObservation] = []
    for partition in result.partitions(_PARTITION_ROWS):
        for row in partition:
            video_id = str(row[0])
            if current_id is not None and video_id != current_id:
                yield current_id, frames
                frames = []
            current_id = video_id
            frames.append(_observation(row))
    if current_id is not None and frames:
        yield current_id, frames


def main() -> int:
    engine = metrics_engine()

    with engine.connect() as conn:
        pools: dict[str, PoolGeometry | None] = {}
        for video_id, cx, cy, r in conn.execute(POOLS_SQL):
            pools[str(video_id)] = (
                PoolGeometry(cx=float(cx), cy=float(cy), r=float(r))
                if cx is not None and cy is not None and r is not None
                else None
            )
    logger.info("loaded pool geometry for %d videos", len(pools))

    metric_rows = []
    with engine.connect().execution_options(stream_results=True) as conn:
        for video_id, frames in stream_videos(conn):
            metric_rows.extend(
                compute_trial_metrics(video_id, frames, pool=pools.get(video_id))
            )
            if len(metric_rows) % 400 == 0:  # every 100 videos, 4 rows each
                logger.info("computed %d videos", len(metric_rows) // 4)
    videos = len(metric_rows) // 4
    logger.info("computed %d videos -> %d metric rows", videos, len(metric_rows))

    status_counts = Counter((row.metric, row.calc_status) for row in metric_rows)
    for (metric, status), count in sorted(status_counts.items()):
        logger.info("metric=%s calc_status=%s rows=%d", metric, status, count)

    with engine.connect() as conn:
        ensure_trial_metrics_table(conn)
        conn.commit()
        written = write_trial_metrics(conn, metric_rows)
    logger.info(
        "wrote %d rows (algo_version=%s) — rerun replaces the same version in place",
        written,
        ALGO_VERSION,
    )
    # Refresh ⇒ recompute ⇒ anchor check is one chain (retro 2026-10-13):
    # a recompute that leaves stale eval anchors behind is incomplete, so
    # the docs/09 cell check runs here and its failure fails this run.
    return validate_expected_cells()


if __name__ == "__main__":
    raise SystemExit(main())
