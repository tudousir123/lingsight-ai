"""`trial_metrics` DDL and idempotent writes (ADR-0003, ticket #4).

water_maze is an external research database, so the table is managed by
this idempotent DDL (`CREATE TABLE IF NOT EXISTS`) applied by the compute
script — deliberately outside Alembic, which only migrates the app's own
schema. The same constant is used by the store tests, so the tested DDL
is exactly what production runs.
"""

from collections.abc import Sequence
from typing import Any

from sqlalchemy import Connection, text

from app.metrics.definitions import MetricRow

TRIAL_METRICS_DDL = """
CREATE TABLE IF NOT EXISTS trial_metrics (
  video_id      VARCHAR(128) NOT NULL
    COMMENT '视频=试次标识，关联 videos.video_id（全库无外键，按约定 join）',
  metric        VARCHAR(32)  NOT NULL
    COMMENT '指标名：dist_px|speed_px|valid_kp_ratio|in_pool_ratio | 事件批 escape_latency_s/first_detection_s/water_entry_s/platform_contact_s/mount_s（口径见 definition 列）',
  algo_version  VARCHAR(64)  NOT NULL
    COMMENT '算法版本：重算发新版本不覆盖旧值（ADR-0003）。v1-polyline-ok-frames（轨迹 4 指标）| v1-platformzone-46px-maskcontact-mount500ms（事件 5 指标，ADR-0006）',
  value         DOUBLE       NULL
    COMMENT '指标值；calc_status != ok 时为 NULL',
  unit          VARCHAR(16)  NOT NULL
    COMMENT '单位：px | px/s | ratio | s',
  calc_status   VARCHAR(24)  NOT NULL
    COMMENT '计算状态：ok | no_frames | no_ok_frames | insufficient_ok_frames | missing_pool_params | missing_platform_params | missing_mask_params | no_entry | no_contact | no_mount',
  ok_frames     INT          NOT NULL
    COMMENT '口径快照：该视频 status=ok 帧数',
  total_frames  INT          NOT NULL
    COMMENT '口径快照：该视频全部帧数',
  duration_s    DOUBLE       NULL
    COMMENT '口径快照：ok 帧时间跨度 MAX(time_s)-MIN(time_s)（秒，speed_px 分母）',
  definition    VARCHAR(255) NOT NULL
    COMMENT '指标口径一句话（行级自描述；结构化口径以语义层与 ADR-0003 为准）',
  calculated_at TIMESTAMP    NOT NULL
    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    COMMENT '本行写入/更新时间（UTC）',
  PRIMARY KEY (video_id, metric, algo_version),
  KEY idx_metric_version (metric, algo_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='试次级行为指标表（ADR-0003）：确定性 Python 从 frame_predictions 计算入库，SQL/LLM 不推导指标；长格式每视频每指标一行'
"""

_INSERT_SQL = text(
    """
    INSERT INTO trial_metrics
      (video_id, metric, algo_version, value, unit, calc_status,
       ok_frames, total_frames, duration_s, definition)
    VALUES
      (:video_id, :metric, :algo_version, :value, :unit, :calc_status,
       :ok_frames, :total_frames, :duration_s, :definition)
    """
)


def ensure_trial_metrics_table(conn: Connection) -> None:
    """Create trial_metrics if absent; a no-op when it already exists."""
    conn.exec_driver_sql(TRIAL_METRICS_DDL)


def write_trial_metrics(conn: Connection, rows: Sequence[MetricRow]) -> int:
    """Write metric rows idempotently; returns the number of rows written.

    One transaction: DELETE every row of the algo_version(s) present in
    `rows`, then INSERT the batch. Rerunning the same version therefore
    replaces that version's snapshot (stale videos disappear) without
    ever duplicating rows, and never touches other algo_versions.
    """
    versions = sorted({row.algo_version for row in rows})
    params: list[dict[str, Any]] = [
        {
            "video_id": row.video_id,
            "metric": row.metric,
            "algo_version": row.algo_version,
            "value": row.value,
            "unit": row.unit,
            "calc_status": row.calc_status,
            "ok_frames": row.ok_frames,
            "total_frames": row.total_frames,
            "duration_s": row.duration_s,
            "definition": row.definition,
        }
        for row in rows
    ]
    try:
        for version in versions:
            conn.execute(
                text("DELETE FROM trial_metrics WHERE algo_version = :version"),
                {"version": version},
            )
        if params:
            conn.execute(_INSERT_SQL, params)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return len(params)
