"""Generate the stratified event-sampling report for manual verification.

docs/10 抽样人工核验（AC2, ticket #6): N=10 trials stratified across
group × training day, including no_mount trials — a failed trial is
exactly what the lead must confirm stays a NULL, not a fabricated
latency. Event times come from the stored event batch; frame numbers are
time_s × 30 (time_s = frame_idx / 30 in this dataset).

The report goes to stdout by default; pass a path to write it as a file
(e.g. docs/evidence/m1-t7/sampling-verification.md).

Run from backend/:

    export METRICS_DB_PW=$(docker exec healthad-mysql printenv MYSQL_ROOT_PASSWORD)
    uv run python -m scripts.metrics.sample_event_verification [out.md]

Selection is deterministic (fixed seed): same data → same sample, so the
lead's annotations stay valid across report regenerations.
"""

import logging
import random
import sys
from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import text

from app.metrics.definitions import ALGO_VERSION_EVENTS
from scripts.metrics._db import metrics_engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("sample_event_verification")

FPS = 30
SEED = 20261013
MOUNTED_PICKS = 7
NO_MOUNT_PICKS = 3

SQL = text(
    "SELECT m.video_id, v.group_name, v.mouse_id, v.date_dir, v.session_no, "
    "       v.trial_no, v.source_video_path, q.qc_status, m.metric, m.value, "
    "       m.calc_status "
    "FROM trial_metrics m JOIN videos v ON v.video_id = m.video_id "
    "JOIN qc_summary q ON q.video_id = v.video_id "
    f"WHERE m.algo_version = '{ALGO_VERSION_EVENTS}' "
    "  AND v.phase = 'training_day' "
    "  AND m.metric IN ('first_detection_s', 'water_entry_s', "
    "                   'platform_contact_s', 'mount_s', 'escape_latency_s') "
    "ORDER BY m.video_id, m.metric"
)

_EVENT_ORDER = (
    "first_detection_s",
    "water_entry_s",
    "platform_contact_s",
    "mount_s",
    "escape_latency_s",
)


@dataclass
class Trial:
    video_id: str
    group: str
    mouse: str
    day: str
    session: str
    trial_no: str
    path: str
    qc: str
    events: dict[str, tuple[float | None, str]]  # metric -> (value, status)

    @property
    def mounted(self) -> bool:
        return self.events["escape_latency_s"][1] == "ok"


def load_trials() -> list[Trial]:
    engine = metrics_engine()
    by_video: dict[str, dict[str, tuple[float | None, str]]] = {}
    meta: dict[str, tuple[str, str, str, str, str, str, str]] = {}
    with engine.connect() as conn:
        for row in conn.execute(SQL):
            (
                video_id,
                group,
                mouse,
                day,
                session,
                trial_no,
                path,
                qc,
                metric,
                value,
                status,
            ) = row
            by_video.setdefault(video_id, {})[metric] = (
                None if value is None else float(value),
                str(status),
            )
            meta[video_id] = (
                str(group),
                str(mouse),
                str(day),
                str(session),
                str(trial_no),
                str(path),
                str(qc),
            )
    trials = [
        Trial(
            video_id=video_id,
            group=meta[video_id][0],
            mouse=meta[video_id][1],
            day=meta[video_id][2],
            session=meta[video_id][3],
            trial_no=meta[video_id][4],
            path=meta[video_id][5],
            qc=meta[video_id][6],
            events=events,
        )
        for video_id, events in by_video.items()
    ]
    return sorted(trials, key=lambda t: (t.day, t.group, t.mouse, t.session))


def _pick_stratified(
    rng: random.Random, trials: Iterable[Trial], want_mounted: bool, count: int
) -> list[Trial]:
    """One trial per (group, day) cell while cells last, then free picks."""
    pool = [t for t in trials if t.mounted == want_mounted]
    rng.shuffle(pool)
    picked: list[Trial] = []
    used_cells: set[tuple[str, str]] = set()
    for trial in pool:  # first pass: distinct (group, day) cells
        if len(picked) == count:
            break
        cell = (trial.group, trial.day)
        if cell not in used_cells:
            used_cells.add(cell)
            picked.append(trial)
    for trial in pool:  # second pass: fill any shortfall freely
        if len(picked) == count:
            break
        if trial not in picked:
            picked.append(trial)
    return picked


def _event_cell(trial: Trial, metric: str) -> str:
    value, status = trial.events[metric]
    if value is None:
        return f"—（{status}）"
    if metric == "escape_latency_s":  # a duration, not an event frame index
        return f"{value:.2f}s"
    return f"{value:.2f}s (帧{round(value * FPS)})"


def render(trials: list[Trial]) -> str:
    lines = [
        "# 事件定义抽样人工核验清单（docs/10 AC2，工单 #6）",
        "",
        "口径：首次出现/首次入水=中心点规则；碰台=**mask 首次接触平台圈**"
        "（2026-10-13 用户裁决）；有效上台=中心在平台圈内连续 ≥15 个连续 ok 帧"
        "（≥0.5s）；潜伏期=有效上台−首次出现。",
        "",
        "核验方法：按时间戳拖到对应视频位置（帧号/30），逐事件勾选；"
        "no_mount 试次请确认全程确无 ≥0.5s 的台上停留。",
        "",
        "| # | 视频（试次） | 组/鼠 | 日/区块/尾号 | qc | 首次出现 | 首次入水 | "
        "碰台(mask) | 有效上台 | 潜伏期 | 人工核验结论 |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for index, trial in enumerate(trials, start=1):
        lines.append(
            f"| {index} | `{trial.video_id}` | {trial.group}/{trial.mouse} "
            f"| {trial.day}/s{trial.session}/{trial.trial_no} | {trial.qc} "
            f"| {_event_cell(trial, 'first_detection_s')} "
            f"| {_event_cell(trial, 'water_entry_s')} "
            f"| {_event_cell(trial, 'platform_contact_s')} "
            f"| {_event_cell(trial, 'mount_s')} "
            f"| {_event_cell(trial, 'escape_latency_s')} |　|"
        )
    lines += [
        "",
        "## 视频文件路径",
        "",
    ]
    for index, trial in enumerate(trials, start=1):
        lines.append(f"{index}. `{trial.path}`")
    lines += [
        "",
        "不一致项处理（docs/10）：先改 docs/10 口径文档，再改计算代码。",
        "",
        f"_生成：scripts/metrics/sample_event_verification.py，"
        f"seed={SEED}，mounted {MOUNTED_PICKS} + no_mount {NO_MOUNT_PICKS}，"
        f"algo_version={ALGO_VERSION_EVENTS}_",
    ]
    return "\n".join(lines) + "\n"


def main() -> int:
    trials = load_trials()
    rng = random.Random(SEED)
    sample = _pick_stratified(rng, trials, want_mounted=True, count=MOUNTED_PICKS)
    sample += _pick_stratified(rng, trials, want_mounted=False, count=NO_MOUNT_PICKS)
    mounted = sum(1 for trial in sample if trial.mounted)
    logger.info(
        "sampled %d trials (%d mounted, %d no_mount) from %d training trials",
        len(sample),
        mounted,
        len(sample) - mounted,
        len(trials),
    )
    report = render(sample)
    if len(sys.argv) > 1:
        with open(sys.argv[1], "w", encoding="utf-8") as handle:
            handle.write(report)
        logger.info("wrote %s", sys.argv[1])
    else:
        sys.stdout.write(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
