import { Link } from "@tanstack/react-router"
import {
  ArrowRight,
  ArrowUpRight,
  ChartNoAxesCombined,
  Clock3,
  Database,
  MessageSquare,
  ScanLine,
  Video,
} from "lucide-react"
import type { ReactNode } from "react"
import { statusLabels, type Task } from "./api"
import "./workspace-home.css"

const suggestions = [
  {
    icon: Database,
    label: "查找实验数据",
    prompt: "帮我查找研究所需的实验数据和已有视频结果，请先确认实验范围。",
  },
  {
    icon: ScanLine,
    label: "核对动物身份",
    prompt:
      "分析前请先核对动物身份、训练日和有效试次；遇到不明确的科研口径，请向我确认。",
  },
  {
    icon: ChartNoAxesCombined,
    label: "整理研究报告",
    prompt:
      "根据已有数据整理一份可编辑的研究报告，包含方法、图表、数据来源与局限性。",
  },
]

const tools = [
  {
    icon: Video,
    label: "视频推理",
    description: "选择视频，查看推理状态",
    to: "/inference",
  },
  {
    icon: ScanLine,
    label: "视频标注",
    description: "浏览试次，核对实验标注",
    to: "/annotations",
  },
  {
    icon: ChartNoAxesCombined,
    label: "分析与报告",
    description: "查看图表、数据与研究报告",
    to: "/analysis",
  },
] as const

export function WorkspaceHome({
  composer,
  recentTasks,
  recentState,
  onStart,
}: {
  composer: ReactNode
  recentTasks: Task[]
  recentState: "loading" | "error" | "ready"
  onStart: (prompt: string) => void
}) {
  return (
    <div>
      <div className="workspace-home-intro">
        <h1>从实验数据，开启新的探索。</h1>
        <p>提出研究问题，跟进分析过程，查看图表和报告。</p>
      </div>

      <div className="workspace-home-grid">
        <section
          className="workspace-home-start"
          aria-labelledby="workspace-question-title"
        >
          <h2 id="workspace-question-title">
            <MessageSquare size={17} />
            新建科研任务
          </h2>
          {composer}
          <div className="workspace-home-examples">
            <h3>示例问题</h3>
            <div className="workspace-home-suggestions">
              {suggestions.map(({ icon: Icon, label, prompt }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => onStart(prompt)}
                >
                  <Icon size={15} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <div className="workspace-home-side">
          <section
            className="workspace-home-panel"
            aria-labelledby="workspace-recent-title"
          >
            <h2 id="workspace-recent-title">
              <Clock3 size={16} />
              最近科研任务
            </h2>
            {recentTasks.length > 0 ? (
              <ul>
                {recentTasks.map((task) => {
                  const run = task.runs[task.runs.length - 1]
                  return (
                    <li key={task.id}>
                      <Link
                        to="/tasks/$taskId"
                        params={{ taskId: task.id }}
                        className="workspace-home-row workspace-home-task"
                      >
                        <span className="workspace-home-task-title">
                          {task.title}
                        </span>
                        <span
                          className={`agent-run-status ${run ? `status-${run.status}` : ""}`}
                        >
                          {run ? statusLabels[run.status] : "新任务"}
                        </span>
                        <ArrowRight size={15} />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="workspace-home-empty" role="status">
                {recentState === "loading"
                  ? "正在加载科研任务…"
                  : recentState === "error"
                    ? "暂时无法加载科研任务。"
                    : "开始研究后，任务和进度会显示在这里。"}
              </p>
            )}
          </section>

          <section
            className="workspace-home-panel workspace-home-tools"
            aria-labelledby="workspace-tools-title"
          >
            <h2 id="workspace-tools-title">常用工具</h2>
            <ul>
              {tools.map(({ icon: Icon, label, description, to }) => (
                <li key={to}>
                  <Link
                    to={to}
                    className="workspace-home-row workspace-home-tool"
                  >
                    <span className="workspace-home-tool-icon">
                      <Icon size={18} />
                    </span>
                    <span className="workspace-home-tool-text">
                      <strong>{label}</strong>
                      <span>{description}</span>
                    </span>
                    <ArrowUpRight size={15} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
