"""Validate trial_metrics against the docs/09 golden group-by-day matrix.

Ticket #4 acceptance, three layers:

1. Golden matrix — group-by-day means of dist_px / speed_px (training
   phase) computed from the written trial_metrics, compared cell by cell
   against the docs/09 appendix values (2026-10-12 实算). Tolerance
   0.5% relative (see REL_TOL): docs/08 recorded ok=783,790 frames while
   the live table has 784,055 (the 2026-10-11 rescue-pipeline refresh
   flipped 265 miss frames to ok after the matrix was published); a live
   SQL recomputation shows group-by-day means moved by at most ~0.1%.
2. SQL cross-check — the docs/09 golden CTE recomputed live and compared
   per trial against the Python-written values, proving the Python
   metrics reproduce the SQL口径 exactly (float summation order aside).
3. qc sanity (report only) — valid_kp_ratio vs
   qc_summary.valid_keypoint_frame_ratio, expected to track closely.

Run from backend/:

    export METRICS_DB_PW=$(docker exec healthad-mysql printenv MYSQL_ROOT_PASSWORD)
    uv run python -m scripts.metrics.validate_golden_matrix
"""

import logging
import sys
from typing import Any

from sqlalchemy import text

from app.metrics.definitions import ALGO_VERSION
from scripts.metrics._db import metrics_engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("validate_golden_matrix")

# docs/09 appendix · 组×日 黄金矩阵（训练期）: (group, day) -> (dist_px, speed_px)
GOLDEN: dict[tuple[str, str], tuple[float, float]] = {
    ("A+L1", "0804"): (8359.0, 129.0),
    ("A+L1", "0805"): (8350.0, 130.2),
    ("A+L1", "0806"): (7091.0, 116.0),
    ("A+L1", "0807"): (5430.0, 112.2),
    ("A+L1", "0808"): (2856.0, 90.7),
    ("A+L3", "0804"): (7545.0, 124.1),
    ("A+L3", "0805"): (5241.0, 97.7),
    ("A+L3", "0806"): (5715.0, 121.3),
    ("A+L3", "0807"): (3769.0, 117.5),
    ("A+L3", "0808"): (4461.0, 113.1),
    ("A2", "0804"): (7076.0, 125.7),
    ("A2", "0805"): (7819.0, 126.9),
    ("A2", "0806"): (5040.0, 113.1),
    ("A2", "0807"): (3175.0, 117.5),
    ("A2", "0808"): (3397.0, 103.6),
    ("A3", "0804"): (6487.0, 104.6),
    ("A3", "0805"): (6692.0, 107.5),
    ("A3", "0806"): (3605.0, 79.7),
    ("A3", "0807"): (3233.0, 94.9),
    ("A3", "0808"): (3101.0, 98.2),
    ("c1", "0804"): (7982.0, 123.3),
    ("c1", "0805"): (5628.0, 98.1),
    ("c1", "0806"): (5267.0, 97.4),
    ("c1", "0807"): (4206.0, 101.8),
    ("c1", "0808"): (4168.0, 88.0),
    ("c2", "0804"): (6840.0, 108.1),
    ("c2", "0805"): (6131.0, 102.0),
    ("c2", "0806"): (5221.0, 94.0),
    ("c2", "0807"): (4306.0, 94.2),
    ("c2", "0808"): (4562.0, 93.2),
}
GROUPS = ["A+L1", "A+L3", "A2", "A3", "c1", "c2"]
DAYS = ["0804", "0805", "0806", "0807", "0808"]

# docs/09 appendix header: c2 has 20 trials per day, the others 16
# (A3 on 0806 has 15 — one video intentionally left empty).
EXPECTED_VIDEOS: dict[tuple[str, str], int] = {
    (group, day): 16 for group in GROUPS for day in DAYS
}
for day in DAYS:
    EXPECTED_VIDEOS[("c2", day)] = 20
EXPECTED_VIDEOS[("A3", "0806")] = 15

REL_TOL = 0.005
ABS_TOL = {"dist_px": 1.0, "speed_px": 0.1}
SQL_EQUIVALENCE_TOL = 1e-9

MATRIX_SQL = text(
    """
    SELECT v.group_name, v.date_dir, m.metric, AVG(m.value) AS avg_value,
           COUNT(*) AS vids
    FROM trial_metrics m JOIN videos v ON v.video_id = m.video_id
    WHERE m.algo_version = :v AND v.phase = 'training_day'
      AND m.metric IN ('dist_px', 'speed_px') AND m.calc_status = 'ok'
    GROUP BY v.group_name, v.date_dir, m.metric
    """
)

GOLDEN_CTE = """
    WITH vm AS (
      SELECT video_id, SUM(d) AS dist_px,
             SUM(d) / NULLIF(MAX(time_s) - MIN(time_s), 0) AS speed_px
      FROM (SELECT video_id, time_s, center_x, center_y,
              SQRT(POW(center_x - LAG(center_x) OVER w, 2)
                 + POW(center_y - LAG(center_y) OVER w, 2)) AS d
            FROM frame_predictions WHERE status = 'ok'
            WINDOW w AS (PARTITION BY video_id ORDER BY frame_idx)) t
      GROUP BY video_id)
"""


def check_matrix(conn: Any) -> bool:
    rows = {
        (str(r[0]), str(r[1]), str(r[2])): (float(r[3]), int(r[4]))
        for r in conn.execute(MATRIX_SQL, {"v": ALGO_VERSION})
    }
    passed = True
    for group in GROUPS:
        for day in DAYS:
            golden_dist, golden_speed = GOLDEN[(group, day)]
            for metric, golden in (
                ("dist_px", golden_dist),
                ("speed_px", golden_speed),
            ):
                key = (group, day, metric)
                if key not in rows:
                    logger.error(
                        "MISSING  %s %s %s — no averaged row", group, day, metric
                    )
                    passed = False
                    continue
                computed, vids = rows[key]
                rel_diff = abs(computed - golden) / golden
                ok = abs(computed - golden) <= ABS_TOL[metric] or rel_diff <= REL_TOL
                if not ok:
                    passed = False
                logger.info(
                    "%s  %s %s %-8s computed=%10.2f golden=%8.1f rel_diff=%.3f%%",
                    "PASS" if ok else "FAIL",
                    group,
                    day,
                    metric,
                    computed,
                    golden,
                    rel_diff * 100,
                )
            cell = (group, day, "dist_px")
            if cell in rows:
                vids = rows[cell][1]
                expected = EXPECTED_VIDEOS[(group, day)]
                if vids != expected:
                    logger.error(
                        "FAIL  %s %s video count %d != expected %d",
                        group,
                        day,
                        vids,
                        expected,
                    )
                    passed = False
    return passed


def check_sql_equivalence(conn: Any) -> bool:
    passed = True
    for metric, column in (("dist_px", "dist_px"), ("speed_px", "speed_px")):
        row = conn.execute(
            text(
                GOLDEN_CTE
                + f"""
                SELECT COUNT(*) AS n,
                       MAX(ABS(m.value - vm.{column}) / NULLIF(vm.{column}, 0)) AS max_rel
                FROM vm JOIN trial_metrics m
                  ON m.video_id = vm.video_id
                 AND m.metric = '{metric}'
                 AND m.algo_version = :v AND m.calc_status = 'ok'
                """
            ),
            {"v": ALGO_VERSION},
        ).one()
        n, max_rel = int(row[0]), row[1]
        max_rel = float(max_rel) if max_rel is not None else 0.0
        ok = max_rel <= SQL_EQUIVALENCE_TOL
        passed = passed and ok
        logger.info(
            "%s  SQL cross-check %-8s trials=%d max_rel_diff=%.3e (tol %.0e)",
            "PASS" if ok else "FAIL",
            metric,
            n,
            max_rel,
            SQL_EQUIVALENCE_TOL,
        )
    return passed


def report_kp_sanity(conn: Any) -> None:
    row = conn.execute(
        text(
            "SELECT COUNT(*), AVG(ABS(m.value - q.valid_keypoint_frame_ratio)) "
            "FROM trial_metrics m JOIN qc_summary q ON q.video_id = m.video_id "
            "WHERE m.metric = 'valid_kp_ratio' AND m.algo_version = :v"
        ),
        {"v": ALGO_VERSION},
    ).one()
    logger.info(
        "INFO  valid_kp_ratio vs qc_summary.valid_keypoint_frame_ratio: "
        "videos=%d mean_abs_diff=%.4f (same口径 expected; outliers are known "
        "qc quirks, docs/09 遗留疑点)",
        int(row[0]),
        float(row[1]),
    )


def main() -> int:
    engine = metrics_engine()
    with engine.connect() as conn:
        logger.info(
            "=== 1. golden matrix (docs/09 appendix), tolerance %.1f%% ===",
            REL_TOL * 100,
        )
        matrix_ok = check_matrix(conn)
        logger.info("=== 2. live golden CTE vs Python-written values ===")
        sql_ok = check_sql_equivalence(conn)
        report_kp_sanity(conn)
    overall = matrix_ok and sql_ok
    logger.info("OVERALL: %s", "PASS" if overall else "FAIL")
    return 0 if overall else 1


if __name__ == "__main__":
    sys.exit(main())
