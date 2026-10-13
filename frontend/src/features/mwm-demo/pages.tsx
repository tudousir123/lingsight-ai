import type { ColumnDef } from "@tanstack/react-table";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  FileText,
  FolderPlus,
  Search,
  ChevronLeft,
  ChevronRight,
  Settings2,
  Play,
  Pause,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import {
  DataTable,
  type DataTableFeatures,
} from "@/components/Common/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  counts,
  experiment,
  learning,
  speed,
  videos,
  type VideoRow,
  type VideoStatus,
} from "./data";
import {
  ChartKey,
  DemoAction,
  FrameControls,
  InlineLink,
  PageHeading,
  PageLink,
  PoolFrame,
  PreviewNotice,
  SummaryCards,
  TrialLabel,
} from "./shared";
import { LocalSampleResultsPage } from "./local-results";
import demoWaterMaze from "./assets/demo-water-maze.png";

const unavailable = (action: string) =>
  toast.info(`${action}将在接入真实任务接口后开放。`);
const columns: ColumnDef<DataTableFeatures, VideoRow>[] = [
  {
    accessorKey: "id",
    header: "视频",
    cell: ({ row }) => (
      <div className="flex items-center gap-3">
        <img
          src={demoWaterMaze}
          alt=""
          className="h-10 w-14 rounded object-cover"
        />
        <div>
          <div className="font-medium text-slate-900">{row.original.id}</div>
          <div className="text-xs text-muted-foreground">
            1920 × 1080 · 01:00
          </div>
        </div>
      </div>
    ),
  },
  { accessorKey: "group", header: "实验组" },
  { accessorKey: "mouse", header: "鼠号" },
  {
    id: "day",
    header: "训练日 / 试次",
    cell: ({ row }) => `第 ${row.original.day} 天 · 试次 ${row.original.trial}`,
  },
  {
    accessorKey: "status",
    header: "状态",
    cell: ({ row }) => (
      <Badge
        variant="secondary"
        className={
          row.original.status === "待确认"
            ? "bg-amber-50 text-amber-700"
            : row.original.status === "已完成"
              ? "bg-emerald-50 text-emerald-700"
              : "bg-blue-50 text-blue-700"
        }
      >
        {row.original.status}
        {row.original.status === "分析中" && " 68%"}
      </Badge>
    ),
  },
  {
    id: "actions",
    header: "操作",
    cell: ({ row }) => (
      <InlineLink
        to={row.original.status === "待确认" ? "/prepare" : "/results"}
      >
        {row.original.status === "待确认"
          ? "确认并分析"
          : row.original.status === "分析中"
            ? "查看示例结果"
            : "查看结果"}
      </InlineLink>
    ),
  },
];

export function ExperimentPage() {
  const hasLocalSample =
    import.meta.env.DEV && import.meta.env.VITE_HEALTHAD_SAMPLE === "true";
  return hasLocalSample ? <LocalSampleExperimentPage /> : <ExampleExperimentPage />;
}

function LocalSampleExperimentPage() {
  return (
    <div className="space-y-4">
      <PageHeading
        section="实验管理"
        title="水迷宫视频"
        subtitle="003_HealthAD · 0809 实验"
        showSampleBadge={false}
      />
      <Card className="gap-3 rounded-lg py-5">
        <CardHeader>
          <CardTitle>视频列表</CardTitle>
          <CardDescription>本地样片及其同名逐帧追踪结果</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-4 rounded-lg border p-3">
            <img src="/local-preview/003-healthad-poster.jpg?v=overlay" alt="0809 第一象限水迷宫视频预览" className="h-20 w-36 rounded object-cover" />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-slate-900">0809第一象限-A2-2-4.mp4</div>
              <div className="mt-1 text-sm text-muted-foreground">2560 × 1440 · 8.13 秒 · 244 帧</div>
            </div>
            <Badge variant="secondary">待人工检查</Badge>
            <PageLink to="/prepare">进入人工检查 <ArrowRight /></PageLink>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ExampleExperimentPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"全部" | VideoStatus>("全部");
  const [group, setGroup] = useState("全部");
  const filtered = videos.filter(
    (v) =>
      (status === "全部" || v.status === status) &&
      (group === "全部" || v.group === group) &&
      `${v.id} ${v.mouse}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="space-y-4">
      <PageHeading
        section="实验管理"
        title={experiment}
        subtitle="实验编号 MWM-2026-01 · 2 个实验组 · 12 只动物"
        actions={
          <>
            <DemoAction onClick={() => unavailable("实验设置")}>
              <Settings2 />
              实验设置
            </DemoAction>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              onClick={() => unavailable("视频导入")}
            >
              <FolderPlus />
              导入视频
            </Button>
          </>
        }
      />
      <PreviewNotice />
      <SummaryCards
        items={[
          {
            label: "视频总数",
            value: String(counts.total),
            detail: "覆盖 5 个训练日",
          },
          {
            label: "待确认",
            value: String(counts.review),
            detail: "请核验自动识别结果",
          },
          {
            label: "已完成",
            value: String(counts.complete),
            detail: "可查看结果与统计",
          },
        ]}
      />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-100 bg-blue-50 px-5 py-3">
        <div>
          <strong className="text-blue-700">6 个视频等待确认</strong>
          <p className="text-xs text-slate-500">
            检查场景与起始帧，确认后即可开始分析
          </p>
        </div>
        <InlineLink to="/prepare">去确认</InlineLink>
      </div>
      <Card className="gap-4 rounded-lg py-5">
        <CardHeader className="pb-0">
          <CardTitle>实验视频</CardTitle>
          <CardDescription>
            示例列表展示 6 条，完整实验设定为 120 个试次视频
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap gap-3">
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                aria-label="搜索视频名称或鼠号"
                placeholder="搜索视频名称或鼠号"
                className="pl-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as typeof status)}
            >
              <SelectTrigger className="w-35">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["全部", "待确认", "分析中", "已完成"].map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={group} onValueChange={setGroup}>
              <SelectTrigger className="w-35">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["全部", "对照组", "实验组"].map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {filtered.length ? (
            <DataTable columns={columns} data={filtered} />
          ) : (
            <div className="py-12 text-center text-sm text-muted-foreground">
              没有符合条件的示例视频，请调整筛选条件。
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type PreviewPoint = [number, number];
type PreviewGeometry = {
  shapes: { label: string; points: PreviewPoint[] }[];
  platform?: { cx: number; cy: number; radius: number };
};
type PreviewSpeed = {
  fps: number;
  unit: "px/s";
  points: { time: number; speed: number | null }[];
};

export function PreparationPage() {
  const navigate = useNavigate();
  const sampleVideo = useRef<HTMLVideoElement>(null);
  const [samplePlaying, setSamplePlaying] = useState(false);
  const [sampleTime, setSampleTime] = useState(0);
  const [sampleDuration, setSampleDuration] = useState(8.13);
  const [geometry, setGeometry] = useState<PreviewGeometry | null>(null);
  const [sampleSpeed, setSampleSpeed] = useState<PreviewSpeed | null>(null);
  const hasLocalSample =
    import.meta.env.DEV && import.meta.env.VITE_HEALTHAD_SAMPLE === "true";
  const [view, setView] = useState(hasLocalSample ? "raw" : "scene");
  const [frame, setFrame] = useState(72);
  const [boundary, setBoundary] = useState(true);
  const [marks, setMarks] = useState(true);
  const [platform, setPlatform] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [reviewed, setReviewed] = useState({
    boundary: false,
    marks: false,
    platform: false,
    tracking: false,
  });
  const reviewedCount = Object.values(reviewed).filter(Boolean).length;
  const reviewPassed = reviewedCount === 4;
  useEffect(() => {
    if (!hasLocalSample) return;
    const controller = new AbortController();
    void fetch("/local-preview/003-healthad-geometry.json", { signal: controller.signal })
      .then((response) => response.json())
      .then((loadedGeometry: PreviewGeometry) => setGeometry(loadedGeometry))
      .catch(() => {});
    void fetch("/local-preview/003-healthad-speed.json", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("速度数据不可用");
        return response.json();
      })
      .then((loadedSpeed: PreviewSpeed) => setSampleSpeed(loadedSpeed))
      .catch(() => {});
    return () => controller.abort();
  }, [hasLocalSample]);
  const currentSpeed = sampleSpeed?.points[
    Math.min(Math.round(sampleTime * sampleSpeed.fps), sampleSpeed.points.length - 1)
  ]?.speed;
  return (
    <div className={hasLocalSample ? "space-y-3" : "space-y-4"}>
      {hasLocalSample ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-xl font-semibold text-slate-900">分析准备</h1>
            <span className="text-sm text-slate-500">0809第一象限-A2-2-4.mp4</span>
          </div>
          <PageLink to="/" outline>
            <ArrowLeft />
            返回视频列表
          </PageLink>
        </div>
      ) : <PageHeading
        section="实验管理 / 分析准备"
        title="分析准备"
        subtitle={<TrialLabel />}
        actions={
          <PageLink to="/" outline>
            <ArrowLeft />
            返回视频列表
          </PageLink>
        }
      />}
      {!hasLocalSample && <PreviewNotice />}
      <div className="flex flex-wrap justify-around gap-3 rounded-lg border bg-white px-5 py-2 text-sm">
        <span className="text-emerald-600">✓ 导入视频</span>
        <span className="font-semibold text-blue-600">● 分析准备</span>
        <span className="text-muted-foreground">○ 视频分析</span>
        <span className="text-muted-foreground">○ 查看结果</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.8fr)_minmax(310px,1fr)]">
        <Card className={hasLocalSample ? "gap-2 rounded-lg py-3" : "gap-3 rounded-lg py-5"}>
          <CardHeader>
            <CardTitle>{hasLocalSample ? "场景识别与运动追踪" : "场景与起始帧"}</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs value={view} onValueChange={setView}>
              {!hasLocalSample && <TabsList>
                <TabsTrigger value="scene">场景校验</TabsTrigger>
                <TabsTrigger value="frame">起始帧</TabsTrigger>
              </TabsList>}
              {hasLocalSample && (
                <TabsContent value="raw">
                  <div className="mb-3 flex flex-wrap gap-5 text-sm">
                    <label className="flex items-center gap-2"><Checkbox checked={boundary} onCheckedChange={(value) => setBoundary(value === true)} />水池边界</label>
                    <label className="flex items-center gap-2"><Checkbox checked={marks} onCheckedChange={(value) => setMarks(value === true)} />标志物</label>
                    <label className="flex items-center gap-2"><Checkbox checked={platform} onCheckedChange={(value) => setPlatform(value === true)} />基准平台</label>
                  </div>
                  <div className="overflow-hidden rounded-md bg-slate-950">
                    <div className="relative aspect-video">
                    <video
                      ref={sampleVideo}
                      aria-label="水迷宫场景识别与小鼠追踪视频"
                      playsInline
                      preload="metadata"
                      poster="/local-preview/003-healthad-poster.jpg?v=overlay"
                      onLoadedMetadata={(event) => setSampleDuration(event.currentTarget.duration)}
                      onPlay={() => setSamplePlaying(true)}
                      onPause={() => setSamplePlaying(false)}
                      onTimeUpdate={(event) =>
                        setSampleTime(event.currentTarget.currentTime)
                      }
                      className="absolute inset-0 h-full w-full object-contain"
                    >
                      <source
                        src="/local-preview/003-healthad-sample.webm?v=overlay"
                        type="video/webm"
                      />
                      <source
                        src="/local-preview/003-healthad-sample.mp4?v=overlay"
                        type="video/mp4"
                      />
                    </video>
                    <svg viewBox="0 0 2560 1440" className="pointer-events-none absolute inset-0 h-full w-full" aria-label="水池、标志物与基准平台标注叠加层">
                      {geometry?.shapes.filter((shape) => shape.label === "place" ? boundary : marks).map((shape) => (
                        <polygon
                          key={shape.label}
                          points={shape.points.map((point) => point.join(",")).join(" ")}
                          fill={shape.label === "place" ? "#06b6d40c" : "#ec48991c"}
                          stroke={shape.label === "place" ? "#06d6e8" : "#ec4899"}
                          strokeWidth={shape.label === "place" ? 8 : 10}
                          strokeLinejoin="round"
                        />
                      ))}
                      {platform && geometry?.platform && (
                        <g fill="none" stroke="#facc15" strokeWidth="8">
                          <circle cx={geometry.platform.cx} cy={geometry.platform.cy} r={geometry.platform.radius} />
                          <path d={`M ${geometry.platform.cx - 14} ${geometry.platform.cy} h 28 M ${geometry.platform.cx} ${geometry.platform.cy - 14} v 28`} strokeWidth="5" />
                        </g>
                      )}
                    </svg>
                    </div>
                    <div className="flex items-center gap-3 px-3 py-2 text-white">
                      <button
                        type="button"
                        aria-label={samplePlaying ? "暂停样片" : "播放样片"}
                        onClick={() => {
                          const video = sampleVideo.current;
                          if (!video) return;
                          if (video.paused) void video.play();
                          else video.pause();
                        }}
                      >
                        {samplePlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
                      </button>
                      <input
                        type="range"
                        aria-label="样片进度"
                        min={0}
                        max={sampleDuration}
                        step={0.1}
                        value={sampleTime}
                        onChange={(event) => {
                          if (sampleVideo.current) {
                            sampleVideo.current.currentTime = Number(event.target.value);
                          }
                        }}
                        className="min-w-0 flex-1 accent-blue-500"
                      />
                      <span className="text-xs tabular-nums">{sampleTime.toFixed(1)} / {sampleDuration.toFixed(1)} 秒</span>
                    </div>
                  </div>
                </TabsContent>
              )}
              <TabsContent value="scene">
                <PoolFrame
                  boundary={boundary}
                  marks={marks}
                  platform={platform}
                />
              </TabsContent>
              <TabsContent value="frame">
                <PoolFrame
                  boundary={boundary}
                  marks={marks}
                  platform={platform}
                />
              </TabsContent>
            </Tabs>
            {hasLocalSample && (
              <section className="mt-2 rounded-lg border px-4 py-2" aria-label="随时间变化的运动速度">
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <h3 className="font-semibold">运动速度</h3>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    当前 {currentSpeed == null ? "—" : currentSpeed.toFixed(1)} px/s
                  </span>
                </div>
                {sampleSpeed ? (
                  <div className="h-24 w-full" role="img" aria-label="小鼠运动速度随时间变化的曲线，单位像素每秒">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={sampleSpeed.points} margin={{ top: 6, right: 10, bottom: 0, left: -12 }}>
                        <CartesianGrid stroke="#e7ecf2" strokeDasharray="3 3" />
                        <XAxis dataKey="time" type="number" domain={[0, sampleDuration]} tickCount={5} tickFormatter={(value: number) => `${value.toFixed(0)}s`} fontSize={11} />
                        <YAxis width={48} tickCount={4} fontSize={11} />
                        <Tooltip formatter={(value) => [`${Number(value).toFixed(1)} px/s`, "运动速度"]} labelFormatter={(value) => `${Number(value).toFixed(1)} 秒`} />
                        <ReferenceLine x={sampleTime} stroke="#2563eb" strokeDasharray="4 3" />
                        <Line type="monotone" dataKey="speed" name="运动速度" stroke="#2563eb" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="flex h-24 items-center justify-center text-sm text-muted-foreground">速度数据暂不可用</p>
                )}
              </section>
            )}
            {view !== "raw" && <FrameControls frame={frame} setFrame={setFrame} />}
            {view !== "raw" && <div className="mt-4 flex flex-wrap gap-5 text-sm">
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={boundary}
                  onCheckedChange={(v) => setBoundary(v === true)}
                />
                水池边界
              </label>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={marks}
                  onCheckedChange={(v) => setMarks(v === true)}
                />
                标志物
              </label>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={platform}
                  onCheckedChange={(v) => setPlatform(v === true)}
                />
                基准平台
              </label>
            </div>}
            {view !== "raw" && <div className="mt-5 flex items-center justify-center gap-4">
              <Button
                variant="outline"
                size="icon"
                aria-label="前一帧"
                onClick={() => setFrame(Math.max(0, frame - 1))}
              >
                <ChevronLeft />
              </Button>
              <div className="rounded-md border border-blue-400 px-5 py-2 text-sm">
                首次入水候选 · 第 {frame} 帧
              </div>
              <Button
                variant="outline"
                size="icon"
                aria-label="后一帧"
                onClick={() => setFrame(Math.min(1800, frame + 1))}
              >
                <ChevronRight />
              </Button>
            </div>}
          </CardContent>
        </Card>
        <Card className={hasLocalSample ? "gap-0 rounded-lg py-3" : "gap-0 rounded-lg py-5"}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2">
              {hasLocalSample ? "人工检查门" : "分析前确认"}
              {hasLocalSample && <Badge variant={reviewPassed ? "default" : "secondary"}>
                {reviewPassed ? "人工已确认" : `待核对 ${reviewedCount}/4`}
              </Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className={hasLocalSample ? "space-y-3" : "space-y-5"}>
            <section className={hasLocalSample ? "border-b pb-3" : "border-b pb-4"}>
              <h3 className="font-semibold">
                ① 自动识别结果{" "}
                <Badge className="ml-2 bg-emerald-50 text-emerald-700">
                  已识别
                </Badge>
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                水池边界 · 已识别
                <br />
                标志物 · 4 个
              </p>
              {hasLocalSample && <div className="mt-2 grid gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <Checkbox checked={reviewed.boundary} onCheckedChange={(value) => setReviewed((current) => ({ ...current, boundary: value === true }))} />
                  水池边界位置正确
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox checked={reviewed.marks} onCheckedChange={(value) => setReviewed((current) => ({ ...current, marks: value === true }))} />
                  4 个标志物位置正确
                </label>
              </div>}
              {!hasLocalSample && <p className="mt-2 text-xs text-blue-600">
                使用画面下方的图层开关核验结果
              </p>}
            </section>
            <section className={hasLocalSample ? "border-b pb-3" : "border-b pb-4"}>
              <h3 className="font-semibold">
                ② 基准平台{" "}
                <Badge variant="secondary" className="ml-2">
                  {hasLocalSample ? "实验标定" : "参考图标定"}
                </Badge>
              </h3>
              <p className="mt-2 text-sm">{hasLocalSample ? "0809 平台位置 · 已标注" : "来源：本实验参考图"}</p>
              {hasLocalSample && <label className="mt-2 flex items-center gap-2 text-sm">
                <Checkbox checked={reviewed.platform} onCheckedChange={(value) => setReviewed((current) => ({ ...current, platform: value === true }))} />
                基准平台位置正确
              </label>}
              {!hasLocalSample && <p className="mt-2 text-xs text-muted-foreground">
                请核对平台位置与当前实验一致；平台不是从隐藏平台视频中检测得到。
              </p>}
            </section>
            <section className={hasLocalSample ? "border-b pb-3" : "border-b pb-4"}>
              <h3 className="font-semibold">
                {hasLocalSample ? "③ 小鼠追踪" : "③ 起始帧"}{" "}
                <Badge variant="secondary" className="ml-2">
                  {hasLocalSample ? "已识别" : "自动检测候选"}
                </Badge>
              </h3>
              <p className="mt-2 text-sm">{hasLocalSample ? "头尾关键点 · 连续运动轨迹" : `首次入水候选 · 第 ${frame} 帧`}</p>
              {hasLocalSample && <label className="mt-2 flex items-center gap-2 text-sm">
                <Checkbox checked={reviewed.tracking} onCheckedChange={(value) => setReviewed((current) => ({ ...current, tracking: value === true }))} />
                小鼠轨迹与视频一致
              </label>}
              {!hasLocalSample && <Button
                variant="link"
                className="px-0 text-blue-600"
                onClick={() => setFrame(72)}
              >
                定位到候选帧
              </Button>}
            </section>
            {!hasLocalSample && <details className="rounded-md border px-3 py-2 text-sm">
              <summary className="cursor-pointer">精细参数</summary>
              <p className="pt-3 text-xs text-muted-foreground">
                帧率 30 fps · 基准平台来源：实验参考图
              </p>
            </details>}
            {!hasLocalSample && <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={confirmed}
                onCheckedChange={(v) => setConfirmed(v === true)}
              />
              我已核对场景与起始帧
            </label>}
            <Button
              disabled={hasLocalSample ? !reviewPassed : !confirmed}
              className="w-full bg-blue-600 hover:bg-blue-700"
              onClick={() => {
                if (!hasLocalSample) toast.info("示例确认完成；未提交真实推理任务。");
                navigate({ to: "/results" });
              }}
            >
              {hasLocalSample ? "通过人工检查并查看结果" : "确认并查看示例结果"} <ArrowRight />
            </Button>
            {!hasLocalSample && <p className="text-xs text-muted-foreground">
              真实的几何编辑、保存和分析任务需后端接口支持。
            </p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const events = [
  { label: "首次出现", time: "00:02.10", frame: 63 },
  { label: "首次入水", time: "00:02.40", frame: 72 },
  { label: "有效上台", time: "00:34.70", frame: 1041 },
];
export function ResultsPage() {
  const hasLocalSample =
    import.meta.env.DEV && import.meta.env.VITE_HEALTHAD_SAMPLE === "true";
  return hasLocalSample ? <LocalSampleResultsPage /> : <ExampleResultsPage />;
}

function ExampleResultsPage() {
  const [frame, setFrame] = useState(540);
  const [trail, setTrail] = useState(true);
  const [platform, setPlatform] = useState(true);
  return (
    <div className="space-y-4">
      <PageHeading
        section="实验管理 / 分析结果"
        title="单次分析结果"
        subtitle={<TrialLabel completed />}
        actions={
          <>
            <DemoAction onClick={() => unavailable("数据下载")}>
              <Download />
              下载数据
            </DemoAction>
            <DemoAction onClick={() => unavailable("报告导出")}>
              <FileText />
              导出报告
            </DemoAction>
          </>
        }
      />
      <PreviewNotice />
      <Tabs defaultValue="video">
        <TabsList>
          <TabsTrigger value="video">视频与轨迹</TabsTrigger>
          <TabsTrigger value="metrics">行为指标</TabsTrigger>
        </TabsList>
        <TabsContent value="video" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(310px,1fr)]">
            <Card className="gap-3 rounded-lg py-4">
              <CardContent>
                <div className="relative">
                  <PoolFrame trajectory={trail} platform={platform} />
                  <div className="absolute left-3 top-3 flex flex-col gap-2 rounded-md bg-white/95 p-2 text-xs">
                    <label className="flex items-center gap-2">
                      <Checkbox
                        checked={trail}
                        onCheckedChange={(v) => setTrail(v === true)}
                      />
                      轨迹
                    </label>
                    <label className="flex items-center gap-2">
                      <Checkbox
                        checked={platform}
                        onCheckedChange={(v) => setPlatform(v === true)}
                      />
                      平台位置
                    </label>
                  </div>
                </div>
                <FrameControls frame={frame} setFrame={setFrame} />
                <h3 className="mb-2 mt-4 font-semibold">关键事件</h3>
                <div className="grid gap-2 sm:grid-cols-3">
                  {events.map((e) => (
                    <button
                      type="button"
                      key={e.label}
                      onClick={() => setFrame(e.frame)}
                      className="rounded-md border px-3 py-2 text-left hover:bg-blue-50"
                    >
                      <span className="block text-xs text-muted-foreground">
                        {e.label}
                      </span>
                      <strong className="text-sm">{e.time}</strong>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card className="gap-3 rounded-lg py-4">
              <CardHeader>
                <CardTitle>本试次指标</CardTitle>
              </CardHeader>
              <CardContent>
                {[
                  ["逃逸潜伏期", "32.6 s"],
                  ["路径长度", "845.2 cm"],
                  ["平均速度", "25.9 cm/s"],
                  ["有效帧占比", "98.4 %"],
                  ["目标象限停留占比", "26.3 %"],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    className="flex justify-between gap-3 border-b py-2 text-sm"
                  >
                    <span className="text-muted-foreground">{k}</span>
                    <strong>{v}</strong>
                  </div>
                ))}
                <p className="mt-3 text-xs text-muted-foreground">
                  潜伏期：首次出现 → 有效上台
                </p>
                <details className="mt-4 rounded-md border p-3 text-sm">
                  <summary className="cursor-pointer">计算口径与校准</summary>
                  <p className="mt-2 text-xs text-muted-foreground">
                    示例空间校准：水池直径 120 cm；统计范围：本试次。
                  </p>
                </details>
                <div className="mt-4 rounded-md bg-slate-50 p-3 text-sm">
                  <strong>结果复核 · 待复核</strong>
                  <p className="mt-1 text-xs text-muted-foreground">
                    可回看关键事件；真实事件修正功能待接入。
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="rounded-lg py-4">
              <CardHeader>
                <CardTitle className="text-base">轨迹分布</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="relative mx-auto aspect-square max-w-45 rounded-full border-2 border-slate-300 bg-slate-50">
                  <svg viewBox="0 0 180 180" className="h-full w-full">
                    <path
                      d="M39 132C52 117 58 138 70 105S88 102 94 74 111 80 124 50 133 42 139 34"
                      stroke="#2b86ed"
                      strokeWidth="2"
                      fill="none"
                    />
                    <circle
                      cx="139"
                      cy="34"
                      r="11"
                      stroke="#e6ae22"
                      strokeDasharray="3"
                      fill="none"
                    />
                  </svg>
                </div>
              </CardContent>
            </Card>
            <Card className="rounded-lg py-4">
              <CardHeader>
                <CardTitle className="text-base">空间热图</CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className="mx-auto aspect-square max-w-45 rounded-full border-2 border-slate-300"
                  style={{
                    background:
                      "radial-gradient(circle at 65% 30%, #f25b39 0%, #f6df5b 12%, #40d2c5 27%, transparent 50%),radial-gradient(circle at 30% 70%,#fbbc54 0%,#2eb9e0 22%,#225ac8 60%)",
                  }}
                />
              </CardContent>
            </Card>
            <Card className="rounded-lg py-4">
              <CardHeader>
                <CardTitle className="text-base">速度变化</CardTitle>
              </CardHeader>
              <CardContent className="h-45">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={speed}>
                    <CartesianGrid stroke="#e7ecf2" strokeDasharray="3 3" />
                    <XAxis dataKey="time" fontSize={10} />
                    <YAxis fontSize={10} />
                    <Tooltip />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="#16a6ab"
                      fill="#c9f0ee"
                      name="速度 (cm/s)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="metrics">
          <Card className="py-8">
            <CardHeader>
              <CardTitle>行为指标</CardTitle>
              <CardDescription>
                指标概览见“视频与轨迹”右侧。完整指标页将在接入真实分析结果后展开。
              </CardDescription>
            </CardHeader>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

const controlDots = [13, 15, 17, 19, 21, 23].map((value, i) => ({
  x: 1 + (i % 2) * 0.08,
  y: value,
}));
const treatmentDots = [24, 26, 28, 32, 34, 36].map((value, i) => ({
  x: 2 + (i % 2) * 0.08,
  y: value,
}));
export function ReportsPage() {
  const [metric, setMetric] = useState("逃逸潜伏期");
  return (
    <div className="space-y-4">
      <PageHeading
        section="统计与报告"
        title="实验统计与报告"
        subtitle={`${experiment} · MWM-2026-01`}
        actions={
          <>
            <DemoAction onClick={() => unavailable("统计数据导出")}>
              <Download />
              导出数据
            </DemoAction>
            <DemoAction onClick={() => unavailable("报告导出")}>
              <FileText />
              导出报告
            </DemoAction>
          </>
        }
      />
      <PreviewNotice />
      <Card className="rounded-lg py-4">
        <CardContent className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            实验阶段
            <Select defaultValue="训练期">
              <SelectTrigger className="w-34">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="训练期">训练期</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            指标
            <Select value={metric} onValueChange={setMetric}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="逃逸潜伏期">逃逸潜伏期</SelectItem>
                <SelectItem value="路径长度">路径长度</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            训练日
            <Select defaultValue="全部">
              <SelectTrigger className="w-34">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="全部">第 1–5 天</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </CardContent>
      </Card>
      {metric !== "逃逸潜伏期" ? (
        <Card className="py-10 text-center">
          <CardTitle>暂无该指标的示例图表</CardTitle>
          <CardDescription>选择“逃逸潜伏期”查看已准备的示例。</CardDescription>
        </Card>
      ) : (
        <>
          <div className="rounded-md border border-blue-100 bg-blue-50 px-4 py-2 text-xs text-blue-800">
            统计单位：动物 · 先汇总同一动物当天试次，再计算组均值 ·
            示例图暂不绘制 SEM · 已排除待复核试次
          </div>
          <SummaryCards
            items={[
              { label: "纳入动物", value: "12", detail: "每组 6 只" },
              { label: "纳入试次", value: "112", detail: "已完成试次" },
              { label: "训练日", value: "5", detail: "第 1–5 天" },
            ]}
          />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
            <Card className="gap-2 rounded-lg py-5">
              <CardHeader className="flex flex-row items-start justify-between">
                <div>
                  <CardTitle>学习曲线</CardTitle>
                  <CardDescription className="mt-1">
                    逃逸潜伏期（均值；示例图不绘制 SEM）
                  </CardDescription>
                </div>
                <ChartKey />
              </CardHeader>
              <CardContent className="h-70">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={learning}>
                    <CartesianGrid stroke="#e6ebf2" strokeDasharray="3 3" />
                    <XAxis dataKey="day" fontSize={11} />
                    <YAxis unit="s" domain={[0, 60]} fontSize={11} />
                    <Tooltip />
                    <Line
                      type="linear"
                      dataKey="control"
                      stroke="#1d68eb"
                      strokeWidth={3}
                      name="对照组"
                    />
                    <Line
                      type="linear"
                      dataKey="treatment"
                      stroke="#0e9ba0"
                      strokeWidth={3}
                      name="实验组"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="gap-2 rounded-lg py-5">
              <CardHeader>
                <CardTitle>第 5 天组间比较</CardTitle>
                <CardDescription>
                  每个点代表一只动物 · 描述性统计
                </CardDescription>
              </CardHeader>
              <CardContent className="h-70">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart>
                    <CartesianGrid stroke="#e6ebf2" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      domain={[0.5, 2.5]}
                      ticks={[1, 2]}
                      tickFormatter={(v) => (v === 1 ? "对照组" : "实验组")}
                      fontSize={11}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      domain={[0, 60]}
                      unit="s"
                      fontSize={11}
                    />
                    <Tooltip formatter={(v) => `${v} s`} />
                    <Scatter name="对照组" data={controlDots} fill="#2563eb" />
                    <Scatter
                      name="实验组"
                      data={treatmentDots}
                      fill="#0e9ba0"
                    />
                  </ScatterChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
          <Card className="gap-2 rounded-lg py-5">
            <CardHeader>
              <CardTitle>统计明细</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-125 text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-muted-foreground">
                      <th className="p-2 text-left">实验组</th>
                      <th>动物数</th>
                      {learning.map((d) => (
                        <th key={d.day}>{d.day}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(["control", "treatment"] as const).map((key) => (
                      <tr key={key} className="border-t text-center">
                        <td className="p-2 text-left">
                          {key === "control" ? "对照组" : "实验组"}
                        </td>
                        <td>6</td>
                        {learning.map((d) => (
                          <td key={d.day}>{d[key].toFixed(1)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                单位：秒（s）；表中为逐鼠汇总后的组均值。示例数据不用于科研结论。
              </p>
            </CardContent>
          </Card>
          <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-white px-4 py-3 text-sm">
            <strong>报告内容</strong>
            {["实验信息", "统计口径", "图表", "明细数据"].map((x) => (
              <label key={x} className="flex items-center gap-1">
                <Checkbox defaultChecked />
                {x}
              </label>
            ))}
            <Button
              variant="link"
              className="ml-auto text-blue-600"
              onClick={() => unavailable("报告预览")}
            >
              预览报告 <ArrowRight />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
