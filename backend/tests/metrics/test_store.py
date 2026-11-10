"""Idempotent metric-table writes (ticket #4 acceptance: rerunning the same
algo_version must never duplicate rows).

Runs against the pytest MySQL database (app_t4, compose service `db`) using
the exact production DDL constant — no access to the external water_maze
server from pytest.
"""

from collections.abc import Generator

import pytest
from sqlalchemy import Connection, text

from app.core.db import engine
from app.metrics.definitions import ALGO_VERSION
from app.metrics.store import (
    MetricRow,
    ensure_trial_metrics_table,
    write_trial_metrics,
)


def make_row(video_id: str, metric: str, value: float) -> MetricRow:
    return MetricRow(
        video_id=video_id,
        metric=metric,
        algo_version=ALGO_VERSION,
        value=value,
        unit="px",
        calc_status="ok",
        ok_frames=10,
        total_frames=12,
        duration_s=4.0,
        definition="test definition",
    )


@pytest.fixture()
def metrics_table(db: object) -> Generator[Connection]:
    with engine.connect() as conn:
        conn.exec_driver_sql("DROP TABLE IF EXISTS trial_metrics")
        conn.commit()
        ensure_trial_metrics_table(conn)
        conn.commit()
        yield conn
        conn.exec_driver_sql("DROP TABLE IF EXISTS trial_metrics")
        conn.commit()


def count_rows(conn: Connection) -> int:
    return int(conn.execute(text("SELECT COUNT(*) FROM trial_metrics")).scalar_one())


def duplicated_keys(conn: Connection) -> list[tuple[object, ...]]:
    result = conn.execute(
        text(
            "SELECT video_id, metric, algo_version, COUNT(*) c "
            "FROM trial_metrics GROUP BY video_id, metric, algo_version HAVING c > 1"
        )
    )
    return [tuple(row) for row in result]


def test_ensure_table_is_idempotent(metrics_table: Connection) -> None:
    ensure_trial_metrics_table(metrics_table)  # second apply must be a no-op
    metrics_table.commit()
    assert count_rows(metrics_table) == 0


def test_rerun_same_version_replaces_rows_without_duplicates(
    metrics_table: Connection,
) -> None:
    first = [make_row("v1", "dist_px", 100.0), make_row("v2", "dist_px", 200.0)]
    assert write_trial_metrics(metrics_table, first) == 2
    metrics_table.commit()
    assert count_rows(metrics_table) == 2

    # rerun with updated values for the same algo_version
    second = [make_row("v1", "dist_px", 101.0), make_row("v2", "dist_px", 201.0)]
    assert write_trial_metrics(metrics_table, second) == 2
    metrics_table.commit()

    assert count_rows(metrics_table) == 2
    assert duplicated_keys(metrics_table) == []
    value = metrics_table.execute(
        text(
            "SELECT value FROM trial_metrics "
            "WHERE video_id = 'v1' AND metric = 'dist_px' AND algo_version = :v"
        ),
        {"v": ALGO_VERSION},
    ).scalar_one()
    assert value == 101.0


def test_rerun_drops_stale_rows_of_that_version(metrics_table: Connection) -> None:
    # A version's rows are a snapshot: videos that no longer produce a metric
    # disappear instead of lingering from the previous run.
    write_trial_metrics(
        metrics_table, [make_row("v1", "dist_px", 1.0), make_row("v2", "dist_px", 2.0)]
    )
    metrics_table.commit()
    write_trial_metrics(metrics_table, [make_row("v1", "dist_px", 1.0)])
    metrics_table.commit()
    assert count_rows(metrics_table) == 1
    assert duplicated_keys(metrics_table) == []


def test_different_algo_versions_coexist(metrics_table: Connection) -> None:
    write_trial_metrics(metrics_table, [make_row("v1", "dist_px", 1.0)])
    metrics_table.commit()
    old_version = MetricRow(
        video_id="v1",
        metric="dist_px",
        algo_version="v0-legacy",
        value=0.9,
        unit="px",
        calc_status="ok",
        ok_frames=9,
        total_frames=12,
        duration_s=4.0,
        definition="old definition",
    )
    write_trial_metrics(metrics_table, [old_version])
    metrics_table.commit()
    # v0 untouched by the v1 rerun, and vice versa.
    write_trial_metrics(metrics_table, [make_row("v1", "dist_px", 1.5)])
    metrics_table.commit()
    assert count_rows(metrics_table) == 2
    values = {
        row[0] for row in metrics_table.execute(text("SELECT value FROM trial_metrics"))
    }
    assert values == {0.9, 1.5}


def test_empty_batch_is_a_documented_noop(metrics_table: Connection) -> None:
    # The replace scope is inferred from the algo_version(s) present in the
    # batch, so an empty batch has nothing to replace. A real compute run
    # always yields rows for every video (4 per video, statuses included),
    # so stale rows are always swept by the next non-empty run.
    write_trial_metrics(metrics_table, [make_row("v1", "dist_px", 1.0)])
    metrics_table.commit()
    write_trial_metrics(metrics_table, [])
    metrics_table.commit()
    assert count_rows(metrics_table) == 1
