import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useRef, useState } from "react"
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
import {
  formatBytes,
  hasLibraryScope,
  type ProjectVideo,
  useProjectVideos,
  useWorkspaceInfo,
} from "@/features/agent/videos"
import { inferenceArtifactUrl } from "@/features/inference/artifacts"
import type { Entry, Task } from "@/features/inference/contract"
import { useTrialByVideoName } from "@/features/trials/videoTrial"
import {
  ApiRequestError,
  problemFromResponse,
  problemText,
} from "@/lib/apiError"
import { authHeaders } from "@/lib/credentials"
import { inferenceGatewayBase, inferenceRoutes } from "@/lib/upstreamRoutes.gen"
import { newUuid } from "@/lib/uuid"
import { PreannotationConfirm } from "./PreannotationConfirm"

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

const tasksKey = (projectId?: string) =>
  ["inference", "tasks", projectId ?? null] as const
const videosKey = (
  projectId: string | undefined,
  directory: string,
  sourceId?: string,
) => ["inference", "videos", projectId, directory, sourceId ?? null] as const

async function request<T>(
  path: string,
  data?: unknown,
  signal?: AbortSignal,
  idempotencyKey?: string,
): Promise<T> {
  const response = await fetch(`${inferenceGatewayBase}/${path}`, {
    method: data === undefined ? "GET" : "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      ...authHeaders(),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  })
  if (!response.ok) {
    throw new ApiRequestError(await problemFromResponse(response))
  }
  return response.json() as Promise<T>
}

export function InferencePage({
  projectId,
  sourceId,
  directory,
  onProjectChange,
  onDirectoryChange,
}: {
  projectId?: string
  sourceId?: string
  directory?: string
  onProjectChange: (projectId: string | undefined) => void
  onDirectoryChange: (directory: string) => void
}) {
  const [current, setCurrent] = useState<Task | null>(null)
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
  // A start retried after an ambiguous failure replays the same key instead
  // of creating a second task.
  const startKeys = useRef(new Map<string, string>())

  const queryClient = useQueryClient()
  const workspace = useWorkspaceInfo()
  const project = projects.data?.find((item) => item.id === projectId)
  const folder = project?.video_folder ?? null
  const libraryAllowed = hasLibraryScope(workspace.data) && !!folder
  const folderSource = sourceId ?? folder?.source_id
  const folderDirectory = directory ?? folder?.path ?? ""
  const uploads = useProjectVideos(project?.id)
  const videosQuery = useQuery({
    queryKey: videosKey(project?.id, folderDirectory, folderSource),
    enabled: libraryAllowed,
    queryFn: ({ signal }) =>
      request<Entry[]>(
        `${inferenceRoutes.videos()}?${new URLSearchParams({
          path: folderDirectory,
          project_id: project?.id ?? "",
          ...(folderSource ? { source_id: folderSource } : {}),
        })}`,
        undefined,
        signal,
      ),
    retry: false,
  })
  const tasksQuery = useQuery({
    queryKey: tasksKey(project?.id),
    enabled: !projects.isPending,
    queryFn: ({ signal }) =>
      request<Task[]>(
        project
          ? `${inferenceRoutes.tasks()}?${new URLSearchParams({ project_id: project.id })}`
          : inferenceRoutes.tasks(),
        undefined,
        signal,
      ),
    refetchInterval: 3000,
    // 页面隐藏时不轮询；回到前台由 refetchOnWindowFocus 立即补一次。
    refetchIntervalInBackground: false,
    retry: false,
  })
  const entries = videosQuery.data ?? []
  const tasks = tasksQuery.data ?? []
  const loadError = [
    projects.error,
    uploads.error,
    videosQuery.error,
    tasksQuery.error,
  ]
    .filter(Boolean)
    .map((item) => problemText(item, "加载失败，请稍后重试。"))[0]
  const shownError = error || loadError || ""
  // Keep the open task fresh from the polled list.
  const live = current
    ? (tasks.find((task) => task.id === current.id) ?? current)
    : null
  const loadTasks = () =>
    queryClient.invalidateQueries({ queryKey: ["inference", "tasks"] })

  const currentVideo = live
    ? uploads.data?.find((video) => video.video_id === live.video_id)
    : undefined
  const libraryEntry = live
    ? entries.find((entry) => entry.id === live.video_id)
    : undefined
  const trial = useTrialByVideoName(
    libraryEntry?.name,
    live?.source_kind !== "user_upload" && hasLibraryScope(workspace.data),
  )

  async function act(operation: () => Promise<void>) {
    setBusy(true)
    setError("")
    try {
      await operation()
    } catch (e) {
      setError(problemText(e, "操作失败"))
    } finally {
      setBusy(false)
    }
  }
  async function submit(path: string, body: unknown) {
    const task = await request<Task>(path, body)
    setCurrent(task)
    await loadTasks()
  }
  async function start(videoId: string) {
    if (!project) return
    const key = startKeys.current.get(videoId) ?? newUuid()
    startKeys.current.set(videoId, key)
    try {
      const task = await request<Task>(
        inferenceRoutes.tasks(),
        { project_id: project.id, video_id: videoId },
        undefined,
        key,
      )
      startKeys.current.delete(videoId)
      setCurrent(task)
      await loadTasks()
    } catch (e) {
      if (
        e instanceof ApiRequestError &&
        e.problem.code === "idempotency_conflict"
      )
        startKeys.current.delete(videoId)
      throw e
    }
  }
  const inputClass =
    "w-full rounded border border-border bg-background px-2 py-1"
  return (
    <div className="agent-results-page space-y-6">
      <div>
        <span className="agent-eyebrow">VIDEO INFERENCE</span>
        <h1>视频推理</h1>
        <p>选择项目内的视频，确认场景后生成小鼠轨迹和 v9 头尾结果。</p>
      </div>
      {shownError && (
        <p
          role="alert"
          className="rounded border border-red-300 p-3 text-red-700"
        >
          {shownError}
        </p>
      )}
      <section className="rounded-xl border border-border p-5">
        <label className="flex flex-wrap items-center gap-3">
          <span className="text-xl font-medium">项目</span>
          <select
            aria-label="选择项目"
            className="rounded border border-border bg-background px-2 py-1"
            value={project?.id ?? ""}
            disabled={projects.isPending || !projects.data?.length}
            onChange={(event) => {
              setCurrent(null)
              onProjectChange(event.target.value || undefined)
            }}
          >
            <option value="">请选择项目</option>
            {(projects.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {projects.isSuccess && !projects.data.length && (
          <p className="mt-2 text-sm text-muted-foreground">
            还没有项目。视频必须先归入你的项目才能上传和推理：先在左侧栏“新建项目”，再到项目资料页上传视频。
          </p>
        )}
        {projects.isSuccess && projects.data.length > 0 && !project && (
          <p className="mt-2 text-sm text-muted-foreground">
            选择一个项目后显示该项目的视频。
          </p>
        )}
      </section>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-border p-5">
          <h2 className="text-xl font-medium">项目视频</h2>
          {project && (
            <>
              <ul className="mt-3 max-h-80 space-y-2 overflow-auto">
                {(uploads.data ?? []).map((video) => (
                  <li
                    key={video.video_id}
                    className="flex items-center justify-between gap-3 border-b border-border pb-2"
                  >
                    <span className="break-all">
                      🎞 {video.filename}
                      <small className="block text-muted-foreground">
                        上传 · {video.format.toUpperCase()} ·{" "}
                        {formatBytes(video.bytes)}
                      </small>
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      className="shrink-0 rounded border px-3 py-1"
                      aria-label={`开始推理 ${video.filename}`}
                      onClick={() => void act(() => start(video.video_id))}
                    >
                      开始
                    </button>
                  </li>
                ))}
              </ul>
              {uploads.isSuccess && !uploads.data.length && (
                <p className="mt-3 text-sm text-muted-foreground">
                  该项目还没有上传的视频。
                  <Link
                    className="ml-1 underline"
                    to="/projects/$projectId"
                    params={{ projectId: project.id }}
                    search={{ view: "details" }}
                  >
                    到项目资料页上传
                  </Link>
                </p>
              )}
            </>
          )}
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
          {tasksQuery.isSuccess && tasks.length === 0 && (
            <p className="mt-3 text-sm text-muted-foreground">暂无推理任务</p>
          )}
        </section>
      </div>
      {libraryAllowed && (
        <section className="rounded-xl border border-border p-5">
          <h2 className="text-xl font-medium">已授权的实验视频目录</h2>
          <p className="my-2 text-sm text-muted-foreground">
            {folderDirectory || "实验视频目录"}
          </p>
          {folder &&
            folderDirectory !== (folder.path ?? "") &&
            folderDirectory.startsWith(folder.path ?? "") && (
              <button
                type="button"
                className="mb-3 underline"
                onClick={() =>
                  onDirectoryChange(
                    folderDirectory.split("/").slice(0, -1).join("/"),
                  )
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
                    onClick={() => onDirectoryChange(entry.path ?? "")}
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
                      disabled={busy || !entry.id}
                      className="rounded border px-3 py-1"
                      aria-label={`开始推理 ${entry.name}`}
                      onClick={() =>
                        entry.id && void act(() => start(entry.id as string))
                      }
                    >
                      开始
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {videosQuery.isSuccess && entries.length === 0 && (
            <p className="mt-3 text-sm text-muted-foreground">此目录为空。</p>
          )}
        </section>
      )}
      {live && (
        <section className="rounded-xl border border-border p-5 space-y-4">
          <div>
            <h2 className="text-xl font-medium">
              {labels[live.status] ?? live.status} ·{" "}
              {stageLabels[live.stage] ?? live.stage}
            </h2>
            <p className="text-xs text-muted-foreground">任务版本 {live.id}</p>
            <VideoLine
              task={live}
              upload={currentVideo}
              entry={libraryEntry}
              trial={trial.data ?? null}
            />
            {live.error && <p className="text-red-700">{live.error}</p>}
          </div>
          {[
            "queued",
            "running",
            "waiting_for_review",
            "failed",
            "interrupted",
          ].includes(live.status) && (
            <button
              type="button"
              className="rounded border px-3 py-2"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  submit(inferenceRoutes.tasksByTaskIdCancel(live.id), {}),
                )
              }
            >
              取消任务
            </button>
          )}
          {["failed", "interrupted", "cancelled"].includes(live.status) && (
            <button
              type="button"
              className="ml-2 rounded border px-3 py-2"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  submit(inferenceRoutes.tasksByTaskIdRetry(live.id), {}),
                )
              }
            >
              重试当前阶段
            </button>
          )}
          {(live.status === "waiting_for_review" || live.confirmation_id) && (
            <PreannotationConfirm key={live.id} task={live} />
          )}
          {live.status === "succeeded" && (
            <div className="space-y-3">
              {/* biome-ignore lint/a11y/useMediaCaption: 推理叠加视频不含音轨。 */}
              <video
                controls
                className="w-full max-w-3xl"
                src={inferenceArtifactUrl(live.id, "overlay.mp4")}
              />
              <p className="text-sm text-muted-foreground">
                绿色为小鼠
                mask，红点为头部，蓝点为尾部，黄色为质心与轨迹；缺失帧不会连线。
              </p>
              <div className="flex flex-wrap gap-4">
                <a
                  className="underline"
                  href={inferenceArtifactUrl(live.id, "tracking.json")}
                >
                  下载轨迹与 mask
                </a>
                <a
                  className="underline"
                  href={inferenceArtifactUrl(live.id, "keypoints.json")}
                >
                  下载 v9 关键点
                </a>
                <a
                  className="underline"
                  href={inferenceArtifactUrl(live.id, "provenance.json")}
                >
                  下载来源记录
                </a>
              </div>
              <p>隐藏平台未标定时，上台事件与相关指标不可用。</p>
              {live.review ? (
                <div className="space-y-2">
                  <p>
                    结果已核对：{live.review.tracking_ok ? "通过" : "需复查"}{" "}
                    {live.review.note}
                  </p>
                  {live.review.tracking_ok && (
                    <button
                      type="button"
                      className="rounded bg-primary px-4 py-2 text-primary-foreground"
                      disabled={busy}
                      onClick={() => {
                        setPublishError("")
                        setPublishNote("")
                        setPublishingTask(live)
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
                        submit(inferenceRoutes.tasksByTaskIdReview(live.id), {
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
                        submit(inferenceRoutes.tasksByTaskIdReview(live.id), {
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

function VideoLine({
  task,
  upload,
  entry,
  trial,
}: {
  task: Task
  upload?: ProjectVideo
  entry?: Entry
  trial: {
    group_name: string
    mouse_id: string
    phase: string
    trial_no: string
    video_name: string
  } | null
}) {
  const name = upload?.filename ?? entry?.name
  return (
    <p className="text-sm text-muted-foreground" data-testid="task-video">
      {task.source_kind === "user_upload" ? "上传视频" : "项目视频"}：
      {name ?? task.video_id}
      {trial ? (
        <span data-testid="task-trial">
          {" "}
          · 对应试次：{trial.group_name} · {trial.mouse_id} · 试次{" "}
          {trial.trial_no}（按文件名匹配，映射未核验，仅作视频级参考）
        </span>
      ) : (
        task.source_kind === "user_upload" && (
          <span> · 用户上传，不对应科研库试次</span>
        )
      )}
    </p>
  )
}
