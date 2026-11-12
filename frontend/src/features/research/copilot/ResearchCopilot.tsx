import {
  ArrowUp,
  ChartNoAxesCombined,
  Check,
  Circle,
  Clapperboard,
  Download,
  FolderOpen,
  LoaderCircle,
  Plus,
  Sparkles,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { consumeBrief, pendingBriefPrompt } from "../entry"
import {
  type AnalysisMode,
  createMockResearchTools,
  hasComparableDays,
  type InferenceRun,
  type ResearchProject,
  type ResearchReport,
  type ResearchTools,
  type ResearchVideo,
  type VideoSource,
} from "./tools"
import { VideoPicker } from "./VideoPicker"
import "./copilot.css"

type Phase = "start" | "videos" | "ready" | "analysis" | "done"

type Message = {
  id: number
  role: "user" | "agent" | "tool"
  text: string
}

const samplePrompts = [
  {
    label: "从网盘比较训练日",
    prompt:
      "创建「水迷宫训练日对比」项目，从网盘选择视频，推理后比较第 1 天和第 5 天的逃逸潜伏期及路径长度。",
  },
  {
    label: "从本地分析视频",
    prompt:
      "创建「水迷宫视频分析」项目，选择本地视频，推理后逐视频汇总逃逸潜伏期和路径长度。",
  },
]

function projectName(text: string) {
  const named = text.match(/(?:「([^」]+)」|“([^”]+)”|"([^"]+)")\s*(?:的)?项目/)
  return (
    (named?.[1] ?? named?.[2] ?? named?.[3] ?? "水迷宫视频分析")
      .trim()
      .slice(0, 80) || "水迷宫视频分析"
  )
}

function requestedSource(text: string): VideoSource | null {
  if (/本地|电脑|local/i.test(text)) return "local"
  if (/网盘|NAS|云盘/i.test(text)) return "cloud"
  return null
}

function requestedAnalysis(text: string): AnalysisMode | null {
  if (/逐视频|按视频|每段视频/.test(text)) return "video"
  if (/训练日|按天|第\s*\d+\s*天/.test(text)) return "day"
  return null
}

function downloadReport(report: ResearchReport) {
  const csvCell = (value: string) => {
    const escaped = /^[\t\r\n =+\-@]/.test(value) ? `'${value}` : value
    return `"${escaped.replace(/"/g, '""')}"`
  }
  const rows = report.rows.map((row) =>
    [
      csvCell(row.label),
      row.count,
      row.latency.toFixed(1),
      row.pathLength.toFixed(1),
    ].join(","),
  )
  const blob = new Blob(
    [
      "\ufeff",
      [
        "范围（模拟）",
        "视频数",
        "平均逃逸潜伏期（秒）",
        "平均路径长度（厘米）",
      ].join(","),
      "\n",
      rows.join("\n"),
    ],
    { type: "text/csv;charset=utf-8" },
  )
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = "lingsight-simulated-analysis.csv"
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function ReportCard({ report }: { report: ResearchReport }) {
  return (
    <section
      className="copilot-card copilot-report"
      aria-labelledby="copilot-report-heading"
    >
      <div className="copilot-card-title">
        <ChartNoAxesCombined size={19} />
        <h2 id="copilot-report-heading">
          {report.mode === "day" ? "训练日对比" : "逐视频汇总"}
        </h2>
        <span>模拟结果</span>
      </div>
      <div className="copilot-table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">范围</th>
              <th scope="col">视频数</th>
              <th scope="col">潜伏期均值（秒）</th>
              <th scope="col">路径长度均值（厘米）</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row, index) => (
              <tr key={`${row.label}-${index}`}>
                <th scope="row">{row.label}</th>
                <td>{row.count}</td>
                <td>{row.latency.toFixed(1)}</td>
                <td>{row.pathLength.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="copilot-card-footer">
        <span>按视频汇总模拟指标，可用于体验报告流程。</span>
        <button
          className="copilot-button"
          type="button"
          onClick={() => downloadReport(report)}
        >
          <Download size={16} /> 导出 CSV
        </button>
      </div>
    </section>
  )
}

export function ResearchCopilot({
  tools: providedTools,
}: {
  tools?: ResearchTools
}) {
  const [mockTools] = useState(createMockResearchTools)
  const tools = providedTools ?? mockTools
  const [phase, setPhase] = useState<Phase>("start")
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState(pendingBriefPrompt)
  const [project, setProject] = useState<ResearchProject | null>(null)
  const [source, setSource] = useState<VideoSource | null>(null)
  const [videos, setVideos] = useState<ResearchVideo[]>([])
  const [inference, setInference] = useState<InferenceRun | null>(null)
  const [preferredAnalysis, setPreferredAnalysis] =
    useState<AnalysisMode | null>(null)
  const [report, setReport] = useState<ResearchReport | null>(null)
  const [activeTool, setActiveTool] = useState("")
  const [processed, setProcessed] = useState(0)
  const [error, setError] = useState("")
  const input = useRef<HTMLTextAreaElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const running = useRef(false)
  const sequence = useRef(0)

  function addMessage(role: Message["role"], text: string) {
    const id = sequence.current++
    setMessages((current) => [...current, { id, role, text }])
  }

  useEffect(() => {
    const panel = scroll.current
    if (panel && messages.length) panel.scrollTop = panel.scrollHeight
  }, [messages])

  async function runTool(label: string, execute: () => Promise<void>) {
    if (running.current) return
    running.current = true
    setActiveTool(label)
    setError("")
    try {
      await execute()
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "工具执行失败，请重试。",
      )
    } finally {
      running.current = false
      setActiveTool("")
    }
  }

  function createProject(text: string) {
    void runTool("创建项目", async () => {
      const created = await tools.create_project({ name: projectName(text) })
      setProject(created)
      setSource(requestedSource(text))
      setPreferredAnalysis(requestedAnalysis(text))
      setPhase("videos")
      addMessage("tool", `已创建项目「${created.name}」`)
      addMessage(
        "agent",
        "选出这次要分析的视频。选好后，我会把它们归入当前项目。",
      )
    })
  }

  function confirmVideos(chosen: ResearchVideo[]) {
    if (!project || !chosen.length) return
    void runTool("归集视频", async () => {
      const added = await tools.add_project_videos({
        projectId: project.id,
        videos: chosen,
      })
      setVideos(added)
      setPhase("ready")
      addMessage(
        "tool",
        `已归集 ${added.length} 个${source === "cloud" ? "网盘示例" : "本地"}视频`,
      )
      addMessage("agent", "视频范围已确认。现在可以开始逐视频推理。")
    })
  }

  function infer() {
    if (!project || !videos.length || phase !== "ready") return
    setProcessed(0)
    void runTool("视频推理", async () => {
      const inferred = await tools.run_video_inference(
        { projectId: project.id },
        setProcessed,
      )
      setInference(inferred)
      setPhase("analysis")
      addMessage("tool", `模拟推理完成 · ${inferred.videoCount} 个视频`)
      addMessage("agent", "可以汇总逃逸潜伏期和路径长度。请选择统计口径。")
    })
  }

  function analyze(mode: AnalysisMode) {
    if (!project || !inference || (phase !== "analysis" && phase !== "done"))
      return
    if (mode === "day" && !hasComparableDays(videos)) {
      setError(
        "按训练日对比需要每个视频的训练日信息，以及至少两个训练日。可以先按视频汇总。",
      )
      return
    }
    void runTool("统计分析", async () => {
      const analyzed = await tools.analyze_results({
        projectId: project.id,
        inferenceId: inference.id,
        mode,
      })
      setReport(analyzed)
      setPhase("done")
      addMessage("tool", "统计汇总已生成")
      addMessage(
        "agent",
        "结果已汇总在下方，可以查看各组视频数、潜伏期和路径长度，也可以导出 CSV。",
      )
    })
  }

  function send() {
    const text = draft.trim()
    if (!text || running.current) return
    setDraft("")
    setError("")
    addMessage("user", text)
    if (phase === "start") {
      if (/项目|视频|水迷宫|推理|潜伏期|轨迹/.test(text)) {
        consumeBrief()
        createProject(text)
      } else {
        addMessage(
          "agent",
          "告诉我你想分析哪些实验视频、想比较什么，我会帮你开始。",
        )
      }
    } else if (phase === "videos") {
      const requested = requestedSource(text)
      const mode = requestedAnalysis(text)
      if (mode) setPreferredAnalysis(mode)
      if (requested) setSource(requested)
      addMessage(
        "agent",
        requested
          ? "请在选择卡片中确认本次使用的视频。"
          : "请先选择网盘或本地视频，并将选中的视频加入项目。",
      )
    } else if (phase === "ready") {
      const mode = requestedAnalysis(text)
      if (mode) setPreferredAnalysis(mode)
      if (
        /^(?:请|帮我)?(?:现在)?(?:开始|启动|执行)(?:视频)?推理[。！!]?$/u.test(
          text,
        )
      )
        infer()
      else
        addMessage(
          "agent",
          "当前视频已归入项目。确认开始推理后，我会准备可供统计的结果。",
        )
    } else {
      if (/^(?:请|帮我)?按视频汇总[。！!]?$/u.test(text)) analyze("video")
      else if (/^(?:请|帮我)?按训练日对比[。！!]?$/u.test(text)) analyze("day")
      else
        addMessage(
          "agent",
          "目前可按视频汇总，或按训练日对比逃逸潜伏期和路径长度。",
        )
    }
  }

  function reset() {
    if (running.current) return
    setPhase("start")
    setMessages([])
    setDraft("")
    setProject(null)
    setSource(null)
    setVideos([])
    setInference(null)
    setPreferredAnalysis(null)
    setReport(null)
    setProcessed(0)
    setError("")
    input.current?.focus()
  }

  const comparable = hasComparableDays(videos)
  const progress = [!!project, !!videos.length, !!inference, !!report]
  const steps = [
    { title: "研究项目", detail: project?.name ?? "待创建" },
    {
      title: "视频范围",
      detail: videos.length ? `${videos.length} 个视频` : "待选择",
    },
    {
      title: "视频推理",
      detail: inference ? `${inference.videoCount} 个视频已处理` : "待执行",
    },
    { title: "统计分析", detail: report ? "报告已生成" : "待确认口径" },
  ]

  const composer = (
    <form
      className="copilot-composer"
      onSubmit={(event) => {
        event.preventDefault()
        send()
      }}
    >
      <textarea
        ref={input}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        aria-label="研究目标"
        maxLength={3000}
        placeholder={
          phase === "start"
            ? "例如：分析水迷宫训练视频，比较第 1 天和第 5 天的逃逸潜伏期"
            : "补充要求，或告诉我下一步怎么做…"
        }
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault()
            send()
          }
        }}
      />
      <div>
        <span>
          <Sparkles size={15} /> 灵视科研助手 · 模拟工具
        </span>
        <button
          type="submit"
          aria-label="发送研究目标"
          disabled={!draft.trim() || !!activeTool}
        >
          <ArrowUp size={20} />
        </button>
      </div>
    </form>
  )

  return (
    <div className="copilot" lang="zh-CN">
      <div className="copilot-chat">
        <div className="copilot-thread" ref={scroll}>
          <div className="copilot-inner">
            {messages.length === 0 ? (
              <div className="copilot-intro">
                <div className="copilot-emblem">
                  <Sparkles size={25} strokeWidth={1.6} />
                </div>
                <h1>这次想分析什么？</h1>
                <p>说出你的研究目标。项目、视频和结果都在这场对话里。</p>
                {composer}
                <div className="copilot-controls">
                  {samplePrompts.map(({ label, prompt }) => (
                    <button
                      key={label}
                      className="copilot-button"
                      type="button"
                      onClick={() => {
                        setDraft(prompt)
                        input.current?.focus()
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div className="copilot-thread-header">
                  <h1 className="copilot-thread-title">
                    {project?.name ?? "新的研究对话"}
                  </h1>
                  <button
                    type="button"
                    className="copilot-button"
                    onClick={reset}
                    disabled={!!activeTool}
                  >
                    <Plus size={16} /> 新对话
                  </button>
                </div>
                {messages.map((message) => (
                  <p
                    key={message.id}
                    className={`copilot-message copilot-${message.role}`}
                  >
                    {message.role === "tool" && <Check size={15} />}
                    <span>{message.text}</span>
                  </p>
                ))}
                {phase === "videos" && (
                  <VideoPicker
                    source={source}
                    onSourceChange={setSource}
                    onConfirm={confirmVideos}
                    tools={tools}
                    busy={!!activeTool}
                  />
                )}
                {!activeTool && phase === "ready" && (
                  <section
                    className="copilot-card"
                    aria-labelledby="copilot-infer-heading"
                  >
                    <div className="copilot-card-title">
                      <Clapperboard size={19} />
                      <h2 id="copilot-infer-heading">推理范围</h2>
                    </div>
                    <ul className="copilot-scope-list">
                      {videos.map((video) => (
                        <li key={video.id}>{video.name}</li>
                      ))}
                    </ul>
                    <div className="copilot-card-footer">
                      <span>{videos.length} 个视频 · 模拟执行</span>
                      <button
                        type="button"
                        className="copilot-button copilot-primary"
                        onClick={infer}
                      >
                        开始推理
                      </button>
                    </div>
                  </section>
                )}
                {activeTool && (
                  <div className="copilot-card copilot-running" role="status">
                    <span>
                      <LoaderCircle size={17} className="animate-spin" /> 正在
                      {activeTool}…
                    </span>
                    {activeTool === "视频推理" && (
                      <>
                        <progress
                          aria-label="视频推理进度"
                          max={videos.length}
                          value={processed}
                        />
                        <small>
                          已处理 {processed} / {videos.length} 个视频
                        </small>
                      </>
                    )}
                  </div>
                )}
                {!activeTool && phase === "analysis" && (
                  <section
                    className="copilot-card"
                    aria-labelledby="copilot-analysis-heading"
                  >
                    <div className="copilot-card-title">
                      <ChartNoAxesCombined size={19} />
                      <h2 id="copilot-analysis-heading">确认统计口径</h2>
                    </div>
                    {!comparable && (
                      <p>
                        按训练日对比需要为全部视频标记训练日，且至少有两个训练日。
                      </p>
                    )}
                    <div className="copilot-controls">
                      <button
                        type="button"
                        className={`copilot-button ${preferredAnalysis === "video" || !comparable ? "copilot-primary" : ""}`}
                        onClick={() => analyze("video")}
                      >
                        按视频汇总
                      </button>
                      <button
                        type="button"
                        className={`copilot-button ${preferredAnalysis === "day" && comparable ? "copilot-primary" : ""}`}
                        disabled={!comparable}
                        onClick={() => analyze("day")}
                      >
                        按训练日对比
                      </button>
                    </div>
                  </section>
                )}
                {report && <ReportCard report={report} />}
                {error && (
                  <p className="copilot-error" role="alert">
                    {error}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
        {messages.length > 0 && (
          <div className="copilot-bottom">{composer}</div>
        )}
      </div>
      <aside className="copilot-context" aria-label="项目进度">
        <div className="copilot-context-title">
          <FolderOpen size={17} />
          <h2>本次研究</h2>
        </div>
        <ol>
          {steps.map(({ title, detail }, index) => (
            <li key={title}>
              {progress[index] ? <Check size={16} /> : <Circle size={13} />}
              <span>
                <strong>{title}</strong>
                <small>{detail}</small>
              </span>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  )
}
