import { Link } from "@tanstack/react-router"
import {
  ArrowRight,
  ArrowUpRight,
  ChartNoAxesCombined,
  Compass,
  Database,
  Files,
  ScanLine,
} from "lucide-react"
import { statusLabels, type Task } from "./api"
import "./workspace-home.css"

/** Decorative study schematic; it does not represent experimental results. */
function MazeSketch() {
  return (
    <svg
      className="home-maze-sketch"
      viewBox="0 0 320 240"
      fill="none"
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeWidth="1.2">
        <ellipse cx="163" cy="125" rx="109" ry="78" opacity=".25" />
        <ellipse cx="163" cy="116" rx="109" ry="78" />
        <ellipse cx="163" cy="116" rx="98" ry="68" opacity=".35" />
        <path
          d="M54 116v9m218-9v9M163 38v156M54 116h218"
          strokeDasharray="3 5"
          opacity=".24"
        />
        <ellipse cx="201" cy="87" rx="14" ry="10" strokeDasharray="3 3" />
        <path
          d="M92 160c-25-25-10-67 17-85 32-21 99-17 125 15s-1 68-32 73-73-8-77-32 22-50 48-43 31 32 15 43-39 0-30-16 25-15 43-28"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="m156 18 7-10 7 10zM286 113l10 7-10 7zM36 113l-9 7 9 7z"
          opacity=".55"
        />
        <path
          d="M75 42v10m-5-5h10M266 181v10m-5-5h10M49 201v6m-3-3h6"
          opacity=".5"
        />
        <path d="M97 208h132m-119 5h106" opacity=".18" />
      </g>
      <circle cx="92" cy="160" r="3.5" fill="currentColor" />
      <circle cx="201" cy="87" r="3" fill="currentColor" />
    </svg>
  )
}

export function WorkspaceHome({
  recentTask,
  onStart,
}: {
  recentTask?: Task
  onStart: (prompt: string) => void
}) {
  const recentRun = recentTask?.runs[recentTask.runs.length - 1]
  return (
    <div className="agent-welcome">
      <div className="agent-home-brand">
        <ScanLine size={17} strokeWidth={1.4} />
        <span>LingSight 灵视科研</span>
        <span className="home-brand-divider" />
        <span className="home-brand-caption">你的科研伙伴</span>
      </div>
      <div className="agent-intro">
        <h1>从实验数据，开启新的探索。</h1>
        <p>探索动物行为，梳理研究问题，让每一次发现都有据可循。</p>
      </div>
      <div className="home-discovery-grid">
        <button
          type="button"
          className="home-discovery-card home-research-card"
          onClick={() =>
            onStart(
              "比较不同训练日的行为变化。请先核验动物映射和有效试次，不同批次分开分析。",
            )
          }
        >
          <span className="home-card-heading">
            探索实验数据 <ArrowUpRight size={17} />
          </span>
          <span className="home-card-description">
            从水迷宫轨迹出发
            <br />
            寻找值得深入的研究问题。
          </span>
          <MazeSketch />
          <span className="home-card-footer">
            <span className="home-card-dot" /> 开始科研任务{" "}
            <ArrowRight size={14} />
          </span>
        </button>
        <Link to="/onboarding" className="home-discovery-card home-guide-card">
          <span className="home-card-kicker">研究指南</span>
          <span className="home-card-heading">
            找到你的研究起点 <ArrowUpRight size={16} />
          </span>
          <span className="home-card-description">
            了解工作区
            <br />
            开启科研第一步。
          </span>
          <Compass
            className="home-card-sketch"
            size={84}
            strokeWidth={0.7}
            aria-hidden="true"
          />
        </Link>
        <Link to="/analysis" className="home-discovery-card home-outputs-card">
          <span className="home-card-kicker">继续探索</span>
          <span className="home-card-heading">
            汇集你的研究成果 <ArrowUpRight size={16} />
          </span>
          <span className="home-card-description">
            回顾图表与报告
            <br />
            让发现持续积累。
          </span>
          <Files
            className="home-card-sketch"
            size={78}
            strokeWidth={0.7}
            aria-hidden="true"
          />
        </Link>
      </div>
      <div className="home-section-heading">
        也可以从一个问题开始 <span>选择示例，按需修改</span>
      </div>
      <div className="agent-workflow-options">
        <button
          type="button"
          onClick={() =>
            onStart(
              "帮我查找研究所需的实验数据和已有视频结果，请先确认实验范围。",
            )
          }
        >
          <Database size={14} />
          <span>查找实验数据</span>
        </button>
        <button
          type="button"
          onClick={() =>
            onStart(
              "分析前请先核对动物身份、训练日和有效试次；遇到不明确的科研口径，请向我确认。",
            )
          }
        >
          <ScanLine size={14} />
          <span>核对动物身份</span>
        </button>
        <button
          type="button"
          onClick={() =>
            onStart(
              "根据已有数据整理一份可编辑的研究报告，包含方法、图表、数据来源与局限性。",
            )
          }
        >
          <ChartNoAxesCombined size={14} />
          <span>整理研究报告</span>
        </button>
      </div>
      {recentTask && (
        <Link
          to="/tasks/$taskId"
          params={{ taskId: recentTask.id }}
          className="agent-continue-task"
          aria-label={`继续任务： ${recentTask.title}`}
        >
          <span className="home-recent-label">继续上次的研究</span>
          <span className="home-recent-title">
            <strong>{recentTask.title}</strong>
            <small>
              {recentRun ? statusLabels[recentRun.status] : "新任务"}
            </small>
          </span>
          <ArrowRight size={16} />
        </Link>
      )}
    </div>
  )
}
