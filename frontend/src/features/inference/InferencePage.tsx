import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { z } from "zod"
import { PageHeader } from "@/components/Common/PageHeader"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  projectErrorText,
  useAddProjectMember,
  usePublishResult,
  useWorkspaceProjects,
} from "@/features/agent/projects"
import { inferenceArtifactUrl } from "@/features/inference/artifacts"
import type { Entry, Mark, Task } from "@/features/inference/contract"
import { authHeaders } from "@/lib/credentials"
import { inferenceGatewayBase, inferenceRoutes } from "@/lib/upstreamRoutes.gen"

const labels: Record<string, string> = {
  queued: "排队中",
  running: "运行中",
  waiting_for_review: "等待预标注确认",
  succeeded: "推理完成",
  failed: "失败",
  interrupted: "执行中断",
  cancelled: "已取消",
}
const stageLabels: Record<string, string> = {
  preannotation: "预标注",
  tracking: "小鼠追踪",
  keypoints: "v9 头尾定位",
  overlay: "生成叠加视频",
}

const tasksKey = ["inference", "tasks"] as const
const videosKey = (directory: string, sourceId?: string) =>
  ["inference", "videos", directory, sourceId ?? null] as const

type NumericDraft = Record<string, string>
const toDraft = (values: Record<string, number>): NumericDraft =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)]))

// 清空输入框时不能变成 0：状态保存原始字符串，渲染与提交前再校验。
function numberError(raw: string, integer = false): string | null {
  if (raw.trim() === "") return "请填写数值"
  const value = Number(raw)
  if (!Number.isFinite(value)) return "请输入有效数字"
  if (value < 0) return "不能小于 0"
  if (integer && !Number.isInteger(value)) return "需为整数"
  return null
}
const numberOrZero = (raw: string) => (numberError(raw) ? 0 : Number(raw))

const pointSchema = z.tuple([z.number().finite(), z.number().finite()])
const marksSchema = z.array(
  z.object({
    label: z.string(),
    polygon: z.array(pointSchema).nullable(),
    confidence: z.number().finite().optional(),
  }),
)

function parseMarks(
  text: string,
): { value: Mark[]; error: null } | { value: null; error: string } {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) {
      return { value: null, error: "轮廓需为 JSON 数组" }
    }
    const checked = marksSchema.safeParse(parsed)
    if (!checked.success) {
      const issue = checked.error.issues[0]
      const where = issue.path.length
        ? `（第 ${Number(issue.path[0]) + 1} 项）`
        : ""
      return {
        value: null,
        error: `轮廓格式有误${where}：每项需含字符串 label 和 polygon（[x, y] 数字点数组或 null）`,
      }
    }
    // 返回原始解析结果而非 zod 输出，避免静默丢弃服务端附带的额外字段。
    return { value: parsed as Mark[], error: null }
  } catch (e) {
    return {
      value: null,
      error: `JSON 格式有误：${e instanceof Error ? e.message : "无法解析"}`,
    }
  }
}

async function request<T>(
  path: string,
  data?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${inferenceGatewayBase}/${path}`, {
    method: data === undefined ? "GET" : "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(
      typeof body.detail === "string"
        ? body.detail
        : `请求失败 (${response.status})`,
    )
  }
  return response.json() as Promise<T>
}
export function InferencePage({
  sourceId,
  directory,
  onDirectoryChange,
}: {
  sourceId?: string
  directory: string
  onDirectoryChange: (directory: string) => void
}) {
  const [current, setCurrent] = useState<Task | null>(null)
  const [seed, setSeed] = useState<NumericDraft>(
    toDraft({ frame: 0, x: 0, y: 0 }),
  )
  const [pool, setPool] = useState<NumericDraft>(
    toDraft({ cx: 0, cy: 0, radius: 0 }),
  )
  const [marks, setMarks] = useState("[]")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState("")
  const [groupingVideo, setGroupingVideo] = useState<Entry | null>(null)
  const projects = useWorkspaceProjects()
  const addProjectMember = useAddProjectMember()
  const [groupNote, setGroupNote] = useState("")
  const [groupError, setGroupError] = useState("")
  const [publishingTask, setPublishingTask] = useState<Task | null>(null)
  const publishResult = usePublishResult()
  const [publishNote, setPublishNote] = useState("")
  const [publishError, setPublishError] = useState("")

  const initializedTask = useRef<string | null>(null)
  const queryClient = useQueryClient()
  const videosQuery = useQuery({
    queryKey: videosKey(directory, sourceId),
    queryFn: ({ signal }) =>
      request<{ items: Entry[] }>(
        `${inferenceRoutes.videos()}?${new URLSearchParams({ path: directory, ...(sourceId ? { source_id: sourceId } : {}) })}`,
        undefined,
        signal,
      ),
    retry: false,
  })
  const tasksQuery = useQuery({
    queryKey: tasksKey,
    queryFn: ({ signal }) =>
      request<{ items: Task[] }>(inferenceRoutes.tasks(), undefined, signal),
    refetchInterval: 3000,
    // 页面隐藏时不轮询；回到前台由 refetchOnWindowFocus 立即补一次。
    refetchIntervalInBackground: false,
    retry: false,
  })
  const entries = videosQuery.data?.items ?? []
  const tasks = tasksQuery.data?.items ?? []
  const loadError = (videosQuery.error ?? tasksQuery.error)?.message ?? ""
  const shownError = error || loadError
  const tasksData = tasksQuery.data
  useEffect(() => {
    if (!tasksData) return
    setCurrent((old) =>
      old ? (tasksData.items.find((t) => t.id === old.id) ?? old) : null,
    )
  }, [tasksData])
  const loadTasks = () => queryClient.invalidateQueries({ queryKey: tasksKey })
  const marksResult = useMemo(() => parseMarks(marks), [marks])
  const seedErrors = {
    frame: numberError(seed.frame ?? "", true),
    x: numberError(seed.x ?? ""),
    y: numberError(seed.y ?? ""),
  }
  const poolErrors = {
    cx: numberError(pool.cx ?? ""),
    cy: numberError(pool.cy ?? ""),
    radius: numberError(pool.radius ?? ""),
  }
  const formValid =
    marksResult.error === null &&
    ![...Object.values(seedErrors), ...Object.values(poolErrors)].some(Boolean)
  useEffect(() => {
    if (current?.status !== "waiting_for_review" || !current.candidate) return
    if (initializedTask.current === current.id) return
    initializedTask.current = current.id
    const c = current.candidate
    setSeed(toDraft(c.seed ?? { frame: 0, x: 0, y: 0 }))
    setPool(toDraft(c.pool ?? { cx: 0, cy: 0, radius: 0 }))
    setMarks(
      JSON.stringify(
        c.marks.map((m) => ({ label: m.label, polygon: m.polygon ?? [] })),
        null,
        2,
      ),
    )
  }, [current])

  async function act(operation: () => Promise<void>) {
    setBusy(true)
    setError("")
    try {
      await operation()
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败")
    } finally {
      setBusy(false)
    }
  }
  async function submit(path: string, body: unknown) {
    const task = await request<Task>(path, body)
    setCurrent(task)
    await loadTasks()
  }
  const inputClass =
    "w-full rounded-md border border-border bg-background px-2 py-1"
  return (
    <div className="agent-results-page space-y-6">
      <PageHeader
        title="视频推理"
        description="选择实验视频，确认场景后生成小鼠轨迹和 v9 头尾结果。"
      />
      {shownError && (
        <p
          role="alert"
          className="rounded-md border border-red-300 p-3 text-red-700"
        >
          {shownError}
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-border p-5">
          <h2 className="text-xl font-medium">实验视频</h2>
          <p className="my-2 text-sm text-muted-foreground">
            {directory || "实验视频目录"}
          </p>
          {directory && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mb-3"
              onClick={() =>
                onDirectoryChange(directory.split("/").slice(0, -1).join("/"))
              }
            >
              返回上一级
            </Button>
          )}
          <ul className="max-h-80 space-y-2 overflow-auto">
            {entries.map((entry) => (
              <li
                key={entry.path ?? entry.id}
                className="flex items-center justify-between gap-3 border-b border-border pb-2"
              >
                <span className="break-all">
                  {entry.type === "directory" ? "📁 " : "🎞 "}
                  {entry.name}
                </span>
                {entry.type === "directory" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onDirectoryChange(entry.path ?? "")}
                  >
                    打开
                  </Button>
                ) : (
                  <span className="flex shrink-0 items-center gap-2">
                    {entry.id && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`将 ${entry.name} 归入项目`}
                        onClick={() => {
                          setGroupError("")
                          setGroupNote("")
                          setGroupingVideo(entry)
                        }}
                      >
                        加入项目
                      </Button>
                    )}
                    <Button
                      type="button"
                      disabled={busy}
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void act(async () => {
                          const task = await request<Task>(
                            inferenceRoutes.tasks(),
                            {
                              video_id: entry.id,
                            },
                          )
                          setCurrent(task)
                          await loadTasks()
                        })
                      }
                    >
                      开始
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-xl border border-border p-5">
          <h2 className="text-xl font-medium">推理任务</h2>
          <ul className="mt-3 max-h-80 space-y-2 overflow-auto">
            {tasks.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  className="w-full rounded-md border p-3 text-left"
                  onClick={() => setCurrent(task)}
                >
                  <span className="font-medium">
                    {labels[task.status] ?? task.status}
                  </span>{" "}
                  · {stageLabels[task.stage] ?? task.stage}
                  <br />
                  <small className="text-muted-foreground">{task.id}</small>
                </button>
              </li>
            ))}
          </ul>
          {tasks.length === 0 && (
            <p className="mt-3 text-sm text-muted-foreground">暂无推理任务</p>
          )}
        </section>
      </div>
      {current && (
        <section className="rounded-xl border border-border p-5 space-y-4">
          <div>
            <h2 className="text-xl font-medium">
              {labels[current.status] ?? current.status} ·{" "}
              {stageLabels[current.stage] ?? current.stage}
            </h2>
            <p className="text-xs text-muted-foreground">
              任务版本 {current.id}
            </p>
            {current.error && <p className="text-red-700">{current.error}</p>}
          </div>
          {[
            "queued",
            "running",
            "waiting_for_review",
            "failed",
            "interrupted",
          ].includes(current.status) && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  submit(inferenceRoutes.tasksByTaskIdCancel(current.id), {}),
                )
              }
            >
              取消任务
            </Button>
          )}
          {["failed", "interrupted", "cancelled"].includes(current.status) && (
            <Button
              type="button"
              variant="outline"
              className="ml-2"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  submit(inferenceRoutes.tasksByTaskIdRetry(current.id), {}),
                )
              }
            >
              重试当前阶段
            </Button>
          )}
          {current.status === "waiting_for_review" && current.candidate && (
            <div className="space-y-4">
              <p>
                请对照视频帧确认或补齐水池、四个标志物和小鼠起点。缺少隐藏平台标定仍可追踪。
              </p>
              {current.candidate.evidence.review_reasons.length > 0 && (
                <p className="text-amber-700">
                  需核对：{current.candidate.evidence.review_reasons.join("；")}
                </p>
              )}
              <div className="relative max-w-3xl">
                <img
                  src={inferenceArtifactUrl(current.id, "candidate.jpg")}
                  alt="预标注参考帧"
                  className="w-full"
                />
                <svg
                  aria-label="水池、小鼠起点和标志物候选"
                  role="img"
                  className="absolute inset-0 h-full w-full"
                  viewBox={`0 0 ${current.candidate.width} ${current.candidate.height}`}
                >
                  <circle
                    cx={numberOrZero(pool.cx ?? "")}
                    cy={numberOrZero(pool.cy ?? "")}
                    r={numberOrZero(pool.radius ?? "")}
                    fill="none"
                    stroke="#00d8ff"
                    strokeWidth="4"
                  />
                  <circle
                    cx={numberOrZero(seed.x ?? "")}
                    cy={numberOrZero(seed.y ?? "")}
                    r="10"
                    fill="#ff3c6a"
                  />
                  {marksResult.value?.map((m, i) =>
                    m.polygon && m.polygon.length >= 3 ? (
                      <polygon
                        key={`${m.label}-${i}`}
                        points={m.polygon.map((p) => p.join(",")).join(" ")}
                        fill="#ffda3040"
                        stroke="#ffda30"
                        strokeWidth="4"
                      />
                    ) : null,
                  )}
                </svg>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {(
                  [
                    ["起始帧", "frame"],
                    ["小鼠 X", "x"],
                    ["小鼠 Y", "y"],
                  ] as const
                ).map(([label, key]) => (
                  <div key={key}>
                    <label>
                      {label}
                      <input
                        type="number"
                        min="0"
                        className={inputClass}
                        value={seed[key]}
                        aria-invalid={seedErrors[key] !== null}
                        onChange={(e) =>
                          setSeed({ ...seed, [key]: e.target.value })
                        }
                      />
                    </label>
                    {seedErrors[key] && (
                      <p role="alert" className="text-sm text-red-700">
                        {label}：{seedErrors[key]}
                      </p>
                    )}
                  </div>
                ))}
                {(
                  [
                    ["水池中心 X", "cx"],
                    ["水池中心 Y", "cy"],
                    ["水池半径", "radius"],
                  ] as const
                ).map(([label, key]) => (
                  <div key={key}>
                    <label>
                      {label}
                      <input
                        type="number"
                        min="0"
                        className={inputClass}
                        value={pool[key]}
                        aria-invalid={poolErrors[key] !== null}
                        onChange={(e) =>
                          setPool({ ...pool, [key]: e.target.value })
                        }
                      />
                    </label>
                    {poolErrors[key] && (
                      <p role="alert" className="text-sm text-red-700">
                        {label}：{poolErrors[key]}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <label className="block">
                四个标志物的轮廓坐标（图像像素）
                <textarea
                  className={`${inputClass} mt-2 font-mono text-sm`}
                  rows={10}
                  value={marks}
                  aria-invalid={marksResult.error !== null}
                  onChange={(e) => setMarks(e.target.value)}
                />
              </label>
              {marksResult.error && (
                <p role="alert" className="text-sm text-red-700">
                  {marksResult.error}
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                每项填写 label 和 polygon，polygon 是至少三个 [x, y] 点。
              </p>
              <Button
                type="button"
                disabled={busy || !formValid}
                onClick={() =>
                  void act(async () => {
                    if (!formValid || marksResult.value === null) return
                    await submit(
                      inferenceRoutes.tasksByTaskIdConfirm(current.id),
                      {
                        seed: {
                          frame: Number(seed.frame),
                          x: Number(seed.x),
                          y: Number(seed.y),
                        },
                        pool: {
                          cx: Number(pool.cx),
                          cy: Number(pool.cy),
                          radius: Number(pool.radius),
                        },
                        marks: marksResult.value,
                      },
                    )
                  })
                }
              >
                确认并开始追踪
              </Button>
            </div>
          )}
          {current.status === "succeeded" && (
            <div className="space-y-3">
              {/* biome-ignore lint/a11y/useMediaCaption: 推理叠加视频不含音轨。 */}
              <video
                controls
                className="w-full max-w-3xl"
                src={inferenceArtifactUrl(current.id, "overlay.mp4")}
              />
              <p className="text-sm text-muted-foreground">
                绿色为小鼠
                mask，红点为头部，蓝点为尾部，黄色为质心与轨迹；缺失帧不会连线。
              </p>
              <div className="flex flex-wrap gap-4">
                <a
                  className="underline"
                  href={inferenceArtifactUrl(current.id, "tracking.json")}
                >
                  下载轨迹与 mask
                </a>
                <a
                  className="underline"
                  href={inferenceArtifactUrl(current.id, "keypoints.json")}
                >
                  下载 v9 关键点
                </a>
                <a
                  className="underline"
                  href={inferenceArtifactUrl(current.id, "provenance.json")}
                >
                  下载来源记录
                </a>
              </div>
              <p>隐藏平台未标定时，上台事件与相关指标不可用。</p>
              {current.review ? (
                <div className="space-y-2">
                  <p>
                    结果已核对：{current.review.tracking_ok ? "通过" : "需复查"}{" "}
                    {current.review.note}
                  </p>
                  {current.review.tracking_ok && (
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setPublishError("")
                        setPublishNote("")
                        setPublishingTask(current)
                      }}
                    >
                      发布到项目
                    </Button>
                  )}
                </div>
              ) : (
                <div>
                  <label>
                    核对备注
                    <input
                      className={inputClass}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </label>
                  <Button
                    type="button"
                    disabled={busy}
                    variant="outline"
                    className="mt-2"
                    onClick={() =>
                      void act(() =>
                        submit(
                          inferenceRoutes.tasksByTaskIdReview(current.id),
                          {
                            tracking_ok: true,
                            note,
                          },
                        ),
                      )
                    }
                  >
                    确认追踪结果
                  </Button>
                  <Button
                    type="button"
                    disabled={busy}
                    variant="outline"
                    className="ml-2"
                    onClick={() =>
                      void act(() =>
                        submit(
                          inferenceRoutes.tasksByTaskIdReview(current.id),
                          {
                            tracking_ok: false,
                            note,
                          },
                        ),
                      )
                    }
                  >
                    标记需复查
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>
      )}
      <Dialog
        open={groupingVideo !== null}
        onOpenChange={(open) => {
          if (!open) setGroupingVideo(null)
        }}
      >
        <DialogContent className="project-dialog">
          <DialogTitle>归入项目</DialogTitle>
          <DialogDescription>
            将“{groupingVideo?.name}
            ”的引用加入一个项目；视频本体仍由推理服务管理。
          </DialogDescription>
          {groupError && (
            <p role="alert" className="agent-error">
              {groupError}
            </p>
          )}
          {groupNote && <p className="research-history-note">{groupNote}</p>}
          <div className="project-task-options">
            {projects.isPending && <p>正在加载项目…</p>}
            {projects.error && <p role="alert">无法加载项目，请稍后重试。</p>}
            {(projects.data ?? []).map((project) => (
              <button
                type="button"
                key={project.id}
                className="project-action"
                disabled={addProjectMember.isPending || !groupingVideo?.id}
                onClick={() => {
                  if (!groupingVideo?.id) return
                  setGroupError("")
                  addProjectMember.mutate(
                    {
                      projectId: project.id,
                      kind: "video",
                      id: groupingVideo.id,
                      label: groupingVideo.name,
                    },
                    {
                      onSuccess: () => {
                        setGroupNote(
                          `已将“${groupingVideo.name}”归入“${project.name}”。`,
                        )
                      },
                      onError: (mutationError) =>
                        setGroupError(
                          projectErrorText(
                            mutationError,
                            "归入项目失败，请重试。",
                          ),
                        ),
                    },
                  )
                }}
              >
                {project.name}
              </button>
            ))}
            {!projects.isPending &&
              !projects.error &&
              !(projects.data ?? []).length && (
                <p>还没有项目。先在左侧栏“新建项目”，再回来归入视频。</p>
              )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={publishingTask !== null}
        onOpenChange={(open) => {
          if (!open) setPublishingTask(null)
        }}
      >
        <DialogContent className="project-dialog">
          <DialogTitle>发布到项目</DialogTitle>
          <DialogDescription>
            将通过复核的推理结果发布进项目：平台后端会拉取该任务的追踪、
            关键点与来源产物，校验一致后写入应用库（逐帧行 + 汇总），
            归属所选项目。未复核或产物不一致会被拒绝。
          </DialogDescription>
          {publishError && (
            <p role="alert" className="agent-error">
              {publishError}
            </p>
          )}
          {publishNote && (
            <p className="research-history-note">{publishNote}</p>
          )}
          <div className="project-task-options">
            {projects.isPending && <p>正在加载项目…</p>}
            {projects.error && <p role="alert">无法加载项目，请稍后重试。</p>}
            {(projects.data ?? []).map((project) => (
              <button
                type="button"
                key={project.id}
                className="project-action"
                disabled={publishResult.isPending || !publishingTask}
                onClick={() => {
                  if (!publishingTask) return
                  setPublishError("")
                  publishResult.mutate(
                    { projectId: project.id, taskId: publishingTask.id },
                    {
                      onSuccess: (result) => {
                        setPublishNote(
                          result.replayed
                            ? `该结果已发布过，本次为幂等重放（项目“${project.name}”未改动）。`
                            : `已发布到“${project.name}”：${result.frames_with_heading} 帧带朝向（提案 ${result.proposal_frames}），可在项目页查看逐帧行。`,
                        )
                      },
                      onError: (mutationError) =>
                        setPublishError(
                          projectErrorText(mutationError, "发布失败，请重试。"),
                        ),
                    },
                  )
                }}
              >
                {project.name}
              </button>
            ))}
            {!projects.isPending &&
              !projects.error &&
              !(projects.data ?? []).length && (
                <p>还没有项目。先在左侧栏“新建项目”，再回来发布。</p>
              )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
