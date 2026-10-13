"""Deterministic trial metrics (ADR-0003, M1-T3 / ticket #4).

Python computes per-trial behavioral metrics from frame_predictions and
writes them to the long-format `trial_metrics` table; SQL and the LLM
only ever retrieve the results.
"""

from app.metrics.compute import (
    CircleGeometry,
    FrameObservation,
    compute_trial_metrics,
    polyline_length,
)
from app.metrics.definitions import (
    ALGO_VERSION,
    ALGO_VERSION_EVENTS,
    DIST_PX,
    ESCAPE_LATENCY_S,
    IN_POOL_RATIO,
    SPEED_PX,
    VALID_KP_RATIO,
    MetricRow,
)
from app.metrics.events import EventFrame, compute_trial_events
from app.metrics.store import ensure_trial_metrics_table, write_trial_metrics

__all__ = [
    "ALGO_VERSION",
    "ALGO_VERSION_EVENTS",
    "CircleGeometry",
    "DIST_PX",
    "ESCAPE_LATENCY_S",
    "EventFrame",
    "FrameObservation",
    "IN_POOL_RATIO",
    "MetricRow",
    "SPEED_PX",
    "VALID_KP_RATIO",
    "compute_trial_events",
    "compute_trial_metrics",
    "ensure_trial_metrics_table",
    "polyline_length",
    "write_trial_metrics",
]
