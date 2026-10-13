import { ArrowLeft, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { PageLink } from "./shared";

type Point = [number, number];
type Track = {
  video: string;
  width: number;
  height: number;
  fps: number;
  summary: {
    processed: number;
    valid: number;
    kp_frames: number;
    path_length_px: number;
  };
  frames: {
    frame: number;
    valid: boolean;
    center: Point | null;
    head: Point | null;
    tail: Point | null;
  }[];
};
type Geometry = {
  shapes: { label: string; points: Point[] }[];
  platform?: { cx: number; cy: number; radius: number };
};
type Speed = {
  fps: number;
  points: { time: number; speed: number | null }[];
};

export function LocalSampleResultsPage() {
  const video = useRef<HTMLVideoElement>(null);
  const [track, setTrack] = useState<Track | null>(null);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [speed, setSpeed] = useState<Speed | null>(null);
  const [error, setError] = useState(false);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showTrail, setShowTrail] = useState(true);
  const [showPool, setShowPool] = useState(true);
  const [showPlatform, setShowPlatform] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch("/local-preview/003-healthad-track.json", { signal: controller.signal }),
      fetch("/local-preview/003-healthad-geometry.json", { signal: controller.signal }),
      fetch("/local-preview/003-healthad-speed.json", { signal: controller.signal }),
    ])
      .then(async ([trackResponse, geometryResponse, speedResponse]) => {
        if (!trackResponse.ok || !geometryResponse.ok || !speedResponse.ok) {
          throw new Error("同名追踪数据不可用");
        }
        const [loadedTrack, loadedGeometry, loadedSpeed] = await Promise.all([
          trackResponse.json() as Promise<Track>,
          geometryResponse.json() as Promise<Geometry>,
          speedResponse.json() as Promise<Speed>,
        ]);
        if (loadedTrack.video !== "0809第一象限-A2-2-4.mp4" || loadedTrack.frames.length !== loadedTrack.summary.processed) {
          throw new Error("视频与追踪数据不匹配");
        }
        setTrack(loadedTrack);
        setGeometry(loadedGeometry);
        setSpeed(loadedSpeed);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, []);

  const duration = track ? track.frames.length / track.fps : 8.13;
  const frame = track ? Math.min(Math.floor(time * track.fps), track.frames.length - 1) : 0;
  const current = track?.frames[frame];
  const trail = track?.frames.slice(0, frame + 1).flatMap((item) => item.center ? [item.center] : []) ?? [];
  const fullTrail = track?.frames.flatMap((item) => item.center ? [item.center] : []) ?? [];
  const platformEntry = track && geometry?.platform
    ? track.frames.find((item) => item.center && Math.hypot(item.center[0] - geometry.platform!.cx, item.center[1] - geometry.platform!.cy) <= geometry.platform!.radius)
    : undefined;
  const currentSpeed = speed?.points[Math.min(frame, speed.points.length - 1)]?.speed;

  const seek = (nextTime: number) => {
    if (video.current) video.current.currentTime = nextTime;
    setTime(nextTime);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold text-slate-900">单次分析结果</h1>
          <span className="text-sm text-slate-500">0809第一象限-A2-2-4.mp4</span>
        </div>
        <PageLink to="/prepare" outline><ArrowLeft />返回人工检查</PageLink>
      </div>
      <div className="flex flex-wrap justify-around gap-3 rounded-lg border bg-white px-5 py-2 text-sm">
        <span className="text-emerald-600">✓ 导入视频</span>
        <span className="text-emerald-600">✓ 人工检查</span>
        <span className="text-emerald-600">✓ 视频分析</span>
        <span className="font-semibold text-blue-600">● 查看结果</span>
      </div>
      {error ? (
        <Card><CardContent className="text-sm text-red-600">这条视频的追踪数据加载失败，请检查本地样片文件。</CardContent></Card>
      ) : !track || !geometry || !speed ? (
        <Card><CardContent className="text-sm text-muted-foreground">正在读取对应视频的追踪结果…</CardContent></Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.8fr)_minmax(310px,1fr)]">
            <Card className="gap-2 rounded-lg py-3">
              <CardHeader><CardTitle>视频与逐帧追踪</CardTitle></CardHeader>
              <CardContent>
                <div className="mb-2 flex flex-wrap gap-5 text-sm">
                  <label className="flex items-center gap-2"><Checkbox checked={showTrail} onCheckedChange={(value) => setShowTrail(value === true)} />累计轨迹</label>
                  <label className="flex items-center gap-2"><Checkbox checked={showPool} onCheckedChange={(value) => setShowPool(value === true)} />水池边界</label>
                  <label className="flex items-center gap-2"><Checkbox checked={showPlatform} onCheckedChange={(value) => setShowPlatform(value === true)} />基准平台</label>
                </div>
                <div className="overflow-hidden rounded-md bg-slate-950">
                  <div className="relative aspect-video">
                    <video
                      ref={video}
                      aria-label="0809第一象限-A2-2-4 追踪叠加视频"
                      playsInline
                      preload="metadata"
                      poster="/local-preview/003-healthad-poster.jpg?v=overlay"
                      onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
                      onPlay={() => setPlaying(true)}
                      onPause={() => setPlaying(false)}
                      className="absolute inset-0 h-full w-full object-contain"
                    >
                      <source src="/local-preview/003-healthad-sample.webm?v=overlay" type="video/webm" />
                      <source src="/local-preview/003-healthad-sample.mp4?v=overlay" type="video/mp4" />
                    </video>
                    <svg viewBox={`0 0 ${track.width} ${track.height}`} className="pointer-events-none absolute inset-0 h-full w-full" aria-label="与视频同步的真实追踪轨迹">
                      {showPool && geometry.shapes.filter((shape) => shape.label === "place").map((shape) => (
                        <polygon key={shape.label} points={shape.points.map((point) => point.join(",")).join(" ")} fill="none" stroke="#06d6e8" strokeWidth="8" />
                      ))}
                      {showPlatform && geometry.platform && <circle cx={geometry.platform.cx} cy={geometry.platform.cy} r={geometry.platform.radius} fill="none" stroke="#facc15" strokeWidth="8" />}
                      {showTrail && trail.length > 1 && <polyline points={trail.map((point) => point.join(",")).join(" ")} fill="none" stroke="#60a5fa" strokeWidth="7" strokeLinejoin="round" strokeLinecap="round" />}
                      {current?.center && <circle cx={current.center[0]} cy={current.center[1]} r="13" fill="#2563eb" stroke="white" strokeWidth="4" />}
                    </svg>
                  </div>
                  <div className="flex items-center gap-3 px-3 py-2 text-white">
                    <button type="button" aria-label={playing ? "暂停结果视频" : "播放结果视频"} onClick={() => {
                      if (!video.current) return;
                      if (video.current.paused) void video.current.play();
                      else video.current.pause();
                    }}>{playing ? <Pause className="size-4" /> : <Play className="size-4" />}</button>
                    <input type="range" aria-label="结果视频进度" min={0} max={duration} step={1 / track.fps} value={time} onChange={(event) => seek(Number(event.target.value))} className="min-w-0 flex-1 accent-blue-500" />
                    <span className="text-xs tabular-nums">{time.toFixed(1)} / {duration.toFixed(1)} 秒</span>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="gap-2 rounded-lg py-3">
              <CardHeader><CardTitle className="flex items-center justify-between">本视频追踪结果 <Badge variant="secondary">244 帧</Badge></CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {[
                  ["有效追踪帧", `${track.summary.valid} / ${track.summary.processed}`],
                  ["头尾关键点帧", `${track.summary.kp_frames} / ${track.summary.processed}`],
                  ["路径长度", `${track.summary.path_length_px.toFixed(1)} px`],
                  ["平均位移速度", `${(track.summary.path_length_px / duration).toFixed(1)} px/s`],
                  ["当前帧", `${frame} / ${track.frames.length - 1}`],
                  ["当前位置", current?.center ? `${current.center[0].toFixed(0)}, ${current.center[1].toFixed(0)} px` : "未检出"],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3 border-b pb-2"><span className="text-muted-foreground">{label}</span><strong className="tabular-nums">{value}</strong></div>
                ))}
                {platformEntry && <Button variant="outline" className="w-full justify-between" onClick={() => seek(platformEntry.frame / track.fps)}>
                  <span>首次进入平台区域候选</span><span>{(platformEntry.frame / track.fps).toFixed(2)} 秒 · 第 {platformEntry.frame} 帧</span>
                </Button>}
                <p className="text-xs text-muted-foreground">平台进入仅按小鼠中心与标定圆的重合计算，尚未判定有效上台；缺少空间校准，不显示厘米指标。</p>
              </CardContent>
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.8fr)]">
            <Card className="gap-2 rounded-lg py-3">
              <CardHeader><CardTitle>完整运动轨迹</CardTitle></CardHeader>
              <CardContent>
                <svg viewBox={`0 0 ${track.width} ${track.height}`} className="h-[88px] w-full rounded-md bg-slate-950 [@media(min-height:900px)]:h-48" aria-label="本视频 244 帧的完整小鼠中心轨迹">
                  {geometry.shapes.filter((shape) => shape.label === "place").map((shape) => <polygon key={shape.label} points={shape.points.map((point) => point.join(",")).join(" ")} fill="none" stroke="#06d6e8" strokeWidth="14" />)}
                  {geometry.platform && <circle cx={geometry.platform.cx} cy={geometry.platform.cy} r={geometry.platform.radius} fill="none" stroke="#facc15" strokeWidth="14" />}
                  <polyline points={fullTrail.map((point) => point.join(",")).join(" ")} fill="none" stroke="#60a5fa" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
                  {current?.center && <circle cx={current.center[0]} cy={current.center[1]} r="19" fill="#2563eb" stroke="white" strokeWidth="7" />}
                </svg>
              </CardContent>
            </Card>
            <Card className="gap-2 rounded-lg py-3">
              <CardHeader><CardTitle className="flex items-center justify-between">运动速度 <span className="text-sm font-normal text-muted-foreground">当前 {currentSpeed == null ? "—" : currentSpeed.toFixed(1)} px/s</span></CardTitle></CardHeader>
              <CardContent className="h-[88px] [@media(min-height:900px)]:h-48" role="img" aria-label="本视频逐帧中心点计算的运动速度曲线">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={speed.points} margin={{ top: 6, right: 10, bottom: 0, left: -12 }}>
                    <CartesianGrid stroke="#e7ecf2" strokeDasharray="3 3" />
                    <XAxis dataKey="time" type="number" domain={[0, duration]} tickCount={5} tickFormatter={(value: number) => `${value.toFixed(0)}s`} fontSize={11} />
                    <YAxis width={48} tickCount={4} fontSize={11} />
                    <Tooltip formatter={(value) => [`${Number(value).toFixed(1)} px/s`, "运动速度"]} labelFormatter={(value) => `${Number(value).toFixed(1)} 秒`} />
                    <ReferenceLine x={time} stroke="#2563eb" strokeDasharray="4 3" />
                    <Line type="monotone" dataKey="speed" stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
