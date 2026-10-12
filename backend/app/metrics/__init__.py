"""Deterministic trial metrics (ADR-0003, M1-T3 / ticket #4).

Python computes per-trial behavioral metrics from frame_predictions and
writes them to the long-format `trial_metrics` table; SQL and the LLM
only ever retrieve the results.
"""

from app.metrics.compute import (
    FrameObservation,
    PoolGeometry,
    compute_trial_metrics,
    polyline_length,
)
from app.metrics.definitions import (
    ALGO_VERSION,
    DIST_PX,
    IN_POOL_RATIO,
    SPEED_PX,
    VALID_KP_RATIO,
    MetricRow,
)
from app.metrics.store import ensure_trial_metrics_table, write_trial_metrics

__all__ = [
    "ALGO_VERSION",
    "DIST_PX",
    "FrameObservation",
    "IN_POOL_RATIO",
    "MetricRow",
    "PoolGeometry",
    "SPEED_PX",
    "VALID_KP_RATIO",
    "compute_trial_metrics",
    "ensure_trial_metrics_table",
    "polyline_length",
    "write_trial_metrics",
]
