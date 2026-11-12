import { Link } from "@tanstack/react-router"
import {
  ArrowRight,
  ChartNoAxesCombined,
  ChevronRight,
  Clapperboard,
  FolderOpen,
  MessageSquare,
  ScanLine,
} from "lucide-react"
import type { ReactNode } from "react"
import { statusLabels, type Task } from "./api"
import type { WorkspaceProject } from "./projects"
import "./workspace-home.css"

const examples = [
  {
    label: "探索轨迹与朝向",
    prompt: "分析指定水迷宫视频的游泳轨迹和头部朝向，请先向我确认视频 ID。",
  },
  {
    label: "核对动物身份",
    prompt:
      "分析前请先核对动物身份、训练日和有效试次；遇到不明确的科研口径，请向我确认。",
  },
  {
    label: "整理研究报告",
    prompt:
      "根据已有数据整理一份可编辑的研究报告，包含方法、图表、数据来源与局限性。",
  },
]

type WorkspaceHomeProps = {
  children: ReactNode
  tasks: Task[]
  tasksLoading: boolean
  tasksUnavailable: boolean
  projects: WorkspaceProject[]
  projectsLoading: boolean
  projectsUnavailable: boolean
  onStart: (prompt: string) => void
}

export function WorkspaceHome({
  children,
  tasks,
  tasksLoading,
  tasksUnavailable,
  projects,
  projectsLoading,
  projectsUnavailable,
  onStart,
}: WorkspaceHomeProps) {
  const waiting = tasks.filter(
    (task) => task.runs[task.runs.length - 1]?.status === "waiting_for_input",
  )
  const recentTasks = [
    ...waiting,
    ...tasks.filter(
      (task) => task.runs[task.runs.length - 1]?.status !== "waiting_for_input",
    ),
  ].slice(0, 4)

  return (
    <div className="workspace-start">
      <h1>科研工作台</h1>
      <div className="workspace-start-grid">
        <div className="workspace-start-main">
          <section aria-labelledby="workspace-question">
            <h2 id="workspace-question">发起科研任务</h2>
            {children}
            <fieldset className="workspace-examples" aria-label="示例问题">
              {examples.map(({ label, prompt }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => onStart(prompt)}
                >
                  {label}
                </button>
              ))}
            </fieldset>
          </section>
          <section
            className="workspace-tools"
            aria-labelledby="workspace-tools"
          >
            <h2 id="workspace-tools">视频与成果</h2>
            <Link to="/inference" className="workspace-tool">
              <span className="workspace-tool-icon">
                <Clapperboard size={18} />
              </span>
              <span>
                <strong>开始视频推理</strong>
                <small>选择实验视频，跟进逐帧识别进度</small>
              </span>
              <ArrowRight size={16} />
            </Link>
            <Link to="/annotations" className="workspace-tool">
              <span className="workspace-tool-icon">
                <ScanLine size={18} />
              </span>
              <span>
                <strong>浏览视频与标注</strong>
                <small>核查实验视频和标注</small>
              </span>
              <ArrowRight size={16} />
            </Link>
            <Link to="/analysis" className="workspace-tool">
              <span className="workspace-tool-icon">
                <ChartNoAxesCombined size={18} />
              </span>
              <span>
                <strong>查看图表与报告</strong>
                <small>回到科研任务，查看生成的成果</small>
              </span>
              <ArrowRight size={16} />
            </Link>
          </section>
        </div>
        <div className="workspace-start-side">
          <section
            className="workspace-panel"
            aria-labelledby="workspace-recent"
          >
            <div className="workspace-panel-heading">
              <h2 id="workspace-recent">最近任务</h2>
              {waiting.length > 0 && <span>{waiting.length} 项待确认</span>}
            </div>
            {recentTasks.length ? (
              <ul className="workspace-panel-list">
                {recentTasks.map((task) => {
                  const status = task.runs[task.runs.length - 1]?.status
                  return (
                    <li key={task.id}>
                      <Link to="/tasks/$taskId" params={{ taskId: task.id }}>
                        <MessageSquare size={16} />
                        <span>
                          <strong>{task.title}</strong>
                          <small
                            className={status ? `status-${status}` : undefined}
                          >
                            {status ? statusLabels[status] : "新任务"}
                          </small>
                        </span>
                        <ChevronRight size={15} />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="workspace-panel-note">
                {tasksLoading
                  ? "正在加载任务…"
                  : tasksUnavailable
                    ? "暂时无法查看任务。"
                    : "暂无科研任务。"}
              </p>
            )}
          </section>
          <section
            className="workspace-panel"
            aria-labelledby="workspace-projects"
          >
            <div className="workspace-panel-heading">
              <h2 id="workspace-projects">项目</h2>
            </div>
            {projects.length ? (
              <ul className="workspace-panel-list">
                {projects.slice(0, 3).map((project) => (
                  <li key={project.id}>
                    <Link
                      to="/projects/$projectId"
                      params={{ projectId: project.id }}
                      aria-label={`打开项目：${project.name}`}
                    >
                      <FolderOpen size={16} />
                      <span>
                        <strong>{project.name}</strong>
                      </span>
                      <ChevronRight size={15} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="workspace-panel-note">
                {projectsLoading
                  ? "正在加载项目…"
                  : projectsUnavailable
                    ? "暂时无法查看项目。"
                    : "可从侧栏新建项目，归集视频和科研任务。"}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
