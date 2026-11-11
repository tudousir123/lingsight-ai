import { useCallback, useEffect, useRef, useState } from "react"
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
import type { Entry, Mark, Task } from "@/features/inference/contract"
import { authHeaders, withTokenQuery } from "@/lib/credentials"
import {
  type InferenceArtifactName,
  inferenceGatewayBase,
  inferenceRoutes,
} from "@/lib/upstreamRoutes.gen"

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

async function request<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(`${inferenceGatewayBase}/${path}`, {
    method: data === undefined ? "GET" : "POST",
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
function artifact(id: string, name: InferenceArtifactName): string {
  const path = inferenceRoutes.tasksByTaskIdArtifactsByArtifactName(id, name)
  return withTokenQuery(`${inferenceGatewayBase}/${path}`)
}

export function InferencePage() {
  const [directory, setDirectory] = useState("")
  const [entries, setEntries] = useState<Entry[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [current, setCurrent] = useState<Task | null>(null)
  const [seed, setSeed] = useState({ frame: 0, x: 0, y: 0 })
  const [pool, setPool] = useState({ cx: 0, cy: 0, radius: 0 })
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
  const loadTasks = useCallback(async () => {
    const value = await request<{ items: Task[] }>(inferenceRoutes.tasks())
    setTasks(value.items)
    setCurrent((old) =>
      old ? (value.items.find((t) => t.id === old.id) ?? old) : null,
    )
  }, [])
  useEffect(() => {
    request<{ items: Entry[] }>(
      `${inferenceRoutes.videos()}?path=${encodeURIComponent(directory)}`,
    )
      .then((v) => setEntries(v.items))
      .catch((e: Error) => setError(e.message))
  }, [directory])
  useEffect(() => {
    const refresh = () => {
      void loadTasks().catch((e: Error) => setError(e.message))
    }
    refresh()
    const timer = setInterval(refresh, 3000)
    return () => clearInterval(timer)
  }, [loadTasks])
  useEffect(() => {
    if (current?.status !== "waiting_for_review" || !current.candidate) return
    if (initializedTask.current === current.id) return
    initializedTask.current = current.id
    const c = current.candidate
    setSeed(c.seed ?? { frame: 0, x: 0, y: 0 })
    setPool(c.pool ?? { cx: 0, cy: 0, radius: 0 })
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
    "w-full rounded border border-border bg-background px-2 py-1"
  return (
    <div className="agent-results-page space-y-6">
      <div>
        <span className="agent-eyebrow">VIDEO INFERENCE</span>
        <h1>视频推理</h1>
        <p>选择实验视频，确认场景后生成小鼠轨迹和 v9 头尾结果。</p>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded border border-red-300 p-3 text-red-700"
        >
          {error}
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-border p-5">
          <h2 className="text-xl font-medium">实验视频</h2>
          <p className="my-2 text-sm text-muted-foreground">
            {directory || "实验视频目录"}
          </p>
          {directory && (
            <button
              type="button"
              className="mb-3 underline"
              onClick={() =>
                setDirectory(directory.split("/").slice(0, -1).join("/"))
              }
            >
              返回上一级
            </button>
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
                  <button
                    type="button"
                    className="underline"
                    onClick={() => setDirectory(entry.path ?? "")}
                  >
                    打开
                  </button>
                ) : (
                  <span className="flex shrink-0 items-center gap-2">
                    {entry.id && (
                      <button
                        type="button"
                        className="rounded border px-3 py-1"
                        aria-label={`将 ${entry.name} 归入项目`}
                        onClick={() => {
                          setGroupError("")
                          setGroupNote("")
                          setGroupingVideo(entry)
                        }}
                      >
                        加入项目
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded border px-3 py-1"
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
                    </button>
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
                  className="w-full rounded border p-3 text-left"
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
            <button
              type="button"
              className="rounded border px-3 py-2"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  submit(inferenceRoutes.tasksByTaskIdCancel(current.id), {}),
                )
              }
            >
              取消任务
            </button>
          )}
          {["failed", "interrupted", "cancelled"].includes(current.status) && (
            <button
              type="button"
              className="ml-2 rounded border px-3 py-2"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  submit(inferenceRoutes.tasksByTaskIdRetry(current.id), {}),
                )
              }
            >
              重试当前阶段
            </button>
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
                  src={artifact(current.id, "candidate.jpg")}
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
                    cx={pool.cx}
                    cy={pool.cy}
                    r={pool.radius}
                    fill="none"
                    stroke="#00d8ff"
                    strokeWidth="4"
                  />
                  <circle cx={seed.x} cy={seed.y} r="10" fill="#ff3c6a" />
                  {(() => {
                    try {
                      const ms = JSON.parse(marks) as Mark[]
                      return ms.map((m, i) =>
                        m.polygon && m.polygon.length >= 3 ? (
                          <polygon
                            key={`${m.label}-${i}`}
                            points={m.polygon.map((p) => p.join(",")).join(" ")}
                            fill="#ffda3040"
                            stroke="#ffda30"
                            strokeWidth="4"
                          />
                        ) : null,
                      )
                    } catch {
                      return null
                    }
                  })()}
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
                  <label key={key}>
                    {label}
                    <input
                      aria-label={label}
                      type="number"
                      min="0"
                      className={inputClass}
                      value={seed[key]}
                      onChange={(e) =>
                        setSeed({ ...seed, [key]: Number(e.target.value) })
                      }
                    />
                  </label>
                ))}
                {(
                  [
                    ["水池中心 X", "cx"],
                    ["水池中心 Y", "cy"],
                    ["水池半径", "radius"],
                  ] as const
                ).map(([label, key]) => (
                  <label key={key}>
                    {label}
                    <input
                      aria-label={label}
                      type="number"
                      min="0"
                      className={inputClass}
                      value={pool[key]}
                      onChange={(e) =>
                        setPool({ ...pool, [key]: Number(e.target.value) })
                      }
                    />
                  </label>
                ))}
              </div>
              <label className="block">
                四个标志物的轮廓坐标（图像像素）
                <textarea
                  aria-label="标志物轮廓"
                  className={`${inputClass} mt-2 font-mono text-sm`}
                  rows={10}
                  value={marks}
                  onChange={(e) => setMarks(e.target.value)}
                />
              </label>
              <p className="text-sm text-muted-foreground">
                每项填写 label 和 polygon，polygon 是至少三个 [x, y] 点。
              </p>
              <button
                type="button"
                className="rounded bg-primary px-4 py-2 text-primary-foreground"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const parsed: unknown = JSON.parse(marks)
                    await submit(
                      inferenceRoutes.tasksByTaskIdConfirm(current.id),
                      {
                        seed,
                        pool,
                        marks: parsed,
                      },
                    )
                  })
                }
              >
                确认并开始追踪
              </button>
            </div>
          )}
          {current.status === "succeeded" && (
            <div className="space-y-3">
              {/* biome-ignore lint/a11y/useMediaCaption: 推理叠加视频不含音轨。 */}
              <video
                controls
                className="w-full max-w-3xl"
                src={artifact(current.id, "overlay.mp4")}
              />
              <p className="text-sm text-muted-foreground">
                绿色为小鼠
                mask，红点为头部，蓝点为尾部，黄色为质心与轨迹；缺失帧不会连线。
              </p>
              <div className="flex flex-wrap gap-4">
                <a
                  className="underline"
                  href={artifact(current.id, "tracking.json")}
                >
                  下载轨迹与 mask
                </a>
                <a
                  className="underline"
                  href={artifact(current.id, "keypoints.json")}
                >
                  下载 v9 关键点
                </a>
                <a
                  className="underline"
                  href={artifact(current.id, "provenance.json")}
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
                    <button
                      type="button"
                      className="rounded bg-primary px-4 py-2 text-primary-foreground"
                      disabled={busy}
                      onClick={() => {
                        setPublishError("")
                        setPublishNote("")
                        setPublishingTask(current)
                      }}
                    >
                      发布到项目
                    </button>
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
                  <button
                    type="button"
                    disabled={busy}
                    className="mt-2 rounded border px-3 py-2"
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
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="ml-2 rounded border px-3 py-2"
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
                  </button>
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
