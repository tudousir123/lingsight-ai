"""Render the AC2 sampling review as an HTML review page (ticket #6).

docs/10 抽样人工核验 surface: one HTML page + a ``clips/`` directory the
experiment lead judges directly. Per event card:

* a short **video clip** around the event (2 s before … 3 s after,
  down-scaled, loopable, with 0.25×/0.5×/1× speed buttons) — motion is
  how grazing contact and staying on the platform are actually judged;
* a native-resolution **zoom still** of the event frame around the
  platform with the algorithm's geometry drawn on top (platform circle
  46 px, decoded body-mask pixels, green = pixels inside the circle,
  crosshair = tracked center) plus a "before" counterfactual still;
* the trial-wide center-to-platform **distance curve** with the 46 px
  threshold and every sub-threshold span annotated in ok-frames, so
  有效上台 (≥15 consecutive ok frames) and no_mount verdicts are
  auditable at a glance;
* verdict radios per event; a button assembles the conclusion table as
  markdown (paste it back into sampling-verification.md / the ticket).

Clips are extracted with ffmpeg from the NAS-mounted videos
(``VIDEOS_ROOT`` maps the DB's ``/volume1/DATAS`` prefix, default
``/home/shuncheng/workspace/DATAS``). Deterministic: same sample seed as
``sample_event_verification``. Frames/clips are real research data and
stay out of git — the review artifacts are gitignored; regenerate with
this one command (see docs/10 抽样人工核验).

Run from backend/:

    export METRICS_DB_PW=$(docker exec healthad-mysql printenv MYSQL_ROOT_PASSWORD)
    uv run python -m scripts.metrics.render_sampling_review \
        ../docs/evidence/m1-t7/sampling-review.html
"""

import html
import logging
import math
import random
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import text

from app.metrics.definitions import (
    ESCAPE_LATENCY_S,
    FIRST_DETECTION_S,
    MOUNT_MIN_FRAMES,
    MOUNT_S,
    PLATFORM_CONTACT_S,
    PLATFORM_RADIUS_PX,
    WATER_ENTRY_S,
)
from app.metrics.events import mask_pixels
from scripts.metrics._db import metrics_engine
from scripts.metrics.sample_event_verification import (
    MOUNTED_PICKS,
    NO_MOUNT_PICKS,
    SEED,
    Trial,
    _pick_stratified,
    load_trials,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("render_sampling_review")

FPS = 30
VIDEOS_ROOT = "/home/shuncheng/workspace/DATAS"
_PATH_PREFIX = "/volume1/DATAS"

WIDE_W = 720  # clip / wide-view width after downscale
ZOOM_HALF = 160  # zoom still half-size (native pixels) around the platform
CLIP_BEFORE_S = 2.0
CLIP_AFTER_S = 3.0

_COLORS = {
    "pool": "#2563eb",
    "platform": "#dc2626",
    "mask": "#f59e0b",
    "touch": "#22c55e",
    "center": "#dc2626",
    "traj": "#64748b",
    "event": "#dc2626",
}


@dataclass(frozen=True)
class FrameRow:
    """One frame_predictions row for the review (centers only)."""

    frame_idx: int
    time_s: float | None
    center_x: float | None
    center_y: float | None
    status: str


@dataclass(frozen=True)
class Geometry:
    pool_cx: float
    pool_cy: float
    pool_r: float
    plat_cx: float
    plat_cy: float
    plat_r: float


# --- data loading ---------------------------------------------------------------


def load_geometry(video_id: str, day: str) -> Geometry:
    engine = metrics_engine()
    with engine.connect() as conn:
        video = conn.execute(
            text("SELECT pool_cx, pool_cy, pool_r FROM videos WHERE video_id = :v"),
            {"v": video_id},
        ).one()
        plat = conn.execute(
            text(
                "SELECT plat_cx_consensus, plat_cy_consensus FROM platform_positions "
                "WHERE day_label = :d"
            ),
            {"d": day},
        ).one()
    return Geometry(
        pool_cx=float(video[0]),
        pool_cy=float(video[1]),
        pool_r=float(video[2]),
        plat_cx=float(plat[0]),
        plat_cy=float(plat[1]),
        plat_r=PLATFORM_RADIUS_PX,
    )


def load_frames(video_id: str) -> list[FrameRow]:
    engine = metrics_engine()
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT frame_idx, time_s, center_x, center_y, status "
                "FROM frame_predictions WHERE video_id = :v ORDER BY frame_idx"
            ),
            {"v": video_id},
        )
        return [
            FrameRow(
                int(r[0]),
                None if r[1] is None else float(r[1]),
                None if r[2] is None else float(r[2]),
                None if r[3] is None else float(r[3]),
                str(r[4]),
            )
            for r in rows
        ]


def load_mask(video_id: str, frame_idx: int) -> tuple[str, int, int] | None:
    engine = metrics_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT mask_rle_counts, mask_width, mask_height "
                "FROM frame_predictions WHERE video_id = :v AND frame_idx = :f"
            ),
            {"v": video_id, "f": frame_idx},
        ).first()
    if row is None or row[0] is None:
        return None
    return str(row[0]), int(row[1]), int(row[2])


# --- ffmpeg ---------------------------------------------------------------------


def local_path(source_path: str, videos_root: str) -> str:
    assert source_path.startswith(_PATH_PREFIX), f"unexpected path {source_path}"
    return videos_root + source_path[len(_PATH_PREFIX) :]


def probe_duration(video: str) -> float | None:
    """Container duration in seconds; None when ffprobe fails."""
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            video,
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )
    try:
        return float(result.stdout.strip()) if result.returncode == 0 else None
    except ValueError:
        return None


def _wrote_nonempty(path: str, returncode: int) -> bool:
    """ffmpeg exits 0 even when -ss lands past EOF and writes nothing
    (several videos in the library are only 2–7 s long), so a clean exit
    proves nothing: the output file must exist and be non-empty."""
    return returncode == 0 and Path(path).exists() and Path(path).stat().st_size > 0


def extract_clip(video: str, start: float, end: float, out_mp4: str) -> bool:
    """Encode a muted, down-scaled H.264 clip [start, end) for the page."""
    start = max(0.0, start)
    duration = probe_duration(video)
    if duration is not None and start >= duration - 0.05:
        return False
    if duration is not None:
        end = min(end, duration - 0.05)
    cmd = [
        "ffmpeg",
        "-v",
        "error",
        "-nostdin",
        "-ss",
        f"{start:.3f}",
        "-to",
        f"{end:.3f}",
        "-i",
        video,
        "-vf",
        f"scale={WIDE_W}:-2",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "28",
        "-an",
        "-movflags",
        "+faststart",
        "-y",
        out_mp4,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    return _wrote_nonempty(out_mp4, result.returncode)


def extract_still(
    video: str,
    t_seconds: float,
    out_jpg: str,
    *,
    crop: tuple[int, int, int, int] | None = None,
) -> bool:
    """Extract one still: native-res crop when ``crop`` is given."""
    t = max(0.0, t_seconds)
    duration = probe_duration(video)
    if duration is not None and t >= duration - 0.05:
        return False  # beyond EOF: ffmpeg would exit 0 without writing
    vf = (
        f"crop={crop[0]}:{crop[1]}:{crop[2]}:{crop[3]}"
        if crop
        else f"scale={WIDE_W}:-1"
    )
    cmd = [
        "ffmpeg",
        "-v",
        "error",
        "-nostdin",
        "-ss",
        f"{t:.3f}",
        "-i",
        video,
        "-frames:v",
        "1",
        "-vf",
        vf,
        "-q:v",
        "4",
        "-y",
        out_jpg,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    return _wrote_nonempty(out_jpg, result.returncode)


# --- SVG pieces -----------------------------------------------------------------


def svg_trajectory(
    frames: list[FrameRow], geo: Geometry, width: int = 760, height: int = 428
) -> str:
    """Top-down map: pool + platform circles and the ok-frame path."""
    frame_w, frame_h = 2560.0, 1440.0
    scale = min(width / frame_w, height / frame_h)
    ox = (width - frame_w * scale) / 2
    oy = (height - frame_h * scale) / 2

    def sx(x: float) -> float:
        return ox + x * scale

    def sy(y: float) -> float:
        return oy + y * scale

    pts = [
        f"{sx(f.center_x):.1f},{sy(f.center_y):.1f}"
        for f in frames
        if f.status == "ok" and f.center_x is not None and f.center_y is not None
    ]
    polyline = (
        f'<polyline points="{" ".join(pts)}" fill="none" '
        f'stroke="{_COLORS["traj"]}" stroke-width="1" opacity="0.75"/>'
        if len(pts) > 1
        else ""
    )
    pool = (
        f'<circle cx="{sx(geo.pool_cx):.1f}" cy="{sy(geo.pool_cy):.1f}" '
        f'r="{geo.pool_r * scale:.1f}" fill="none" stroke="{_COLORS["pool"]}" '
        f'stroke-width="2" opacity="0.8"/>'
    )
    plat = (
        f'<circle cx="{sx(geo.plat_cx):.1f}" cy="{sy(geo.plat_cy):.1f}" '
        f'r="{geo.plat_r * scale:.1f}" fill="none" stroke="{_COLORS["platform"]}" '
        f'stroke-width="1.5"/>'
    )
    return (
        f'<svg viewBox="0 0 {width} {height}" class="map">'
        f'<rect width="{width}" height="{height}" fill="#0f172a"/>'
        f"{pool}{plat}{polyline}{plat}</svg>"
    )


def svg_curve(
    frames: list[FrameRow],
    geo: Geometry,
    markers: dict[str, float | None],
    width: int = 760,
    height: int = 200,
) -> str:
    """dist(center → platform center) over time with the 46 px threshold."""
    # (time, cx, cy) of ok frames — built once so mypy keeps the narrowed
    # floats instead of re-deriving them from Optional fields.
    ok = [
        (f.time_s, f.center_x, f.center_y)
        for f in frames
        if f.status == "ok"
        and f.time_s is not None
        and f.center_x is not None
        and f.center_y is not None
    ]
    if not ok:
        return "<svg viewBox='0 0 10 10'></svg>"
    t0, t1 = ok[0][0], max(f[0] for f in ok)
    dists = [math.hypot(f[1] - geo.plat_cx, f[2] - geo.plat_cy) for f in ok]
    d_max = max(max(dists), geo.plat_r * 2)
    pad_l, pad_b, pad_t = 44, 26, 10
    plot_w = width - pad_l - 10
    plot_h = height - pad_b - pad_t

    def px(t: float) -> float:
        return pad_l + (t - t0) / max(t1 - t0, 1e-9) * plot_w

    def py(d: float) -> float:
        return pad_t + (1 - d / d_max) * plot_h

    line_pts = " ".join(
        f"{px(f[0]):.1f},{py(d):.1f}" for f, d in zip(ok, dists, strict=True)
    )
    # shade every sub-threshold span (ok frames below 46 px) — the lead
    # reads run lengths straight off the shading; the authoritative run
    # logic stays in app.metrics.events, nothing is recomputed here.
    shades: list[tuple[float, float, int]] = []
    run: list[tuple[float, float]] = []
    for f, d in zip(ok, dists, strict=True):
        if d <= geo.plat_r:
            run.append((f[0], d))
        elif run:
            shades.append((run[0][0], run[-1][0], len(run)))
            run = []
    if run:
        shades.append((run[0][0], run[-1][0], len(run)))
    shade_svg = "".join(
        f'<rect x="{px(a) - 1:.1f}" y="{pad_t}" width="{max(px(b) - px(a), 2):.1f}" '
        f'height="{plot_h}" fill="{_COLORS["platform"]}" opacity="0.12"/>'
        f'<text x="{px(a):.1f}" y="{pad_t + 12}" class="tick" fill="#fca5a5">'
        f"{n}帧</text>"
        for a, b, n in shades
    )
    threshold = (
        f'<line x1="{pad_l}" y1="{py(geo.plat_r):.1f}" x2="{width - 10}" '
        f'y2="{py(geo.plat_r):.1f}" stroke="{_COLORS["platform"]}" '
        f'stroke-dasharray="5 4" stroke-width="1"/>'
        f'<text x="{pad_l + 4}" y="{py(geo.plat_r) - 4:.1f}" class="tick" '
        f'fill="#fca5a5">46px 平台圈</text>'
    )
    marks = ""
    for name, t in markers.items():
        if t is None:
            continue
        marks += (
            f'<line x1="{px(t):.1f}" y1="{pad_t}" x2="{px(t):.1f}" '
            f'y2="{pad_t + plot_h}" stroke="{_COLORS["event"]}" opacity="0.5"/>'
            f'<text x="{px(t) + 3:.1f}" y="{pad_t + plot_h - 6}" class="tick" '
            f'fill="#fecaca">{html.escape(name)}</text>'
        )
    axis = (
        f'<line x1="{pad_l}" y1="{pad_t}" x2="{pad_l}" y2="{pad_t + plot_h}" '
        f'stroke="#475569"/>'
        f'<text x="4" y="{pad_t + 10}" class="tick">{d_max:.0f}px</text>'
        f'<text x="4" y="{pad_t + plot_h}" class="tick">0</text>'
        f'<text x="{pad_l}" y="{height - 8}" class="tick">{t0:.0f}s</text>'
        f'<text x="{width - 30}" y="{height - 8}" class="tick">{t1:.0f}s</text>'
    )
    return (
        f'<svg viewBox="0 0 {width} {height}" class="curve">'
        f'<rect width="{width}" height="{height}" fill="#0f172a"/>'
        f"{shade_svg}{threshold}{axis}"
        f'<polyline points="{line_pts}" fill="none" stroke="#93c5fd" '
        f'stroke-width="1.2"/>{marks}</svg>'
    )


def overlay_wide(geo: Geometry, frame_w: int, frame_h: int) -> str:
    """SVG overlay for wide media (video/still): the two circles."""
    scale = frame_w / 2560.0
    return (
        f'<svg viewBox="0 0 {frame_w} {frame_h}" class="overlay">'
        f'<circle cx="{geo.pool_cx * scale:.0f}" cy="{geo.pool_cy * scale:.0f}" '
        f'r="{geo.pool_r * scale:.0f}" fill="none" stroke="{_COLORS["pool"]}" '
        f'stroke-width="2"/>'
        f'<circle cx="{geo.plat_cx * scale:.0f}" cy="{geo.plat_cy * scale:.0f}" '
        f'r="{geo.plat_r * scale:.0f}" fill="none" stroke="{_COLORS["platform"]}" '
        f'stroke-width="1.5"/></svg>'
    )


def overlay_zoom(
    geo: Geometry,
    mask: list[tuple[int, int]] | None,
    center: tuple[float, float] | None,
    crop: tuple[int, int, int, int],
) -> str:
    """SVG overlay for the native-resolution platform crop (1 svg px = 1 img px)."""
    cw, ch, cx0, cy0 = crop
    dots = ""
    if mask:
        in_win = [
            (x, y) for x, y in mask if cx0 <= x < cx0 + cw and cy0 <= y < cy0 + ch
        ]
        dots = "".join(
            f'<rect x="{x - cx0}" y="{y - cy0}" width="1.6" height="1.6" '
            f'fill="{_COLORS["mask"]}" opacity="0.8"/>'
            for x, y in in_win
        )
        touch = [
            (x, y)
            for x, y in in_win
            if math.hypot(x - geo.plat_cx, y - geo.plat_cy) <= geo.plat_r
        ]
        dots += "".join(
            f'<rect x="{x - cx0 - 1}" y="{y - cy0 - 1}" width="3.6" height="3.6" '
            f'fill="{_COLORS["touch"]}"/>'
            for x, y in touch
        )
        dots = f"<g>{dots}</g>"
    center_svg = ""
    if center is not None:
        center_svg = (
            f'<circle cx="{center[0] - cx0:.1f}" cy="{center[1] - cy0:.1f}" r="3" '
            f'fill="none" stroke="{_COLORS["center"]}" stroke-width="1.5"/>'
            f'<line x1="{center[0] - cx0 - 6:.1f}" y1="{center[1] - cy0:.1f}" '
            f'x2="{center[0] - cx0 + 6:.1f}" y2="{center[1] - cy0:.1f}" '
            f'stroke="{_COLORS["center"]}" stroke-width="1"/>'
        )
    return (
        f'<svg viewBox="0 0 {cw} {ch}" class="overlay">'
        f'<circle cx="{geo.plat_cx - cx0:.1f}" cy="{geo.plat_cy - cy0:.1f}" '
        f'r="{geo.plat_r:.1f}" fill="none" stroke="{_COLORS["platform"]}" '
        f'stroke-width="1.5"/>{dots}{center_svg}</svg>'
    )


# --- event cards ----------------------------------------------------------------


def event_frame_index(time_s: float | None) -> int | None:
    if time_s is None:
        return None
    return round(time_s * FPS)


def render_trial(trial: Trial, videos_root: str, clips_dir: Path) -> str:
    geo = load_geometry(trial.video_id, trial.day)
    frames = load_frames(trial.video_id)
    video = local_path(trial.path, videos_root)
    events = trial.events
    duration = max((f.time_s for f in frames if f.time_s is not None), default=0.0)
    by_idx = {f.frame_idx: f for f in frames}
    wide_h = round(WIDE_W * 1440 / 2560)
    safe_id = trial.video_id.replace("/", "_")

    def t_of(idx: int | None) -> float:
        if idx is None:
            return 0.0
        row = by_idx.get(idx)
        return row.time_s if row is not None and row.time_s is not None else 0.0

    def center_of(idx: int | None) -> tuple[float, float] | None:
        if idx is None:
            return None
        row = by_idx.get(idx)
        if row is None or row.center_x is None or row.center_y is None:
            return None
        return row.center_x, row.center_y

    def mask_of(idx: int | None) -> list[tuple[int, int]] | None:
        if idx is None:
            return None
        rle = load_mask(trial.video_id, idx)
        if rle is None:
            return None
        counts, w, h = rle
        win = (
            int(geo.plat_cx - geo.plat_r - 30),
            int(geo.plat_cy - geo.plat_r - 30),
            int(geo.plat_cx + geo.plat_r + 30),
            int(geo.plat_cy + geo.plat_r + 30),
        )
        return mask_pixels(counts, w, h, window=win)

    crop = (
        ZOOM_HALF * 2,
        ZOOM_HALF * 2,
        int(geo.plat_cx) - ZOOM_HALF,
        int(geo.plat_cy) - ZOOM_HALF,
    )

    def clip_html(t_center: float, caption: str) -> str:
        out = clips_dir / f"{safe_id}-{int(t_center * 1000):06d}.mp4"
        if not out.exists() and not extract_clip(
            video, t_center - CLIP_BEFORE_S, t_center + CLIP_AFTER_S, str(out)
        ):
            return f"<p class='missing'>⚠ 视频段截取失败（{t_center:.2f}s）</p>"
        rel = f"clips/{out.name}"
        return (
            '<div class="clipbox">'
            f'<video src="{rel}" controls loop preload="metadata"></video>'
            f"{overlay_wide(geo, WIDE_W, wide_h)}"
            f'<span class="cap">{html.escape(caption)}</span>'
            '<div class="speed">'
            '<button type="button" data-rate="0.25">0.25×</button>'
            '<button type="button" data-rate="0.5">0.5×</button>'
            '<button type="button" data-rate="1" class="on">1×</button></div></div>'
        )

    def zoom_still(idx: int | None, tag: str, *, counter: bool = False) -> str:
        t = t_of(idx)
        out = clips_dir / f"{safe_id}-zoom-{tag}-{int(t * 1000):06d}.jpg"
        if not extract_still(video, t, str(out), crop=crop):
            return ""
        src = f"clips/{out.name}"
        cap = '<span class="cap">事件前对照</span>' if counter else ""
        cls = "zoombox small" if counter else "zoombox"
        return (
            f'<div class="{cls}"><img src="{src}" loading="lazy">'
            f"{overlay_zoom(geo, mask_of(idx), center_of(idx), crop)}{cap}</div>"
        )

    def verdict_radios(key: str) -> str:
        return "".join(
            f'<label><input type="radio" name="{safe_id}-{key}" '
            f'value="{v}">{v}</label> '
            for v in ("符合", "不符", "存疑")
        )

    def card(
        title: str,
        idx: int | None,
        key: str,
        note: str,
        clip_caption: str,
        counterfactual_idx: int | None = None,
    ) -> str:
        t = t_of(idx)
        parts = [
            f'<div class="card"><h4>{html.escape(title)} '
            f'<span class="t">{t:.2f}s · 帧{idx}</span></h4>'
            f'<p class="note">{html.escape(note)}</p>'
            f'<div class="frames">{clip_html(t, clip_caption)}'
            f"{zoom_still(idx, key)}"
        ]
        if counterfactual_idx is not None and counterfactual_idx >= 0:
            parts.append(zoom_still(counterfactual_idx, f"{key}-before", counter=True))
        parts.append(f'</div><div class="verdict">{verdict_radios(key)}</div></div>')
        return "".join(parts)

    cards: list[str] = []
    first_idx = event_frame_index(events[FIRST_DETECTION_S][0])
    entry_idx = event_frame_index(events[WATER_ENTRY_S][0])
    contact_idx = event_frame_index(events[PLATFORM_CONTACT_S][0])
    mount_idx = event_frame_index(events[MOUNT_S][0])

    cards.append(
        card(
            "① 首次出现",
            first_idx,
            "first",
            "判定=首个 ok 且中心非空帧。看放大图：该帧应有 mask 检出（橙点）；"
            "视频起点即检出时无「之前」可对照，属正常。",
            f"视频起点～{CLIP_AFTER_S:.0f}s（含入水过程）",
        )
    )
    if (
        entry_idx is not None
        and first_idx is not None
        and abs(entry_idx - first_idx) > 3
    ):
        cards.append(
            card(
                "② 首次入水",
                entry_idx,
                "entry",
                "判定=中心点首次进入池圆（蓝圈）。看视频段：动物入水时刻。",
                "入水前后",
            )
        )
    if contact_idx is not None:
        cards.append(
            card(
                "③ 碰台（mask 判定）",
                contact_idx,
                "contact",
                "判定=身体轮廓任一像素进入红圈（≤46px），擦过即算。放大图中绿色块="
                "圈内的 mask 像素；「事件前对照」（−0.33s）应无绿块。视频段建议 "
                "0.25×/0.5× 慢放看擦过瞬间。",
                f"事件前{CLIP_BEFORE_S:.0f}s～后{CLIP_AFTER_S:.0f}s",
                counterfactual_idx=contact_idx - 10,
            )
        )
    else:
        cards.append(
            '<div class="card"><h4>③ 碰台</h4><p class="note">no_contact：'
            "全程 mask 从未触及平台圈。看曲线：蓝线从未低于红虚线。</p>"
            f'<div class="verdict">{verdict_radios("contact")}</div></div>'
        )
    if mount_idx is not None:
        cards.append(
            card(
                f"④ 有效上台（合格段首帧，≥{MOUNT_MIN_FRAMES} 连续 ok 帧在圈内）",
                mount_idx,
                "mount",
                f"判定=中心（红十字）进入红圈且连续 {MOUNT_MIN_FRAMES} 个 ok 帧不再出圈"
                "（≥0.5s）。视频段慢放看是否真的爬上台并停住；放大图十字应在圈内；"
                f"曲线红区标「{MOUNT_MIN_FRAMES}帧」起即合格段。",
                f"上台前{CLIP_BEFORE_S:.0f}s～后{CLIP_AFTER_S:.0f}s（覆盖 0.5s 停留）",
                counterfactual_idx=mount_idx - 10,
            )
        )
    else:
        # closest approach = the frame a wrong rule would most likely fire on
        ok_dists = [
            (
                math.hypot(f.center_x - geo.plat_cx, f.center_y - geo.plat_cy),
                f.frame_idx,
            )
            for f in frames
            if f.status == "ok" and f.center_x is not None and f.center_y is not None
        ]
        closest_idx = min(ok_dists)[1] if ok_dists else None
        cards.append(
            '<div class="card"><h4>④ 有效上台</h4><p class="note">no_mount：'
            f"中心从未在红圈内连续停留 ≥{MOUNT_MIN_FRAMES} 个 ok 帧。看曲线：红区"
            "（如有）每段帧数应全部 <15。最接近时刻的放大图供交叉检查。</p>"
            f'<div class="frames">{clip_html(t_of(closest_idx), "最接近平台时刻")}'
            f"{zoom_still(closest_idx, 'closest')}</div>"
            f'<div class="verdict">{verdict_radios("mount")}</div></div>'
        )
        for frac in (1 / 3, 2 / 3):  # whole-trial spot checks, never on platform
            t = duration * frac
            cards.append(
                f'<div class="card"><h4>④b 全程抽查 '
                f'<span class="t">{t:.1f}s（{frac:.0%} 处）</span></h4>'
                f'<p class="note">no_mount 佐证：抽查段，动物不应在平台上停留。</p>'
                f'<div class="frames">{clip_html(t, f"{t:.0f}s 附近")}</div></div>'
            )

    latency, latency_status = events[ESCAPE_LATENCY_S]
    latency_text = (
        f"{latency:.2f}s" if latency is not None else f"NULL（{latency_status}）"
    )
    markers = {"碰台": events[PLATFORM_CONTACT_S][0], "上台": events[MOUNT_S][0]}
    return (
        f'<section class="trial">'
        f'<h3><span class="chip">{html.escape(trial.group)}/{html.escape(trial.mouse)}'
        f"</span> {html.escape(trial.day)} 区块{html.escape(trial.session)} 尾号"
        f"{html.escape(trial.trial_no)} · <code>{html.escape(trial.video_id)}</code>"
        f" · qc={html.escape(trial.qc)} · 潜伏期 <b>{latency_text}</b></h3>"
        f'<p class="path">{html.escape(trial.path)}</p>'
        f'<div class="panels"><div><h5>轨迹总览（蓝=池圈 红=平台圈）</h5>'
        f"{svg_trajectory(frames, geo)}</div>"
        f"<div><h5>中心-平台距离曲线（红虚线=46px 圈；红区=圈内 ok 帧段，标注帧数）</h5>"
        f"{svg_curve(frames, geo, markers)}</div></div>"
        f"{''.join(cards)}"
        f'<div class="trialnote"><textarea placeholder="本试次备注（可选）"></textarea></div>'
        f"</section>"
    )


# --- page assembly ----------------------------------------------------------------


_CSS = """
:root { color-scheme: dark; }
body { font-family: system-ui, 'PingFang SC', sans-serif; margin: 0 auto;
       max-width: 1080px; padding: 24px 16px 80px; background: #0b1220; color: #e2e8f0; }
h1 { font-size: 22px; } h3 { font-size: 17px; margin: 28px 0 8px; }
h4 { margin: 0 0 4px; font-size: 14px; } h5 { margin: 6px 0 4px; font-size: 12px; color: #94a3b8; }
.guide { background: #111c33; border: 1px solid #1e3a5f; border-radius: 10px;
         padding: 14px 18px; line-height: 1.75; font-size: 14px; }
.guide b { color: #7dd3fc; }
.trial { border-top: 2px solid #1e3a5f; padding-top: 6px; }
.chip { background: #1e3a5f; border-radius: 6px; padding: 1px 8px; font-size: 13px; }
.path { color: #64748b; font-size: 12px; margin: 2px 0 8px; }
.panels { display: flex; gap: 12px; flex-wrap: wrap; }
.panels > div { flex: 1 1 360px; }
.map, .curve { width: 100%; height: auto; border-radius: 8px; display: block; }
.tick { font-size: 11px; font-family: ui-monospace, monospace; }
.card { background: #111c33; border: 1px solid #1e3a5f; border-radius: 10px;
        padding: 10px 12px; margin: 10px 0; }
.card .t { color: #7dd3fc; font-weight: normal; font-size: 12px; }
.note { color: #94a3b8; font-size: 12.5px; margin: 2px 0 8px; }
.frames { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-start; }
.clipbox, .zoombox { position: relative; display: inline-block; }
.clipbox video, .zoombox img { display: block; border-radius: 6px; max-width: 100%; }
.clipbox video { width: 400px; }
.zoombox img { width: 320px; image-rendering: pixelated; }
.overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.cap { position: absolute; left: 6px; top: 4px; font-size: 11px; color: #fecaca;
       background: #000a; padding: 1px 6px; border-radius: 4px; }
.speed { position: absolute; right: 6px; bottom: 6px; display: flex; gap: 4px; }
.speed button { font-size: 11px; padding: 1px 7px; border-radius: 5px;
                border: 1px solid #334155; background: #0b1220cc; color: #cbd5e1;
                cursor: pointer; }
.speed button.on { background: #2563eb; color: white; border-color: #2563eb; }
.verdict { margin-top: 8px; font-size: 13px; }
.verdict label { margin-right: 14px; cursor: pointer; }
.missing { color: #f87171; }
.trialnote textarea { width: 100%; min-height: 44px; margin-top: 8px;
        background: #0b1220; color: #e2e8f0; border: 1px solid #1e3a5f;
        border-radius: 6px; padding: 6px; box-sizing: border-box; }
#collect { position: fixed; right: 18px; bottom: 18px; padding: 10px 16px;
           border-radius: 999px; border: 0; background: #2563eb; color: white;
           font-size: 14px; cursor: pointer; box-shadow: 0 4px 18px #0008; }
#out { width: 100%; min-height: 120px; background: #020617; color: #a5f3fc;
       border: 1px solid #1e3a5f; border-radius: 8px; padding: 8px;
       font-family: ui-monospace, monospace; font-size: 12px; }
"""

_JS = """
document.querySelectorAll('.clipbox .speed button').forEach(btn => {
  btn.addEventListener('click', () => {
    const box = btn.closest('.clipbox');
    const video = box && box.querySelector('video');
    if (!video) return;
    video.playbackRate = parseFloat(btn.dataset.rate);
    box.querySelectorAll('.speed button').forEach(
      b => b.classList.toggle('on', b === btn));
  });
});
document.getElementById('collect').addEventListener('click', () => {
  const lines = ['| # | 试次 | 事件判定 | 备注 |', '|---|---|---|---|'];
  let n = 0;
  document.querySelectorAll('section.trial').forEach(sec => {
    n += 1;
    const title = sec.querySelector('h3').innerText.replace(/\\s+/g, ' ').trim();
    const parts = [];
    sec.querySelectorAll('.card').forEach(card => {
      const h = card.querySelector('h4');
      const verdict = card.querySelector('.verdict input:checked');
      if (!h || !card.querySelector('.verdict')) return;
      parts.push(h.innerText.split('\\n')[0].trim() + '=' +
        (verdict ? verdict.value : '未判'));
    });
    const note = (sec.querySelector('textarea') || {value: ''}).value.trim();
    lines.push('| ' + n + ' | ' + title + ' | ' + parts.join('；') + ' | ' + note + ' |');
  });
  const out = document.getElementById('out');
  out.value = lines.join('\\n');
  out.select();
  out.scrollIntoView({behavior: 'smooth'});
});
"""


def main() -> int:
    out_path = Path(sys.argv[1] if len(sys.argv) > 1 else "sampling-review.html")
    clips_dir = out_path.parent / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)

    trials = load_trials()
    rng = random.Random(SEED)
    sample = _pick_stratified(rng, trials, want_mounted=True, count=MOUNTED_PICKS)
    sample += _pick_stratified(rng, trials, want_mounted=False, count=NO_MOUNT_PICKS)
    logger.info("rendering %d trials -> %s (+clips/)", len(sample), out_path)

    sections: list[str] = []
    for index, trial in enumerate(sample, start=1):
        logger.info("[%d/%d] %s", index, len(sample), trial.video_id)
        sections.append(render_trial(trial, VIDEOS_ROOT, clips_dir))

    guide = """
<div class="guide">
<p><b>这是什么：</b>工单 #6 / docs/10 AC2 事件定义抽样人工核验。每个事件卡 =
<b>事件前后 2–3 秒的视频段</b>（可播放/循环/调速，画面叠加蓝=池圈、红=平台判定区
46px）+ <b>平台区原生分辨率放大静帧</b>（橙点=该帧解码的 mask 轮廓，<b>绿块=落在
平台圈内的 mask 像素</b>，红十字=跟踪中心；「事件前对照」= 0.33s 前）+ 全程
<b>中心-平台距离曲线</b>（红虚线=46px；红区=圈内 ok 帧段并标注连续帧数）。逐卡选
「符合 / 不符 / 存疑」，最后点右下角按钮汇总成 markdown。</p>
<p><b>怎么看（建议顺序）：</b>① 先看曲线了解全程；② 碰台/上台卡用 <b>0.25× 或
0.5× 慢放</b>看事件瞬间——碰台=身体任何部分擦到红圈即算（放大图绿块出现）；
上台=身体上去并<b>停住 ≥0.5 秒</b>（曲线红区帧数 ≥15）；③ no_mount 试次：曲线红区
每段帧数应全部 &lt;15，两段全程抽查视频里动物不应在台上停留。</p>
<p><b>判「不符」的典型样貌：</b>绿块出现但视频里动物明显没碰到平台（→ mask 或
平台圈口径问题）；曲线红区 ≥15 帧但视频里动物没停住（→ 停留判定问题）；事件时刻
与视频明显错位（→ 时间轴/帧号问题）。</p>
<p><b>验证边界（诚实声明）：</b>本页验证「事件规则在轨迹数据上的正确执行」——
几何、阈值、连续性是否符合 docs/10 口径；不重新验证跟踪质量（mask/中心 vs 视频
真值的偏差，qc 状态已标注）。各卡标题带判定帧号与时间戳，可随时暂停视频对照。</p>
<p><b>判完后：</b>点「汇总核验结论」→ 复制 → 粘贴回
<code>docs/evidence/m1-t7/sampling-verification.md</code> 或工单 #6 评论。任何
「不符」：按 docs/10 约定先改口径文档，再改代码。</p>
<p><b>再生成：</b>本页与 clips/ 含真实视频数据，不入 git（.gitignore 已掩蔽）；
<code>uv run python -m scripts.metrics.render_sampling_review
../docs/evidence/m1-t7/sampling-review.html</code> 可确定性重建。</p>
</div>
"""
    page = (
        "<!DOCTYPE html><html lang='zh-CN'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width, initial-scale=1'>"
        "<title>事件定义抽样人工核验（M1-T7 / 工单 #6）</title>"
        f"<style>{_CSS}</style></head><body>"
        "<h1>事件定义抽样人工核验（docs/10 AC2，工单 #6）</h1>"
        "<p>口径：首次出现/首次入水=中心点规则；碰台=<b>mask 参与判定</b>"
        "（2026-10-13 用户裁决）；有效上台=中心在平台圈内连续 ≥15 个连续 ok 帧"
        f"（≥0.5s）；潜伏期=有效上台−首次出现。样本 N=10（7 上台 + 3 no_mount，"
        f"seed={SEED}，与 sampling-verification.md 同源）。</p>"
        f"{guide}{''.join(sections)}"
        "<button id='collect'>汇总核验结论（markdown）</button>"
        "<textarea id='out' placeholder='点按钮后在此生成/复制'></textarea>"
        f"<script>{_JS}</script></body></html>"
    )
    out_path.write_text(page, encoding="utf-8")
    n_clips = len(list(clips_dir.glob("*")))
    size_mb = sum(f.stat().st_size for f in clips_dir.glob("*")) / 1e6
    logger.info(
        "wrote %s (%.1f MB) + %d clip files (%.1f MB)",
        out_path,
        out_path.stat().st_size / 1e6,
        n_clips,
        size_mb,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
