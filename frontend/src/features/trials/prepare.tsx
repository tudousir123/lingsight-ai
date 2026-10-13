import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { AxiosError } from "axios"
import { AlertTriangle, CheckCircle2 } from "lucide-react"
import { useEffect, useState } from "react"
import { ExperimentsService, type PreparationPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import useCustomToast from "@/hooks/useCustomToast"
import { mediaKindLabel, mediaSrc } from "./media"
import { LayerToggles, type SceneLayers, SceneOverlay } from "./scene"
import { SpeedChart } from "./speed-chart"
import { useFrameSync } from "./sync"

type CheckKeys = "boundary_ok" | "markers_ok" | "platform_ok" | "tracking_ok"

const checkItems: { key: CheckKeys; label: string; hint: string }[] = [
  {
    key: "boundary_ok",
    label: "试次边界",
    hint: "试次起止画面正确，水池边界几何与画面对齐",
  },
  {
    key: "markers_ok",
    label: "朝向标志物",
    hint: "场景标注与画面中的四个标志物位置一致",
  },
  {
    key: "platform_ok",
    label: "基准平台",
    hint: "元数据平台圈（E1 共识坐标）落在画面中预期区域",
  },
  {
    key: "tracking_ok",
    label: "追踪质量",
    hint: "中心点与头尾关键点跟得住动物，miss/coord 帧合理",
  },
]

function phaseLabel(phase: string) {
  if (phase === "training_day") return "训练期"
  if (phase === "probe_platform_present") return "探测期（有台）"
  return phase
}

type MaterialRow = {
  name: string
  ok: boolean
  source?: string | null
  reason?: string | null
}

function materialRows(prep: PreparationPublic): MaterialRow[] {
  return [
    {
      name: "试次视频",
      ok: prep.video.status === "available",
      source: prep.video.fingerprint ?? null,
      reason: prep.video.reason ?? null,
    },
    {
      name: "水池边界几何",
      ok: prep.geometry.pool.status === "available",
      source: prep.geometry.pool.source ?? null,
      reason: prep.geometry.pool.reason ?? null,
    },
    {
      name: "标志物标注",
      ok: prep.geometry.markers.status === "available",
      source: prep.geometry.markers.source ?? null,
      reason: prep.geometry.markers.reason ?? null,
    },
    {
      name: "基准平台标定",
      ok: prep.geometry.platform.status === "available",
      source: prep.geometry.platform.source ?? null,
      reason: prep.geometry.platform.reason ?? null,
    },
    {
      name: "离线追踪结果",
      ok: prep.tracking.status === "available",
      source: prep.tracking.source ?? null,
      reason: prep.tracking.reason ?? null,
    },
  ]
}

export function TrialPreparePage({
  experimentId,
  trialId,
}: {
  experimentId: string
  trialId: string
}) {
  const toast = useCustomToast()
  const queryClient = useQueryClient()
  const [checks, setChecks] = useState<Record<CheckKeys, boolean>>({
    boundary_ok: false,
    markers_ok: false,
    platform_ok: false,
    tracking_ok: false,
  })
  const [layers, setLayers] = useState<SceneLayers>({
    pool: true,
    markers: true,
    platform: true,
    tracking: true,
  })

  const prep = useQuery({
    queryKey: ["trial-preparation", experimentId, trialId],
    queryFn: async () =>
      (
        await ExperimentsService.getPreparation({
          path: { experiment_id: experimentId, trial_id: trialId },
        })
      ).data,
    retry: false,
  })

  const data = prep.data
  const review = data?.review ?? null
  const confirmed = review?.state === "confirmed"

  // Draft recovery: sync the checkboxes with the persisted review whenever a
  // (re)fetch brings a different persisted version — refresh keeps unsaved
  // edits only until the query actually returns newer server state.
  useEffect(() => {
    if (!review) {
      return
    }
    setChecks({
      boundary_ok: review.boundary_ok,
      markers_ok: review.markers_ok,
      platform_ok: review.platform_ok,
      tracking_ok: review.tracking_ok,
    })
  }, [review])

  const trackStatus = data?.tracking.status
  const frameCount = data?.tracking.frames?.length ?? 0
  const fps = data?.tracking.fps ?? 30
  const { videoRef, frame, setFrame } = useFrameSync(fps, frameCount)

  const saveMutation = useMutation({
    mutationFn: (state: "draft" | "confirmed") =>
      ExperimentsService.putReview({
        path: { experiment_id: experimentId, trial_id: trialId },
        body: { ...checks, source_version: data?.source_version ?? "", state },
      }),
    onSuccess: (_, state) => {
      toast.showSuccessToast(
        state === "confirmed" ? "人工核对已最终确认" : "草稿已保存",
      )
      void queryClient.invalidateQueries({
        queryKey: ["trial-preparation", experimentId, trialId],
      })
    },
    onError: (error) => {
      const status =
        error instanceof AxiosError ? error.response?.status : undefined
      const detail = errorDetail(error)
      if (status === 409) {
        toast.showErrorToast("素材已更新，请按新素材重新核对后再保存")
        void queryClient.invalidateQueries({
          queryKey: ["trial-preparation", experimentId, trialId],
        })
        return
      }
      toast.showErrorToast(detail ?? "保存失败，请重试")
    },
  })

  if (prep.isPending) {
    return (
      <Card>
        <CardContent>正在加载分析准备素材…</CardContent>
      </Card>
    )
  }
  if (prep.isError || !data) {
    const status =
      prep.error instanceof AxiosError ? prep.error.response?.status : undefined
    return (
      <Card>
        <CardContent className="space-y-3">
          <p>
            {status === 403
              ? "无权访问此实验"
              : status === 404
                ? "试次不存在或不属于此实验"
                : "分析准备素材加载失败"}
          </p>
          <Button variant="outline" onClick={() => void prep.refetch()}>
            重试
          </Button>
        </CardContent>
      </Card>
    )
  }

  const src = mediaSrc(data.video)
  const missing = materialRows(data).filter((row) => !row.ok)
  const allChecked = checkItems.every((item) => checks[item.key])

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/" className="text-sm text-blue-600 hover:underline">
            ← 返回试次列表
          </Link>
          <h1 className="mt-0.5 text-xl font-semibold text-slate-900">
            分析准备 · {data.trial.video_name}
          </h1>
          <p className="text-sm text-slate-500">
            {data.trial.group_name} · 鼠 {data.trial.mouse_id} ·{" "}
            {phaseLabel(data.trial.phase)} · {data.trial.session_label} · 试次{" "}
            {data.trial.trial_no}
          </p>
        </div>
        {confirmed && (
          <Button asChild className="bg-blue-600 hover:bg-blue-700">
            <Link
              to="/experiments/$experimentId/trials/$trialId/result"
              params={{ experimentId, trialId }}
            >
              查看离线结果 →
            </Link>
          </Button>
        )}
      </div>

      <div className="grid min-h-0 flex-1 items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="flex min-h-0 flex-col gap-2 py-4">
          <CardHeader className="shrink-0 flex-row items-center justify-between gap-3">
            <CardTitle>
              {mediaKindLabel(data.video.kind)}
              {data.video.kind === "overlay" && "（优先）"}
            </CardTitle>
            <LayerToggles layers={layers} onChange={setLayers} />
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
                  track={data.tracking}
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
                  第 {frame} 帧 · t = {(frame / fps).toFixed(2)} s ·{" "}
                  {data.tracking.valid_frames}/{frameCount} 有效帧 · miss{" "}
                  {
                    (data.tracking.frames ?? []).filter(
                      (f) => f.status === "miss",
                    ).length
                  }{" "}
                  帧 · coord{" "}
                  {
                    (data.tracking.frames ?? []).filter(
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
                  track={data.tracking}
                  frame={frame}
                  height={140}
                  onSeekTime={(t) => setFrame(Math.round(t * fps))}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex min-h-0 flex-col gap-4">
          <Card className="shrink-0 gap-3 py-4">
            <CardHeader>
              <CardTitle>人工核对（四项）</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {confirmed ? (
                <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
                  <p className="flex items-center gap-2 font-medium">
                    <CheckCircle2 className="size-4" />
                    已最终确认
                  </p>
                  <p>复核人：{review?.reviewer_email}</p>
                  <p>
                    确认时间：
                    {review?.confirmed_at
                      ? new Date(review.confirmed_at).toLocaleString()
                      : "—"}
                  </p>
                  <p className="text-xs text-emerald-800">
                    绑定素材版本 {review?.source_version}
                  </p>
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    {checkItems.map((item) => (
                      <Label
                        key={item.key}
                        className="flex items-start gap-3 font-normal"
                      >
                        <Checkbox
                          className="mt-0.5"
                          checked={checks[item.key]}
                          aria-label={`确认${item.label}`}
                          onCheckedChange={(checked) =>
                            setChecks((prev) => ({
                              ...prev,
                              [item.key]: checked === true,
                            }))
                          }
                        />
                        <span>
                          <span className="block font-medium text-slate-800">
                            {item.label}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {item.hint}
                          </span>
                        </span>
                      </Label>
                    ))}
                  </div>
                  {missing.length > 0 && (
                    <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                      缺失素材：{missing.map((row) => row.name).join("、")}
                      。最终确认需要素材齐备，草稿仍可保存。
                    </p>
                  )}
                  <div className="flex flex-col gap-2">
                    <Button
                      variant="outline"
                      disabled={saveMutation.isPending}
                      onClick={() => saveMutation.mutate("draft")}
                    >
                      {saveMutation.isPending ? "保存中…" : "保存草稿"}
                    </Button>
                    <Button
                      className="bg-blue-600 hover:bg-blue-700"
                      disabled={saveMutation.isPending || !allChecked}
                      onClick={() => saveMutation.mutate("confirmed")}
                    >
                      最终确认
                    </Button>
                    {!allChecked && (
                      <p className="text-xs text-muted-foreground">
                        最终确认需要四项全部通过。
                      </p>
                    )}
                  </div>
                  {review && (
                    <p className="text-xs text-muted-foreground">
                      已有 {review.state === "draft" ? "草稿" : "记录"} ·
                      上次保存 {new Date(review.updated_at).toLocaleString()} ·
                      复核人 {review.reviewer_email}
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden py-4">
            <CardHeader className="shrink-0">
              <CardTitle>素材状态与来源</CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto">
              <dl className="space-y-1.5 text-sm">
                {materialRows(data).map((row) => (
                  <div
                    key={row.name}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b pb-2 last:border-b-0"
                  >
                    <dt className="w-24 shrink-0 text-slate-500">{row.name}</dt>
                    <dd className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3">
                      <Badge variant={row.ok ? "secondary" : "outline"}>
                        {row.ok ? "可用" : "缺失"}
                      </Badge>
                      {row.source && (
                        <span className="text-xs text-muted-foreground">
                          来源：{row.source}
                        </span>
                      )}
                      {!row.ok && row.reason && (
                        <span className="text-xs text-amber-700">
                          {row.reason}
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function errorDetail(error: unknown): string | undefined {
  if (error instanceof AxiosError) {
    const detail = error.response?.data?.detail
    if (typeof detail === "string") {
      return detail
    }
    if (Array.isArray(detail)) {
      const first = detail[0] as { msg?: string } | undefined
      return first?.msg
    }
  }
  return undefined
}
