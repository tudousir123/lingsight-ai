import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { AxiosError } from "axios"
import { AlertTriangle, Crosshair } from "lucide-react"
import { useState } from "react"
import { ExperimentsService, type MetricValue } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { mediaKindLabel, mediaSrc } from "./media"
import { LayerToggles, type SceneLayers, SceneOverlay } from "./scene"
import { SpeedChart } from "./speed-chart"
import { useFrameSync } from "./sync"

const metricNames: Record<string, string> = {
  dist_px: "轨迹长度",
  speed_px: "平均速度",
  valid_kp_ratio: "有效关键点帧占比",
  in_pool_ratio: "在池内时间占比",
  first_detection_s: "首次检测时间",
  water_entry_s: "入水时间",
  platform_contact_s: "首次平台接触",
  mount_s: "上台时间",
  escape_latency_s: "逃逸潜伏期",
  dist_cm: "轨迹长度（cm）",
  speed_cm_s: "平均速度（cm/s）",
}

const calcStatusNames: Record<string, string> = {
  ok: "正常",
  no_contact: "未发生平台接触",
  no_mount: "未完成上台",
}

function metricName(metric: string) {
  return metricNames[metric] ?? metric
}

function formatMetricValue(row: MetricValue): string {
  if (row.value === null || row.value === undefined) {
    return "—"
  }
  if (row.unit === "ratio") {
    return `${(row.value * 100).toFixed(1)}%`
  }
  const digits = Math.abs(row.value) >= 100 ? 1 : 2
  return `${row.value.toFixed(digits)}${row.unit ? ` ${row.unit}` : ""}`
}

function calcStatusLabel(status: string) {
  return calcStatusNames[status] ?? status
}

function phaseLabel(phase: string) {
  if (phase === "training_day") return "训练期"
  if (phase === "probe_platform_present") return "探测期（有台）"
  return phase
}

function StateRow({
  name,
  tone,
  value,
  hint,
}: {
  name: string
  tone: "ok" | "warn" | "muted"
  value: string
  hint?: string
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b pb-1.5 text-sm last:border-b-0">
      <span className="w-24 shrink-0 text-slate-500">{name}</span>
      <Badge
        variant={tone === "muted" ? "outline" : "secondary"}
        className={
          tone === "ok"
            ? "text-emerald-700"
            : tone === "warn"
              ? "text-amber-700"
              : "text-muted-foreground"
        }
      >
        {value}
      </Badge>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}

export function TrialResultPage({
  experimentId,
  trialId,
}: {
  experimentId: string
  trialId: string
}) {
  const result = useQuery({
    queryKey: ["trial-result", experimentId, trialId],
    queryFn: async () =>
      (
        await ExperimentsService.getResult({
          path: { experiment_id: experimentId, trial_id: trialId },
        })
      ).data,
    retry: false,
  })

  const data = result.data
  const trackStatus = data?.track.status
  const frameCount = data?.track.frames?.length ?? 0
  const fps = data?.track.fps ?? 30
  const { videoRef, frame, setFrame } = useFrameSync(fps, frameCount)
  const [layers, setLayers] = useState<SceneLayers>({
    pool: true,
    markers: true,
    platform: true,
    tracking: true,
  })

  if (result.isPending) {
    return (
      <Card>
        <CardContent>正在加载离线结果…</CardContent>
      </Card>
    )
  }
  if (result.isError || !data) {
    const status =
      result.error instanceof AxiosError
        ? result.error.response?.status
        : undefined
    return (
      <Card>
        <CardContent className="space-y-3">
          <p>
            {status === 403
              ? "无权访问此实验"
              : status === 404
                ? "试次不存在或不属于此实验"
                : "离线结果加载失败"}
          </p>
          <Button variant="outline" onClick={() => void result.refetch()}>
            重试
          </Button>
        </CardContent>
      </Card>
    )
  }

  const src = mediaSrc(data.video)
  const review = data.states.preparation_review
  const reviewState = review?.state
  const metrics = data.metrics ?? []
  const unavailable = data.metric_unavailable ?? []
  const candidate = data.platform_entry_candidate ?? null

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <Link
              to="/experiments/$experimentId/trials/$trialId"
              params={{ experimentId, trialId }}
              className="text-sm text-blue-600 hover:underline"
            >
              ← 返回分析准备
            </Link>
            <Link to="/qa" className="text-sm text-blue-600 hover:underline">
              去科研问答 →
            </Link>
          </div>
          <h1 className="mt-0.5 text-xl font-semibold text-slate-900">
            单次分析结果 · {data.trial.video_name}
          </h1>
          <p className="text-sm text-slate-500">
            {data.trial.group_name} · 鼠 {data.trial.mouse_id} ·{" "}
            {phaseLabel(data.trial.phase)} · {data.trial.session_label} · 试次{" "}
            {data.trial.trial_no}
          </p>
        </div>
      </div>

      {reviewState !== "confirmed" && (
        <div className="flex shrink-0 items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle className="size-4 shrink-0" />
          该试次
          {reviewState === "draft"
            ? "人工核对仅保存了草稿"
            : "尚未开始人工准备核对"}
          ，以下结果在确认前仅供参考。
        </div>
      )}

      <div className="grid min-h-0 flex-1 items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-h-0 flex-col gap-4">
          <Card className="flex min-h-0 flex-1 flex-col gap-2 py-4">
            <CardHeader className="shrink-0 flex-row flex-wrap items-center justify-between gap-3">
              <CardTitle>
                {mediaKindLabel(data.video.kind)}
                {data.video.kind === "overlay" && "（叠加推理结果，优先展示）"}
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                {candidate && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFrame(candidate.frame)}
                  >
                    <Crosshair className="size-4" />
                    定位平台圈进入 · t={candidate.time_s.toFixed(2)}s
                  </Button>
                )}
                <LayerToggles layers={layers} onChange={setLayers} />
              </div>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col gap-2">
              {src ? (
                <div className="relative min-h-0 flex-1 overflow-hidden rounded-md bg-slate-900">
                  {/* behavior footage: no audio track, so there is nothing to caption */}
                  {/* biome-ignore lint/a11y/useMediaCaption: silent water-maze footage */}
                  <video
                    ref={videoRef}
                    src={src}
                    controls
                    playsInline
                    preload="metadata"
                    className="block h-full w-full object-contain"
                  />
                  <SceneOverlay
                    geometry={data.geometry}
                    track={data.track}
                    frame={frame}
                    layers={layers}
                    showTrail
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <AlertTriangle className="size-4 shrink-0" />
                  {data.video.reason ?? "该试次没有可播放的视频文件"}
                </div>
              )}
              {trackStatus === "available" && frameCount > 0 && (
                <div className="shrink-0 space-y-1">
                  <p className="text-xs text-slate-500">
                    第 {frame} 帧 · t = {(frame / fps).toFixed(2)} s · 有效帧{" "}
                    {data.track.valid_frames}/{frameCount} · miss{" "}
                    {
                      (data.track.frames ?? []).filter(
                        (f) => f.status === "miss",
                      ).length
                    }{" "}
                    帧 · coord{" "}
                    {
                      (data.track.frames ?? []).filter(
                        (f) => f.status === "coord",
                      ).length
                    }{" "}
                    帧
                  </p>
                  <input
                    aria-label="视频帧位置"
                    type="range"
                    min={0}
                    max={frameCount - 1}
                    value={frame}
                    onChange={(event) => setFrame(Number(event.target.value))}
                    className="w-full accent-blue-600"
                  />
                  <SpeedChart
                    track={data.track}
                    frame={frame}
                    height={140}
                    onSeekTime={(t) => setFrame(Math.round(t * fps))}
                    candidateTimeS={candidate?.time_s ?? null}
                  />
                  {candidate && (
                    <p className="text-xs text-muted-foreground">
                      {candidate.note}
                    </p>
                  )}
                </div>
              )}
              {trackStatus !== "available" && (
                <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <AlertTriangle className="size-4 shrink-0" />
                  {data.track.reason ?? "该试次尚无离线追踪结果"}
                </div>
              )}
            </CardContent>
          </Card>

          {trackStatus === "available" && frameCount > 0 && (
            <Card className="h-52 shrink-0 gap-2 overflow-hidden py-4">
              <CardHeader className="shrink-0">
                <CardTitle>完整轨迹俯视（按有效帧分段，不跨空隙）</CardTitle>
              </CardHeader>
              <CardContent className="min-h-0 flex-1">
                <div className="relative h-full overflow-hidden rounded-md bg-slate-200">
                  <SceneOverlay
                    geometry={data.geometry}
                    track={data.track}
                    frame={frameCount - 1}
                    layers={layers}
                    showTrail
                  />
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="flex min-h-0 flex-col gap-4">
          <Card className="shrink-0 gap-3 py-4">
            <CardHeader>
              <CardTitle>结果状态（三态区分，不互相覆盖）</CardTitle>
            </CardHeader>
            <CardContent>
              <StateRow
                name="离线推理"
                tone={data.states.inference_available ? "ok" : "warn"}
                value={
                  data.states.inference_available
                    ? `已接入${data.states.artifact_mode ? `（${data.states.artifact_mode}）` : ""}`
                    : "尚无结果"
                }
              />
              <StateRow
                name="推理质检"
                tone="muted"
                value={data.states.qc_status ?? "未标记"}
                hint="模型侧标记，不代表人工通过"
              />
              <StateRow
                name="人工准备核对"
                tone={reviewState === "confirmed" ? "ok" : "warn"}
                value={
                  reviewState === "confirmed"
                    ? "已确认"
                    : reviewState === "draft"
                      ? "草稿"
                      : "未开始"
                }
                hint={
                  review?.confirmed_at
                    ? `${review.reviewer_email} · ${new Date(review.confirmed_at).toLocaleString()}`
                    : undefined
                }
              />
              <StateRow
                name="结果质量复核"
                tone="muted"
                value="未开始"
                hint="与人工准备核对是不同环节"
              />
            </CardContent>
          </Card>

          <Card className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden py-4">
            <CardHeader className="shrink-0">
              <CardTitle>可信指标</CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto">
              <dl className="space-y-1.5 text-sm">
                {metrics.map((row) => (
                  <div
                    key={`${row.metric}-${row.algo_version}`}
                    className="border-b pb-1.5 last:border-b-0"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-slate-700">
                        {metricName(row.metric)}
                      </dt>
                      <dd
                        className={`font-medium tabular-nums ${
                          row.calc_status === "ok"
                            ? "text-slate-900"
                            : "text-amber-700"
                        }`}
                      >
                        {formatMetricValue(row)}
                      </dd>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                      <span>{calcStatusLabel(row.calc_status)}</span>
                      <span>· {row.algo_version}</span>
                      {row.ok_frames !== null &&
                        row.ok_frames !== undefined &&
                        row.total_frames !== null &&
                        row.total_frames !== undefined && (
                          <span>
                            · {row.ok_frames}/{row.total_frames} 帧
                          </span>
                        )}
                      {row.duration_s !== null &&
                        row.duration_s !== undefined && (
                          <span>· 时长 {row.duration_s.toFixed(2)}s</span>
                        )}
                    </div>
                  </div>
                ))}
              </dl>
              {unavailable.length > 0 && (
                <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {unavailable.map((row) => (
                    <p key={row.metric}>
                      {metricName(row.metric)}不可用：{row.reason}
                    </p>
                  ))}
                </div>
              )}
              {metrics.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  该试次没有已计算的指标。
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
