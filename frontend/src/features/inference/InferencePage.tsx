import { useCallback, useEffect, useRef, useState } from "react"

type Entry = {
  type: "directory" | "video"
  name: string
  path?: string
  id?: string
}
type Point = [number, number]
type Mark = { label: string; polygon: Point[] | null; confidence?: number }
type Candidate = {
  width: number
  height: number
  frame_count: number
  seed: { frame: number; x: number; y: number } | null
  pool: { cx: number; cy: number; radius: number } | null
  marks: Mark[]
  evidence: { review_reasons: string[] }
}
type Task = {
  id: string
  video_id: string
  status: string
  stage: string
  error: string | null
  candidate: Candidate | null
  confirmed: unknown
  review: { tracking_ok: boolean; note: string } | null
}
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
  const token = localStorage.getItem("access_token")
  const response = await fetch(`/api/v1/inference/${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
function artifact(id: string, name: string): string {
  const token = localStorage.getItem("access_token")
  return `/api/v1/inference/tasks/${id}/artifacts/${name}${token ? `?token=${encodeURIComponent(token)}` : ""}`
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

  const initializedTask = useRef<string | null>(null)
  const loadTasks = useCallback(async () => {
    const value = await request<{ items: Task[] }>("tasks")
    setTasks(value.items)
    setCurrent((old) =>
      old ? (value.items.find((t) => t.id === old.id) ?? old) : null,
    )
  }, [])
  useEffect(() => {
    request<{ items: Entry[] }>(`videos?path=${encodeURIComponent(directory)}`)
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
  async function submit(id: string, suffix: string, body: unknown) {
    const task = await request<Task>(`tasks/${id}/${suffix}`, body)
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
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded border px-3 py-1"
                    onClick={() =>
                      void act(async () => {
                        const task = await request<Task>("tasks", {
                          video_id: entry.id,
                        })
                        setCurrent(task)
                        await loadTasks()
                      })
                    }
                  >
                    开始
                  </button>
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
              onClick={() => void act(() => submit(current.id, "cancel", {}))}
            >
              取消任务
            </button>
          )}
          {["failed", "interrupted", "cancelled"].includes(current.status) && (
            <button
              type="button"
              className="ml-2 rounded border px-3 py-2"
              disabled={busy}
              onClick={() => void act(() => submit(current.id, "retry", {}))}
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
                    await submit(current.id, "confirm", {
                      seed,
                      pool,
                      marks: parsed,
                    })
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
                <p>
                  结果已核对：{current.review.tracking_ok ? "通过" : "需复查"}{" "}
                  {current.review.note}
                </p>
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
                        submit(current.id, "review", {
                          tracking_ok: true,
                          note,
                        }),
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
                        submit(current.id, "review", {
                          tracking_ok: false,
                          note,
                        }),
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
    </div>
  )
}
