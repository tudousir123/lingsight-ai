"""Build the synthetic trial fixture used by CI and the dev stack (#20-#23).

Everything is generated: a synthetic swim path (640x360, 30 fps, 90 frames)
drives both the committed sample videos (pure-Python PPM frames + ffmpeg)
and the per-frame track, metrics and event values in ``fixture.json`` — so
the fixture is internally consistent without any real research data.

Run from ``backend/``:  uv run python scripts/trials/build_fixture.py
"""

import json
import math
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from app.metrics.definitions import ALGO_VERSION as TRACK_ALGO
from app.metrics.definitions import ALGO_VERSION_EVENTS as EVENT_ALGO

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "app" / "trials" / "fixtures"
WIDTH, HEIGHT, FPS, FRAMES = 640, 360, 30, 90
POOL = {"cx": 320.0, "cy": 180.0, "r": 150.0}
PLATFORM = {"cx": 420.0, "cy": 180.0, "r": 40.0}
MARKER_BOXES = {
    "pentacle": (60, 40),
    "rectangle": (540, 40),
    "triangle": (60, 280),
    "round": (540, 280),
}
MISS_FRAMES = {20, 21, 22, 23}
COORD_FRAMES = {50, 51}
# --- synthetic swim path -------------------------------------------------------


def swim_center(i: int) -> tuple[float, float]:
    """Outside the pool → across it → lingering on the platform."""
    if i < 70:
        x = 150.0 + (420.0 - 150.0) * (i / 70)
        y = 180.0 + 50.0 * math.sin(i / 5.0)
    else:
        x = 420.0 + 3.0 * math.sin(i / 2.0)
        y = 180.0 + 3.0 * math.cos(i / 3.0)
    return x, y


def build_frames() -> list[dict[str, Any]]:
    frames: list[dict[str, Any]] = []
    for i in range(FRAMES):
        entry: dict[str, Any] = {
            "frame": i,
            "time_s": round(i / FPS, 4),
            "status": "ok",
        }
        if i in MISS_FRAMES:
            entry["status"] = "miss"
        else:
            cx, cy = swim_center(i)
            entry["center"] = [round(cx, 2), round(cy, 2)]
            if i not in COORD_FRAMES:
                entry["head"] = [round(cx + 10, 2), round(cy - 8, 2)]
                entry["tail"] = [round(cx - 10, 2), round(cy + 8, 2)]
            entry["status"] = "coord" if i in COORD_FRAMES else "ok"
        frames.append(entry)
    return frames


def first_entry_time(frames: list[dict[str, Any]], circle: dict[str, float]) -> float:
    for entry in frames:
        center = entry.get("center")
        if center and math.dist(center, (circle["cx"], circle["cy"])) <= circle["r"]:
            return float(entry["time_s"])
    raise AssertionError("synthetic path never enters the circle")


def polyline_length(frames: list[dict[str, Any]]) -> float:
    """Path length over consecutive observed frames only — gaps break the line."""
    total = 0.0
    prev: tuple[int, tuple[float, float]] | None = None
    for entry in frames:
        center = entry.get("center")
        if center is None:
            prev = None
            continue
        if prev is not None and entry["frame"] == prev[0] + 1:
            total += math.dist(prev[1], center)
        prev = (entry["frame"], center)
    return total


def build_metrics(frames: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ok = [e for e in frames if e["status"] == "ok"]
    total = len(frames)
    dist = polyline_length(frames)
    duration = ok[-1]["time_s"] - ok[0]["time_s"]
    in_pool = sum(
        1
        for e in frames
        if e.get("center")
        and math.dist(e["center"], (POOL["cx"], POOL["cy"])) <= POOL["r"]
    )
    first_detection = float(frames[0]["time_s"])
    water_entry = first_entry_time(frames, POOL)
    contact = first_entry_time(frames, PLATFORM)
    mount = contact + 0.5
    stamp = "2026-10-13T08:00:00"
    common = {
        "ok_frames": len(ok),
        "total_frames": total,
        "duration_s": round(duration, 3),
        "calculated_at": stamp,
    }
    return [
        {
            "metric": "dist_px",
            "algo_version": TRACK_ALGO,
            "value": round(dist, 1),
            "unit": "px",
            "calc_status": "ok",
            **common,
        },
        {
            "metric": "speed_px",
            "algo_version": TRACK_ALGO,
            "value": round(dist / duration, 2),
            "unit": "px/s",
            "calc_status": "ok",
            **common,
        },
        {
            "metric": "valid_kp_ratio",
            "algo_version": TRACK_ALGO,
            "value": round(len(ok) / total, 4),
            "unit": "ratio",
            "calc_status": "ok",
            **common,
        },
        {
            "metric": "in_pool_ratio",
            "algo_version": TRACK_ALGO,
            "value": round(in_pool / total, 4),
            "unit": "ratio",
            "calc_status": "ok",
            **common,
        },
        {
            "metric": "first_detection_s",
            "algo_version": EVENT_ALGO,
            "value": first_detection,
            "unit": "s",
            "calc_status": "ok",
            **common,
        },
        {
            "metric": "water_entry_s",
            "algo_version": EVENT_ALGO,
            "value": round(water_entry, 3),
            "unit": "s",
            "calc_status": "ok",
            **common,
        },
        {
            "metric": "platform_contact_s",
            "algo_version": EVENT_ALGO,
            "value": round(contact, 3),
            "unit": "s",
            "calc_status": "ok",
            **common,
        },
        {
            "metric": "mount_s",
            "algo_version": EVENT_ALGO,
            "value": round(mount, 3),
            "unit": "s",
            "calc_status": "ok",
            **common,
        },
        {
            "metric": "escape_latency_s",
            "algo_version": EVENT_ALGO,
            "value": round(mount - first_detection, 3),
            "unit": "s",
            "calc_status": "ok",
            **common,
        },
    ]


# --- PPM rendering ---------------------------------------------------------------

BLUE_BG = (60, 90, 130)
POOL_FILL = (150, 190, 220)
PLATFORM_FILL = (235, 200, 90)
MARKER_FILL = (240, 240, 240)
MOUSE = (250, 250, 250)
TRAIL = (220, 70, 70)
MOUSE_RADIUS = 5


def static_background() -> bytearray:
    """Pool, platform and markers never move — render them once."""
    buf = bytearray(WIDTH * HEIGHT * 3)
    for y in range(HEIGHT):
        for x in range(WIDTH):
            color = BLUE_BG
            if math.dist((x, y), (POOL["cx"], POOL["cy"])) <= POOL["r"]:
                color = POOL_FILL
            if math.dist((x, y), (PLATFORM["cx"], PLATFORM["cy"])) <= PLATFORM["r"]:
                color = PLATFORM_FILL
            for bx, by in MARKER_BOXES.values():
                if bx <= x < bx + 40 and by <= y < by + 40:
                    color = MARKER_FILL
            offset = (y * WIDTH + x) * 3
            buf[offset : offset + 3] = bytes(color)
    return buf


def stamp_disc(
    buf: bytearray, center: tuple[float, float], color: tuple[int, int, int]
) -> None:
    cx, cy = center
    for y in range(
        max(0, int(cy) - MOUSE_RADIUS), min(HEIGHT, int(cy) + MOUSE_RADIUS + 1)
    ):
        for x in range(
            max(0, int(cx) - MOUSE_RADIUS), min(WIDTH, int(cx) + MOUSE_RADIUS + 1)
        ):
            if math.dist((x, y), (cx, cy)) <= MOUSE_RADIUS:
                offset = (y * WIDTH + x) * 3
                buf[offset : offset + 3] = bytes(color)


def stamp_pixel(buf: bytearray, x: int, y: int, color: tuple[int, int, int]) -> None:
    offset = (y * WIDTH + x) * 3
    buf[offset : offset + 3] = bytes(color)


def ppm_frames(frames: list[dict[str, Any]], overlay: bool, workdir: Path) -> None:
    """source: white mouse dot; overlay: red dot + dotted trail, baked in."""
    workdir.mkdir(parents=True, exist_ok=True)
    background = static_background()
    for idx, entry in enumerate(frames):
        buf = bytearray(background)
        center = entry.get("center")
        if center is not None:
            stamp_disc(buf, center, TRAIL if overlay else MOUSE)
        if overlay:
            for past in frames[: idx + 1]:
                past_center = past.get("center")
                if not past_center:
                    continue
                px, py = int(round(past_center[0])), int(round(past_center[1]))
                if 0 <= px < WIDTH and 0 <= py < HEIGHT:
                    stamp_pixel(buf, px, py, TRAIL)
        header = f"P6\n{WIDTH} {HEIGHT}\n255\n".encode()
        (workdir / f"frame_{idx:03d}.ppm").write_bytes(header + bytes(buf))


def encode(workdir: Path, out: Path) -> None:
    command = [
        "ffmpeg",
        "-y",
        "-loglevel",
        "error",
        "-framerate",
        str(FPS),
        "-i",
        str(workdir / "frame_%03d.ppm"),
        "-frames:v",
        str(FRAMES),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-crf",
        "28",
        "-movflags",
        "+faststart",
        str(out),
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0 or not out.is_file() or out.stat().st_size == 0:
        sys.exit(f"ffmpeg failed for {out}: {result.stderr.strip()}")


# --- fixture assembly ---------------------------------------------------------------


def marker_shapes() -> list[dict[str, Any]]:
    shapes = []
    for label, (bx, by) in MARKER_BOXES.items():
        shapes.append(
            {
                "label": label,
                "points": [[bx, by], [bx + 40, by], [bx + 40, by + 40], [bx, by + 40]],
            }
        )
    return shapes


def main() -> None:
    media_dir = FIXTURES_DIR / "media"
    media_dir.mkdir(parents=True, exist_ok=True)
    frames = build_frames()
    metrics = build_metrics(frames)

    source_work = FIXTURES_DIR / "_tmp_source"
    overlay_work = FIXTURES_DIR / "_tmp_overlay"
    ppm_frames(frames, overlay=False, workdir=source_work)
    ppm_frames(frames, overlay=True, workdir=overlay_work)
    encode(source_work, media_dir / "fixture-source.mp4")
    encode(overlay_work, media_dir / "fixture-overlay.mp4")
    shutil.rmtree(source_work)
    shutil.rmtree(overlay_work)

    track_full = {
        "source": "fixture_run_v1",
        "frames": frames,
    }
    # The truncated path (first 60 frames) never reaches the platform, so its
    # event metrics honestly carry no_contact / no_mount statuses — the same
    # failure rows a real failed trial keeps instead of silently dropping.
    partial = frames[:60]
    partial_ok = [e for e in partial if e["status"] == "ok"]
    partial_dist = polyline_length(partial)
    partial_duration = partial_ok[-1]["time_s"] - partial_ok[0]["time_s"]
    partial_stamp = "2026-10-13T08:00:00"
    partial_common = {
        "ok_frames": len(partial_ok),
        "total_frames": len(partial),
        "duration_s": round(partial_duration, 3),
        "calculated_at": partial_stamp,
    }
    no_mount_metrics = [
        {
            "metric": "dist_px",
            "algo_version": TRACK_ALGO,
            "value": round(partial_dist, 1),
            "unit": "px",
            "calc_status": "ok",
            **partial_common,
        },
        {
            "metric": "speed_px",
            "algo_version": TRACK_ALGO,
            "value": round(partial_dist / partial_duration, 2),
            "unit": "px/s",
            "calc_status": "ok",
            **partial_common,
        },
        {
            "metric": "first_detection_s",
            "algo_version": EVENT_ALGO,
            "value": float(partial[0]["time_s"]),
            "unit": "s",
            "calc_status": "ok",
            **partial_common,
        },
        {
            "metric": "water_entry_s",
            "algo_version": EVENT_ALGO,
            "value": round(first_entry_time(partial, POOL), 3),
            "unit": "s",
            "calc_status": "ok",
            **partial_common,
        },
        {
            "metric": "platform_contact_s",
            "algo_version": EVENT_ALGO,
            "value": None,
            "unit": "s",
            "calc_status": "no_contact",
            **partial_common,
        },
        {
            "metric": "mount_s",
            "algo_version": EVENT_ALGO,
            "value": None,
            "unit": "s",
            "calc_status": "no_mount",
            **partial_common,
        },
        {
            "metric": "escape_latency_s",
            "algo_version": EVENT_ALGO,
            "value": None,
            "unit": "s",
            "calc_status": "no_mount",
            **partial_common,
        },
    ]
    track_partial = {
        "source": "fixture_run_v1",
        "frames": partial,
    }

    fixture = {
        "experiments": [
            {"id": "fixture-e1", "name": "合成示例实验一（非真实数据）"},
            {"id": "fixture-e2", "name": "合成示例实验二（非真实数据）"},
            {"id": "fixture-e3", "name": "合成空实验（非真实数据）"},
        ],
        "trials": [
            {
                "id": "fixture-trial-a",
                "experiment_id": "fixture-e1",
                "video_name": "合成试次A.mp4",
                "group_name": "SynA",
                "mouse_id": "1",
                "phase": "training_day",
                "date_dir": "0804",
                "training_day": 1,
                "session_no": 1,
                "session_label": "第1次",
                "trial_no": "1",
                "fps": FPS,
                "width": WIDTH,
                "height": HEIGHT,
                "artifact_mode": "fixture_run_v1",
                "media": {
                    "source": "media/fixture-source.mp4",
                    "overlay": "media/fixture-overlay.mp4",
                },
                "pool": {**POOL, "source": "per_video_measured"},
                "markers": {
                    "shapes": marker_shapes(),
                    "source": "人工 LabelMe 场景标注（合成数据）",
                },
                "platform": {
                    **PLATFORM,
                    "day_label": "0804",
                    "source": "E1 报告共识坐标（合成数据）",
                },
                "track": track_full,
                "qc_status": "review",
                "metrics": metrics,
            },
            {
                "id": "fixture-trial-b",
                "experiment_id": "fixture-e1",
                "video_name": "合成试次B.mp4",
                "group_name": "SynA",
                "mouse_id": "2",
                "phase": "training_day",
                "date_dir": "0804",
                "training_day": 1,
                "session_no": 2,
                "session_label": "第2次",
                "trial_no": "1",
                "fps": FPS,
                "width": WIDTH,
                "height": HEIGHT,
                "media": {"source": "media/fixture-source.mp4"},
                "pool": {**POOL, "source": "per_video_measured"},
                "markers": {
                    "shapes": marker_shapes(),
                    "source": "人工 LabelMe 场景标注（合成数据）",
                },
                "platform": {
                    **PLATFORM,
                    "day_label": "0804",
                    "source": "E1 报告共识坐标（合成数据）",
                },
            },
            {
                "id": "fixture-trial-c",
                "experiment_id": "fixture-e1",
                "video_name": "合成试次C.mp4",
                "group_name": "SynB",
                "mouse_id": "1",
                "phase": "probe_platform_present",
                "date_dir": "0810",
                "training_day": None,
                "session_no": 3,
                "session_label": "第1象限",
                "trial_no": "2",
                "fps": FPS,
                "width": WIDTH,
                "height": HEIGHT,
                "artifact_mode": "fixture_run_v1",
                "pool": {**POOL, "source": "per_video_measured"},
                "markers": {
                    "shapes": marker_shapes(),
                    "source": "人工 LabelMe 场景标注（合成数据）",
                },
                "track": track_partial,
                "qc_status": "ok",
            },
            {
                "id": "fixture-trial-d",
                "experiment_id": "fixture-e2",
                "video_name": "合成试次D.mp4",
                "group_name": "SynC",
                "mouse_id": "1",
                "phase": "training_day",
                "date_dir": "0805",
                "training_day": 2,
                "session_no": 1,
                "session_label": "第1次",
                "trial_no": "3",
                "fps": FPS,
                "width": WIDTH,
                "height": HEIGHT,
                "artifact_mode": "fixture_run_v1",
                "media": {
                    "source": "media/fixture-source.mp4",
                    "overlay": "media/fixture-overlay.mp4",
                },
                "pool": {**POOL, "source": "per_video_measured"},
                "platform": {
                    **PLATFORM,
                    "day_label": "0805",
                    "source": "E1 报告共识坐标（合成数据）",
                },
                "track": track_partial,
                "qc_status": "ok",
                "metrics": no_mount_metrics,
            },
        ],
    }
    target = FIXTURES_DIR / "fixture.json"
    target.write_text(
        json.dumps(fixture, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    print(f"wrote {target}")
    print(f"wrote {media_dir / 'fixture-source.mp4'}")
    print(f"wrote {media_dir / 'fixture-overlay.mp4'}")


if __name__ == "__main__":
    main()
