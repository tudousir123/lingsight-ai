import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import {
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  Circle,
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
import { consumeBrief, pendingBriefPrompt } from "@/features/research/entry"
import { flagshipVisionModel } from "@/features/research/vision-model"
import { ArtifactCards, ArtifactViewer } from "./Artifacts"
import {
  type Artifact,
  agentJson,
  download,
  isActive,
  type Question,
  type Run,
  statusLabels,
  type Task,
  type TaskEvent,
  taskKey,
  tasksKey,
} from "./api"
import { useTaskEvents } from "./events"
import { useTasks } from "./queries"
import { WorkspaceHome } from "./WorkspaceHome"
import "./workspace.css"

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
            {blocks.map((block) => (
              <div
                key={block.key}
                className={
                  block.kind === "user" ? "agent-user-message" : "agent-answer"
                }
              >
                {block.text}
              </div>
            ))}
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
}: {
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
        if (!answer.trim() || pending) return
        setPending(true)
        setError("")
        try {
          await agentJson(
            `runs/${run.id}/clarifications/${question.id}/answer`,
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
      />
      <button type="submit" disabled={!answer.trim() || pending}>
        {pending ? "正在提交…" : "确认并继续"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  )
}
export function AgentWorkspace({ taskId = "" }: { taskId?: string }) {
  const tasks = useTasks()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [artifact, setArtifact] = useState<Artifact | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const task = useQuery({
    queryKey: taskKey(taskId),
    queryFn: ({ signal }) =>
      agentJson<Task>(`tasks/${taskId}`, undefined, "GET", signal),
    enabled: !!taskId,
    refetchInterval: 2500,
    retry: false,
  })
  const stream = useTaskEvents(taskId)
  const run = task.data?.runs[task.data.runs.length - 1]
  useEffect(() => {
    setDraft(taskId ? "" : pendingBriefPrompt())
    setError("")
    setArtifact(null)
  }, [taskId])
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: tasksKey })
    void queryClient.invalidateQueries({ queryKey: taskKey(taskId) })
  }
  const send = async () => {
    if (!draft.trim() || pending) return
    const text = draft.trim()
    setPending(true)
    setError("")
    try {
      if (taskId) await agentJson(`tasks/${taskId}/messages`, { text })
      else {
        const created = await agentJson<{ task: Task }>("tasks", { goal: text })
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
    if (!run || pending) return
    setPending(true)
    setError("")
    try {
      await agentJson(`runs/${run.id}/${op}`, {})
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成，请重试。")
    } finally {
      setPending(false)
    }
  }
  const start = (text: string) => {
    setDraft(text)
    input.current?.focus()
  }
  const blocked = run?.status === "waiting_for_input"
  const serviceError = tasks.error?.message
  return (
    <div
      className={`agent-workbench ${taskId ? "" : "agent-home"}`}
      lang="zh-CN"
    >
      <div className="agent-workspace">
        <div className="agent-scroll-area">
          <div className="agent-content">
            {!taskId ? (
              <WorkspaceHome recentTask={tasks.data?.[0]} onStart={start} />
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
                        disabled={pending}
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
                            `tasks/${taskId}/bundle`,
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
              <span>实验数据</span>
              <span className="agent-context-dot" />
              <span>科研任务</span>
              {taskId && (
                <span className="agent-background-note">
                  离开页面后任务仍会继续运行
                </span>
              )}
            </div>
            <textarea
              ref={input}
              value={draft}
              maxLength={12000}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="研究问题"
              placeholder={
                blocked
                  ? "请先回答上方科研口径问题后继续"
                  : "描述你的研究问题，或提供需要分析的视频 ID…"
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
              <Link to="/annotations" title="浏览实验与视频">
                <Video size={17} />
                <span>浏览视频</span>
              </Link>
              <span className="agent-model-label">
                <Sparkles size={14} />
                灵视科研助手
              </span>
              <div className="agent-send-actions">
                {run &&
                  (isActive(run.status) || run.status === "interrupted") && (
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
                  disabled={
                    !draft.trim() ||
                    pending ||
                    blocked ||
                    !!tasks.error ||
                    !!task.error
                  }
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
          <p className="agent-composer-note">
            基于实验数据开展分析 · 关键科研口径由你确认
          </p>
        </div>
        {artifact && (
          <ArtifactViewer
            key={artifact.id}
            artifact={artifact}
            taskId={taskId}
            onClose={() => setArtifact(null)}
          />
        )}
      </div>
      {taskId && (
        <aside className="agent-overview" aria-label="研究概览">
          <h2>
            <PanelRight size={16} strokeWidth={1.5} />
            概览
          </h2>
          {run && (
            <div className="agent-overview-status">
              <span>当前任务</span>
              <strong>{statusLabels[run.status]}</strong>
            </div>
          )}
          <p>科研流程</p>
          <ol>
            {[
              "确定实验范围",
              "核验数据来源",
              "确认科研口径",
              "分析行为指标",
              "整理研究发现",
            ].map((step) => (
              <li key={step}>
                <Circle size={11} strokeWidth={1.3} />
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <div className="agent-overview-note">
            从问题出发，确认分析计划，跟进研究过程，保留全部成果。
          </div>
        </aside>
      )}
    </div>
  )
}

export function AnalysisPage() {
  const tasks = useTasks()
  return (
    <div className="agent-results-page">
      <span className="agent-eyebrow">研究成果</span>
      <h1>分析与报告</h1>
      <p>查看研究进度、图表与报告，或回到任务继续分析。</p>
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
