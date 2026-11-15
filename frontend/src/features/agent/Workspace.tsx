import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import {
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleDot,
  Database,
  FileText,
  LoaderCircle,
  MessageSquare,
  PanelRight,
  ScanLine,
  Sparkles,
  Square,
  Video,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { PageHeader } from "@/components/Common/PageHeader"
import { WorkspaceIntro } from "@/features/research/copilot/WorkspaceIntro"
import { consumeBrief, pendingBriefPrompt } from "@/features/research/entry"
import { flagshipVisionModel } from "@/features/research/vision-model"
import { agentRoutes } from "@/lib/upstreamRoutes.gen"
import { ArtifactCards, ArtifactViewer } from "./Artifacts"
import {
  type Artifact,
  agentJson,
  download,
  isActive,
  isTaskNotFound,
  type Question,
  type Run,
  statusLabels,
  type Task,
  type TaskEvent,
  taskKey,
  tasksKey,
} from "./api"
import { useTaskEvents } from "./events"
import { MemoryPanel } from "./MemoryPanel"
import { PersonalAgentStatus, usePersonalAgent } from "./PersonalAgent"
import { ProjectConversationHome } from "./ProjectConversationHome"
import {
  membersOfKind,
  useAddProjectMember,
  useWorkspaceProjects,
} from "./projects"
import { useTasks } from "./queries"
import { VideoAttachment, VideoAttachmentList } from "./VideoAttachment"
import {
  createVideoWorkflow,
  saveVideoWorkflow,
  videoWorkflowEnabled,
  type WorkflowVideo,
} from "./videoWorkflow"
import "./workspace.css"
import "./workspace-home.css"

function eventText(event: TaskEvent, field: string) {
  const value = event.data[field]
  return typeof value === "string" ? value : ""
}
const toolLabels: Record<string, string> = {
  query_data: "读取实验数据",
  run_python: "运行分析代码",
  write_report: "撰写研究报告",
  ask_user: "确认科研口径",
  read_artifact: "读取研究材料",
  save_artifact: "保存研究成果",
}
function Conversation({ task, events }: { task: Task; events: TaskEvent[] }) {
  return (
    <div className="agent-conversation">
      {task.runs.map((run) => {
        const entries = events.filter((e) => e.run_id === run.id)
        const blocks: { key: string; kind: "text" | "user"; text: string }[] =
          []
        for (const e of entries) {
          if (e.type !== "agent.text" && e.type !== "user.message") continue
          const text = eventText(e, "text")
          if (!text) continue
          const last = blocks[blocks.length - 1]
          if (e.type === "agent.text" && last?.kind === "text")
            last.text += text
          else
            blocks.push({
              key: String(e.id),
              kind: e.type === "agent.text" ? "text" : "user",
              text,
            })
        }
        const steps = entries.filter((e) => e.type.startsWith("step."))
        return (
          <section className="agent-run" key={run.id}>
            <div className="agent-user-message">{run.instruction}</div>
            <div className="agent-response-heading">
              <ScanLine size={19} />
              <strong>LingSight 灵视科研</strong>
              <span>{statusLabels[run.status]}</span>
            </div>
            {steps.length > 0 && (
              <details className="agent-steps">
                <summary>
                  <CircleDot size={13} />
                  科研流程 ·{" "}
                  {steps.filter((e) => e.type === "step.completed").length}{" "}
                  步已完成
                  <ChevronDown size={13} />
                </summary>
                {steps.map((e) => (
                  <div key={e.id}>
                    {e.type === "step.completed" ? (
                      <Check size={13} />
                    ) : (
                      <CircleDot size={13} />
                    )}
                    <span>
                      {toolLabels[eventText(e, "tool")] ||
                        eventText(e, "tool") ||
                        "分析步骤"}
                    </span>
                    <small>
                      {e.type === "step.completed"
                        ? "已完成"
                        : e.type === "step.failed"
                          ? "失败"
                          : "已开始"}
                    </small>
                  </div>
                ))}
              </details>
            )}
            {blocks
              .filter((block) => !run.answer || block.kind === "user")
              .map((block) => (
                <div
                  key={block.key}
                  className={
                    block.kind === "user"
                      ? "agent-user-message"
                      : "agent-answer"
                  }
                >
                  {block.text}
                </div>
              ))}
            {run.status === "succeeded" && run.answer && (
              <div className="agent-answer">{run.answer.text}</div>
            )}
            {blocks.length === 0 && isActive(run.status) && (
              <p className="agent-wait">
                <LoaderCircle size={14} className="animate-spin" />
                {run.status === "queued"
                  ? "任务已排队，等待开始…"
                  : run.status === "waiting_for_input"
                    ? "请确认下方科研口径后继续。"
                    : "正在准备分析，进度将自动更新…"}
              </p>
            )}
            {run.error && (
              <p className="agent-error" role="alert">
                {run.error}
              </p>
            )}
          </section>
        )
      })}
    </div>
  )
}
function Clarification({
  question,
  run,
  onDone,
  disabled = false,
}: {
  disabled?: boolean
  question: Question
  run: Run
  onDone: () => void
}) {
  const [answer, setAnswer] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  return (
    <form
      className="agent-question"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!answer.trim() || pending || disabled) return
        setPending(true)
        setError("")
        try {
          await agentJson(
            agentRoutes.runsByRunIdClarificationsByClarificationIdAnswer(
              run.id,
              question.id,
            ),
            { answer },
          )
          onDone()
        } catch (e) {
          setError(e instanceof Error ? e.message : "提交失败。")
        } finally {
          setPending(false)
        }
      }}
    >
      <strong>需要你确认</strong>
      <p>{question.question}</p>
      <textarea
        aria-label="科研口径"
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        required
        disabled={disabled}
      />
      <button type="submit" disabled={!answer.trim() || pending || disabled}>
        {pending ? "正在提交…" : "确认并继续"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  )
}
export function AgentWorkspace({
  taskId = "",
  projectId,
  projectContextId,
}: {
  taskId?: string
  projectId?: string
  projectContextId?: string
}) {
  const personal = usePersonalAgent()
  const tasks = useTasks()
  const projects = useWorkspaceProjects()
  const addMember = useAddProjectMember()
  const project = projects.data?.find((item) => item.id === projectId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [artifact, setArtifact] = useState<Artifact | null>(null)
  const [videos, setVideos] = useState<WorkflowVideo[]>([])
  const [attachmentOpen, setAttachmentOpen] = useState(false)
  const [attachmentSource, setAttachmentSource] =
    useState<WorkflowVideo["source"]>("local")
  const canAttach = videoWorkflowEnabled && !taskId
  const input = useRef<HTMLTextAreaElement>(null)
  const task = useQuery({
    queryKey: taskKey(taskId),
    queryFn: ({ signal }) =>
      agentJson<Task>(
        agentRoutes.tasksByTaskId(taskId),
        undefined,
        "GET",
        signal,
      ),
    enabled: !!taskId,
    refetchInterval: (query) =>
      isTaskNotFound(query.state.error) ? false : 2500,
    refetchOnWindowFocus: (query) => !isTaskNotFound(query.state.error),
    refetchOnReconnect: (query) => !isTaskNotFound(query.state.error),
    retry: false,
  })
  const missing = isTaskNotFound(task.error)
  const stream = useTaskEvents(task.data && !missing ? taskId : "")
  const run = task.data?.runs[task.data.runs.length - 1]
  const scopeId = projectId ?? task.data?.project_id
  const isProjectHome = !!projectId && !taskId
  const containingProject = projects.data?.find(
    (item) =>
      item.id === projectContextId &&
      membersOfKind(item, "agent_task").some((member) => member.id === taskId),
  )
  const returnProjectId = containingProject?.id ?? task.data?.project_id
  const returnProject =
    containingProject ??
    projects.data?.find((item) => item.id === returnProjectId)
  const scopeProject = projects.data?.find((item) => item.id === scopeId)
  useEffect(() => {
    setDraft(taskId || projectId ? "" : pendingBriefPrompt())
    setError("")
    setArtifact(null)
    setVideos([])
    setAttachmentOpen(false)
    setAttachmentSource("local")
  }, [taskId, projectId])
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: tasksKey })
    void queryClient.invalidateQueries({ queryKey: taskKey(taskId) })
  }
  const personalReady =
    !personal.isPending &&
    !personal.error &&
    personal.data?.environment.status === "ready"
  const taskBound =
    !taskId ||
    (!!task.data &&
      task.data.personal_agent_id === personal.data?.id &&
      task.data.environment_id === personal.data?.environment.id)
  const executionReady = personalReady && taskBound
  const blocked = run?.status === "waiting_for_input"
  const canSend =
    (!!draft.trim() || (canAttach && videos.length > 0)) &&
    !pending &&
    executionReady &&
    !blocked &&
    !tasks.error &&
    !task.error &&
    (!taskId || !!task.data)
  const send = async () => {
    if (!canSend) return
    if (!taskId && projectId && !project) {
      setError("项目不可用，请返回项目页重试。你的问题已保留。")
      return
    }
    const text = draft.trim()
    setPending(true)
    setError("")
    try {
      if (videos.length && canAttach) {
        const flow = createVideoWorkflow(videos, text, projectId)
        saveVideoWorkflow(flow)
        await navigate({
          to: "/tasks/$taskId",
          params: { taskId: flow.id },
          search: { project: projectId },
        })
        setVideos([])
      } else if (taskId)
        await agentJson(agentRoutes.tasksByTaskIdMessages(taskId), { text })
      else {
        const created = await agentJson<{ task: Task; run?: Run }>(
          agentRoutes.tasks(),
          {
            goal: text,
            ...(projectId ? { project_id: projectId } : {}),
          },
        )
        if (projectId && created.task.project_id !== projectId) {
          let stopped = false
          if (created.run) {
            try {
              await agentJson(agentRoutes.runsByRunIdCancel(created.run.id), {})
              stopped = true
            } catch {
              // Keep the original question and make the uncertain run visible.
            }
          }
          refresh()
          throw new Error(
            stopped
              ? "Agent 返回的项目范围不一致，任务已停止。请检查服务配置后重试。"
              : "Agent 返回的项目范围不一致，未能确认任务已停止。请先在任务列表检查，避免重复发送。",
          )
        }
        if (projectId) {
          try {
            await addMember.mutateAsync({
              projectId,
              kind: "agent_task",
              id: created.task.id,
              label: created.task.title,
            })
          } catch {
            toast.error(
              "任务已创建，项目列表归组失败。请在项目页整理任务，无需重新发送。",
            )
          }
        }
        await navigate({
          to: "/tasks/$taskId",
          params: { taskId: created.task.id },
        })
      }
      consumeBrief()
      setDraft("")
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败，已保留你的问题。")
    } finally {
      setPending(false)
    }
  }
  const action = async (op: "cancel" | "resume") => {
    if (!run || pending || (op === "resume" && !executionReady)) return
    setPending(true)
    setError("")
    try {
      const path =
        op === "cancel"
          ? agentRoutes.runsByRunIdCancel(run.id)
          : agentRoutes.runsByRunIdResume(run.id)
      await agentJson(path, {})
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成，请重试。")
    } finally {
      setPending(false)
    }
  }
  const start = (text: string) => {
    setDraft(text)
    input.current?.focus({ preventScroll: true })
  }
  const startVideoAnalysis = (source: WorkflowVideo["source"]) => {
    if (!canAttach) {
      void navigate({ to: source === "drive" ? "/inference" : "/annotations" })
      return
    }
    start(
      source === "drive"
        ? "比较水迷宫不同训练日的逃逸潜伏期和轨迹。"
        : "汇总本次水迷宫视频的逃逸潜伏期和轨迹。",
    )
    if (canAttach) {
      setAttachmentSource(source)
      setAttachmentOpen(true)
    }
  }
  if (missing) {
    return (
      <div className="agent-empty" role="alert">
        <h1>任务不存在或已被删除</h1>
        <Link to="/analysis" className="underline">
          返回任务列表
        </Link>
      </div>
    )
  }
  const serviceError = tasks.error?.message
  const composer = (
    <div className="agent-composer-wrap">
      <form
        className="agent-composer"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <div className="agent-composer-context">
          <Database size={13} />
          <span>{scopeId ? "项目已发布数据" : "实验数据"}</span>
          {(run?.status === "queued" || run?.status === "running") && (
            <span className="agent-background-note">
              离开页面后任务仍会继续运行
            </span>
          )}
        </div>
        {videos.length > 0 && (
          <VideoAttachmentList
            videos={videos}
            onRemove={(id) =>
              setVideos(videos.filter((video) => video.id !== id))
            }
          />
        )}
        <textarea
          ref={input}
          value={draft}
          maxLength={12000}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="研究问题"
          placeholder={
            blocked
              ? "请先回答上方科研口径问题后继续"
              : taskId
                ? "继续追问，或补充分析要求…"
                : canAttach
                  ? "上传视频，或描述你的研究问题…"
                  : projectId
                    ? "在此项目开始新对话…"
                    : "输入研究问题，可附上视频 ID 或实验范围…"
          }
          disabled={pending || blocked}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <div className="agent-composer-toolbar">
          {canAttach && (
            <VideoAttachment
              open={attachmentOpen}
              onOpenChange={setAttachmentOpen}
              source={attachmentSource}
              onSourceChange={setAttachmentSource}
              videos={videos}
              onChange={setVideos}
            />
          )}
          {!!taskId && !returnProjectId && (
            <Link to="/annotations" title="浏览实验与视频">
              <Video size={17} />
              <span>浏览视频</span>
            </Link>
          )}
          <span className="agent-model-label">
            <Sparkles size={14} />
            灵视科研助手
          </span>
          <div className="agent-send-actions">
            {run && (isActive(run.status) || run.status === "interrupted") && (
              <button
                type="button"
                disabled={pending}
                className="agent-stop"
                onClick={() => void action("cancel")}
              >
                <Square size={11} />
                停止
              </button>
            )}
            <button
              type="submit"
              className="agent-send"
              aria-label="发送研究问题"
              disabled={!canSend}
            >
              {pending ? (
                <LoaderCircle size={19} className="animate-spin" />
              ) : (
                <ArrowUp size={20} />
              )}
            </button>
          </div>
        </div>
      </form>
      {error && (
        <p className="agent-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
  return (
    <div
      className={`agent-workbench ${!taskId && !isProjectHome ? "agent-home" : ""} ${isProjectHome || returnProjectId ? "agent-project-chat" : ""}`}
      lang="zh-CN"
    >
      <div className="agent-workspace">
        <div className="agent-scroll-area">
          <div className="agent-content">
            <PersonalAgentStatus
              identity={personal.data}
              loading={personal.isPending}
              error={personal.error}
              onRetry={() => void personal.refetch()}
            />
            <MemoryPanel taskId={taskId} />
            {!!task.data && personal.data && !taskBound && (
              <p className="agent-error" role="alert">
                此任务未绑定当前个人环境，已禁用继续执行。历史材料不会自动迁移。
              </p>
            )}
            {taskId && returnProjectId && (
              <div className="workspace-scope">
                <Link
                  to="/projects/$projectId"
                  params={{ projectId: returnProjectId }}
                >
                  <ArrowLeft size={14} /> {returnProject?.name ?? "返回项目"}
                </Link>
                <span role="status">
                  {!scopeId
                    ? "此对话未限定项目数据范围；归组不会改变分析范围"
                    : scopeId === returnProjectId
                      ? "分析范围为当前项目的已发布推理数据"
                      : `分析范围为${scopeProject?.name ?? "任务所属项目"}的已发布推理数据`}
                </span>
              </div>
            )}
            {isProjectHome ? (
              project ? (
                <ProjectConversationHome
                  project={project}
                  tasks={tasks.data ?? []}
                  tasksLoading={tasks.isPending}
                  tasksUnavailable={!!tasks.error}
                />
              ) : (
                <h1 className="agent-task-heading">
                  {projects.isPending ? "正在加载项目…" : "项目不可用"}
                </h1>
              )
            ) : !taskId ? (
              <WorkspaceIntro
                onUsePrompt={start}
                videoMode={canAttach ? "preview" : "connected"}
                onChooseVideo={startVideoAnalysis}
                onAnalyzeData={() =>
                  start(
                    "用已有水迷宫数据比较不同训练日的逃逸潜伏期，请先确认实验范围。",
                  )
                }
              />
            ) : task.isPending ? (
              <div className="agent-empty">
                <LoaderCircle className="animate-spin" />
                正在加载科研任务…
              </div>
            ) : task.data ? (
              <>
                <div className="agent-task-heading">
                  <h1>{task.data.title}</h1>
                  <div>
                    {run && (
                      <span className={`agent-run-status status-${run.status}`}>
                        {statusLabels[run.status]}
                      </span>
                    )}
                    {run && ["failed", "interrupted"].includes(run.status) && (
                      <button
                        type="button"
                        disabled={pending || !executionReady}
                        onClick={() => void action("resume")}
                      >
                        从已保存的材料恢复
                      </button>
                    )}
                    {!!task.data.artifacts?.length && (
                      <button
                        type="button"
                        onClick={() =>
                          void download(
                            agentRoutes.tasksByTaskIdBundle(taskId),
                            `research-${taskId}.zip`,
                          ).catch((e) => setError(e.message))
                        }
                      >
                        <FileText size={14} />
                        下载研究材料包
                      </button>
                    )}
                  </div>
                </div>
                <Conversation task={task.data} events={stream.events} />
                {run?.status === "waiting_for_input" &&
                  run.clarifications
                    ?.filter((q) => !q.answer)
                    .map((q) => (
                      <Clarification
                        key={q.id}
                        question={q}
                        run={run}
                        disabled={!executionReady}
                        onDone={refresh}
                      />
                    ))}
                {!!task.data.artifacts?.length && (
                  <section className="agent-deliverables">
                    <h2>
                      研究成果{" "}
                      <small>
                        {task.data.artifacts.length} 个文件 · 已保留版本
                      </small>
                    </h2>
                    <ArtifactCards
                      artifacts={task.data.artifacts}
                      onSelect={setArtifact}
                    />
                  </section>
                )}
              </>
            ) : null}
            {(serviceError || task.error || stream.error) && (
              <div className="agent-connection-error" role="alert">
                <span>
                  {task.error?.message ||
                    serviceError ||
                    `进度连接已断开，正在重连： ${stream.error}`}
                </span>
                <button type="button" onClick={refresh}>
                  重试连接
                </button>
              </div>
            )}
          </div>
        </div>
        {composer}
        {artifact && (
          <ArtifactViewer
            key={artifact.id}
            artifact={artifact}
            taskId={taskId}
            onClose={() => setArtifact(null)}
          />
        )}
      </div>
      {task.data && !returnProjectId && (
        <aside className="agent-overview" aria-label="任务概览">
          <h2>
            <PanelRight size={16} strokeWidth={1.5} />
            任务概览
          </h2>
          <dl>
            <div className="agent-overview-status">
              <dt>当前状态</dt>
              <dd className={run ? `status-${run.status}` : undefined}>
                {run ? statusLabels[run.status] : "新任务"}
              </dd>
            </div>
            <div className="agent-overview-status">
              <dt>研究成果</dt>
              <dd>{task.data.artifacts?.length ?? 0} 个文件</dd>
            </div>
          </dl>
          {run && isActive(run.status) && (
            <p className="agent-overview-note">
              离开页面后，任务仍会保留，可从最近任务返回。
            </p>
          )}
        </aside>
      )}
    </div>
  )
}

export function AnalysisPage() {
  const tasks = useTasks()
  return (
    <div className="agent-results-page">
      <PageHeader
        title="分析与报告"
        description="查看研究进度、图表与报告，或回到任务继续分析。"
      />
      {tasks.isPending ? (
        <p>正在加载科研任务…</p>
      ) : tasks.error ? (
        <p role="alert" className="agent-error">
          {tasks.error.message}
        </p>
      ) : tasks.data?.length ? (
        <div className="agent-task-list">
          {tasks.data.map((t) => (
            <Link key={t.id} to="/tasks/$taskId" params={{ taskId: t.id }}>
              <MessageSquare size={18} />
              <span>
                <strong>{t.title}</strong>
                <small>{new Date(t.created_at).toLocaleString("zh-CN")}</small>
              </span>
              <small>
                {t.artifacts && `${t.artifacts.length} 个文件 · `}
                {t.runs[t.runs.length - 1]
                  ? statusLabels[t.runs[t.runs.length - 1].status]
                  : "新任务"}
              </small>
              <ArrowUpRight size={17} />
            </Link>
          ))}
        </div>
      ) : (
        <div className="agent-empty">
          <FileText size={30} />
          <h2>暂无科研任务</h2>
          <p>从一个研究问题开始，生成的图表与报告会汇集到这里。</p>
          <Link to="/">
            开始研究 <ArrowUpRight size={15} />
          </Link>
        </div>
      )}
    </div>
  )
}
export function InferencePage() {
  return (
    <div className="agent-results-page">
      <span className="agent-eyebrow">VIDEO INFERENCE</span>
      <h1>Video inference</h1>
      <p>
        Generate masks, headings, and trajectories from experimental videos for
        analysis.
      </p>
      <section
        aria-label="Flagship vision model"
        className="mt-8 rounded-xl border border-border bg-muted/20 p-6"
      >
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-medium tracking-wide">
            {flagshipVisionModel.name}
          </h2>
          <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
            Flagship model
          </span>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Trained on{" "}
          {flagshipVisionModel.trainingImageCount.toLocaleString("zh-CN")}{" "}
          human-annotated images for animal behavior research.
        </p>
      </section>
      <div className="agent-inference-state">
        <ScanLine size={42} strokeWidth={1} />
        <h2>Video inference is not connected</h2>
        <p>
          Review existing offline results and annotations. This legacy preview
          does not submit inference tasks.
        </p>
        <Link to="/annotations">
          浏览视频 and existing results <ArrowUpRight size={16} />
        </Link>
      </div>
    </div>
  )
}
