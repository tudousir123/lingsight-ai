"""Compute trial metrics from frame_predictions into water_maze.trial_metrics.

ADR-0003 / ticket #4: SQL below only retrieves raw frame rows; every
metric value is computed by deterministic Python (app.metrics) and
written idempotently (one DELETE+INSERT transaction per algo_version).

ADR-0006 / ticket #6 adds the event batch under its own version: the
platform circle per training day (consensus position, radius 46 px) and
the mask-decoded platform contact. The stream stays light — mask RLE is
fetched only for frames whose bbox passes the platform prefilter — and
the RLE decoder self-checks against the stored mask_area_px/mask_bbox_*
anchors before anything is written.

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
from collections.abc import Iterator, Sequence
from dataclasses import replace
from typing import Any

from sqlalchemy import Connection, text

from app.metrics.compute import (
    CircleGeometry,
    FrameObservation,
    compute_trial_metrics,
)
from app.metrics.definitions import (
    ALGO_VERSION,
    ALGO_VERSION_EVENTS,
    PLATFORM_RADIUS_PX,
)
from app.metrics.events import (
    EventFrame,
    bbox_intersects_disk,
    compute_trial_events,
    mask_area_and_bbox,
)
from app.metrics.store import ensure_trial_metrics_table, write_trial_metrics
from scripts.metrics._db import metrics_engine
from scripts.metrics.validate_expected_cells import main as validate_expected_cells

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("compute_trial_metrics")

FRAMES_SQL = text(
    "SELECT video_id, frame_idx, time_s, center_x, center_y, status, "
    "head_x, head_y, tail_x, tail_y, "
    "mask_bbox_x1, mask_bbox_y1, mask_bbox_x2, mask_bbox_y2 "
    "FROM frame_predictions ORDER BY video_id, frame_idx"
)
VIDEOS_SQL = text("SELECT video_id, pool_cx, pool_cy, pool_r, date_dir FROM videos")
PLATFORMS_SQL = text(
    "SELECT day_label, plat_cx_consensus, plat_cy_consensus FROM platform_positions"
)
RLE_SQL = text(
    "SELECT frame_idx, mask_rle_counts, mask_width, mask_height "
    "FROM frame_predictions WHERE video_id = :video_id AND frame_idx IN :idxs"
)
# Deterministic spread: frame_idx is per-video (≤ ~1800), so sample one
# frame in every 131 of each video — ~10 frames/video, all 549 videos.
DECODER_CHECK_SQL = text(
    "SELECT video_id, frame_idx, mask_rle_counts, mask_width, mask_height, "
    "mask_area_px, mask_bbox_x1, mask_bbox_y1, mask_bbox_x2, mask_bbox_y2 "
    "FROM frame_predictions "
    "WHERE status = 'ok' AND mask_rle_counts IS NOT NULL "
    "AND frame_idx % 131 = 71"
)

_PARTITION_ROWS = 2000
_RLE_CHUNK = 500
# Raster pixel count vs the model's sub-pixel area: the area ratio stays
# ≤ 1.3 (median 1.06). The stored bbox comes from the sub-pixel polygon,
# so the raster bbox may sit 1px inside it on an edge (pixel-center
# sampling drops the boundary pixel — 4 of 5969 anchored frames,
# 2026-10-13, always +1px on x2/y2 only); anything beyond that is a
# decoder misinterpretation (a wrong column-major reading shifts bboxes
# by hundreds of pixels).
_MAX_AREA_RATIO = 1.3
_MAX_BBOX_PX_DIFF = 1.0


def _num(value: Any) -> float | None:
    return None if value is None else float(value)


def _circle(cx: Any, cy: Any, r: float | Any) -> CircleGeometry | None:
    if cx is None or cy is None:
        return None
    radius = float(r) if r is not None else None
    if radius is None or radius <= 0:
        return None
    return CircleGeometry(cx=float(cx), cy=float(cy), r=radius)


def check_rle_decoder(conn: Connection) -> bool:
    """Self-check the RLE interpretation against stored mask anchors.

    Runs before anything is computed or written: if the decoded bbox ever
    disagrees with the stored one, the whole contact metric would be
    geometry-fiction, so the run refuses to continue.
    """
    checked = mismatches = 0
    for row in conn.execute(DECODER_CHECK_SQL):
        (
            video_id,
            frame_idx,
            counts,
            width,
            height,
            stored_area,
            bx1,
            by1,
            bx2,
            by2,
        ) = row
        area, x1, y1, x2, y2 = mask_area_and_bbox(counts, width, height)
        checked += 1
        bbox_ok = (
            max(
                abs(x1 - float(bx1)),
                abs(y1 - float(by1)),
                abs(x2 - float(bx2)),
                abs(y2 - float(by2)),
            )
            <= _MAX_BBOX_PX_DIFF
        )
        ratio_ok = (
            stored_area is not None and area / float(stored_area) <= _MAX_AREA_RATIO
        )
        if not (bbox_ok and ratio_ok):
            mismatches += 1
            logger.error(
                "RLE decoder anchor mismatch %s frame %s: decoded "
                "(area=%s, bbox=%s,%s,%s,%s) vs stored (area=%s, bbox=%s,%s,%s,%s)",
                video_id,
                frame_idx,
                area,
                x1,
                y1,
                x2,
                y2,
                stored_area,
                bx1,
                by1,
                bx2,
                by2,
            )
    logger.info(
        "RLE decoder self-check: %d frames, %d mismatches (bbox within "
        "%.0fpx, area ratio <= %.1f)",
        checked,
        mismatches,
        _MAX_BBOX_PX_DIFF,
        _MAX_AREA_RATIO,
    )
    return checked > 0 and mismatches == 0


def fetch_rle(
    conn: Connection, video_id: str, frame_idxs: Sequence[int]
) -> dict[int, tuple[str, int, int]]:
    """RLE rows for the candidate frames of one video (chunked IN query)."""
    out: dict[int, tuple[str, int, int]] = {}
    for start in range(0, len(frame_idxs), _RLE_CHUNK):
        chunk = list(frame_idxs[start : start + _RLE_CHUNK])
        result = conn.execute(RLE_SQL, {"video_id": video_id, "idxs": tuple(chunk)})
        for frame_idx, counts, width, height in result:
            out[int(frame_idx)] = (str(counts), int(width), int(height))
    return out


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


def _event_frame(row: Any) -> EventFrame:
    bbox = (
        (float(row[10]), float(row[11]), float(row[12]), float(row[13]))
        if row[10] is not None
        and row[11] is not None
        and row[12] is not None
        and row[13] is not None
        else None
    )
    return EventFrame(
        frame_idx=int(row[1]),
        time_s=_num(row[2]),
        center_x=_num(row[3]),
        center_y=_num(row[4]),
        status=str(row[5]),
        mask_bbox=bbox,
    )


def stream_rows(conn: Connection) -> Iterator[tuple[str, list[Any]]]:
    """Yield (video_id, raw frame rows) grouped by the ORDER BY stream."""
    result = conn.execute(FRAMES_SQL)
    current_id: str | None = None
    rows: list[Any] = []
    for partition in result.partitions(_PARTITION_ROWS):
        for row in partition:
            video_id = str(row[0])
            if current_id is not None and video_id != current_id:
                yield current_id, rows
                rows = []
            current_id = video_id
            rows.append(row)
    if current_id is not None and rows:
        yield current_id, rows


def main() -> int:
    engine = metrics_engine()

    with engine.connect() as conn:
        if not check_rle_decoder(conn):
            logger.error("RLE decoder self-check failed — aborting, nothing written")
            return 1

    pools: dict[str, CircleGeometry | None] = {}
    days: dict[str, str] = {}
    with engine.connect() as conn:
        for video_id, cx, cy, r, date_dir in conn.execute(VIDEOS_SQL):
            pools[str(video_id)] = _circle(cx, cy, r)
            days[str(video_id)] = str(date_dir)
        platforms: dict[str, CircleGeometry] = {}
        for day_label, cx, cy in conn.execute(PLATFORMS_SQL):
            # docs/10 platform circle: day consensus position + 46 px
            # radius; NULL-consensus rows (the 'all' note row) drop out.
            platform = _circle(cx, cy, PLATFORM_RADIUS_PX)
            if platform is not None:
                platforms[str(day_label)] = platform
    logger.info(
        "loaded geometry: %d pools, %d platform days (%d videos)",
        len(pools),
        len(platforms),
        len(days),
    )

    metric_rows = []
    rle_conn = engine.connect()
    try:
        with engine.connect().execution_options(stream_results=True) as conn:
            for video_id, rows in stream_rows(conn):
                platform = platforms.get(days.get(video_id, ""))
                event_frames = [_event_frame(row) for row in rows]
                # Contact candidates: ok frames whose bbox reaches the
                # platform disk (or whose bbox is missing, defensively) —
                # only those need their RLE decoded.
                candidates = [
                    frame.frame_idx
                    for frame in event_frames
                    if frame.status == "ok"
                    and (
                        frame.mask_bbox is None
                        or (
                            platform is not None
                            and bbox_intersects_disk(
                                frame.mask_bbox,
                                platform.cx,
                                platform.cy,
                                platform.r,
                            )
                        )
                    )
                ]
                rle: dict[int, tuple[str, int, int]] = {}
                if platform is not None and candidates:
                    rle = fetch_rle(rle_conn, video_id, candidates)
                    event_frames = [
                        (
                            replace(
                                frame,
                                mask_rle_counts=rle[frame.frame_idx][0],
                                mask_width=rle[frame.frame_idx][1],
                                mask_height=rle[frame.frame_idx][2],
                            )
                            if frame.frame_idx in rle
                            else frame
                        )
                        for frame in event_frames
                    ]
                metric_rows.extend(
                    compute_trial_metrics(
                        video_id,
                        [_observation(row) for row in rows],
                        pool=pools.get(video_id),
                    )
                )
                metric_rows.extend(
                    compute_trial_events(
                        video_id,
                        event_frames,
                        pool=pools.get(video_id),
                        platform=platform,
                    )
                )
                if len(metric_rows) % 900 == 0:  # every 100 videos, 9 rows each
                    logger.info("computed %d videos", len(metric_rows) // 9)
    finally:
        rle_conn.close()
    videos = len(metric_rows) // 9
    logger.info("computed %d videos -> %d metric rows", videos, len(metric_rows))

    status_counts = Counter(
        (row.algo_version, row.metric, row.calc_status) for row in metric_rows
    )
    for (version, metric, status), count in sorted(status_counts.items()):
        logger.info(
            "algo=%s metric=%s calc_status=%s rows=%d", version, metric, status, count
        )

    with engine.connect() as conn:
        ensure_trial_metrics_table(conn)
        conn.commit()
        written = write_trial_metrics(conn, metric_rows)
    logger.info(
        "wrote %d rows (versions %s + %s) — rerun replaces the same versions in place",
        written,
        ALGO_VERSION,
        ALGO_VERSION_EVENTS,
    )
    # Refresh ⇒ recompute ⇒ anchor check is one chain (retro 2026-10-13):
    # a recompute that leaves stale eval anchors behind is incomplete, so
    # the docs/09 cell check runs here and its failure fails this run.
    return validate_expected_cells()


if __name__ == "__main__":
    raise SystemExit(main())
