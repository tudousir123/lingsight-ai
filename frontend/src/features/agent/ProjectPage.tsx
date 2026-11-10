import { Link } from "@tanstack/react-router"
import { FolderOpen, Plus } from "lucide-react"
import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { statusLabels } from "./api"
import { useWorkspaceProjects } from "./projects"
import { useTasks } from "./queries"

export function ProjectPage({ projectId }: { projectId: string }) {
  const store = useWorkspaceProjects()
  const tasks = useTasks()
  const project = store.projects.find((item) => item.id === projectId)
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState("")
  if (store.isPending) return <p className="agent-empty">正在加载项目…</p>
  if (!project)
    return (
      <div className="agent-empty">
        <h1>项目不可用</h1>
        <p>
          {store.error
            ? "无法读取当前浏览器中保存的项目。"
            : "当前浏览器中未保存此项目。"}
        </p>
        <Link to="/">新建科研任务</Link>
      </div>
    )
  const members =
    tasks.data?.filter((task) => project.taskIds.includes(task.id)) ?? []
  return (
    <div className="agent-results-page" lang="zh-CN">
      <span className="agent-eyebrow">科研项目</span>
      <h1 className="project-title">
        <FolderOpen size={24} />
        {project.name}
      </h1>
      <p>将相关科研任务集中管理，项目归类保存在当前浏览器中。</p>
      <button
        type="button"
        className="project-action"
        disabled={!tasks.data || !!tasks.error}
        onClick={() => {
          setSelected(project.taskIds)
          setError("")
          setEditing(true)
        }}
      >
        <Plus size={15} />
        整理任务
      </button>
      {tasks.error ? (
        <p role="alert">{tasks.error.message}</p>
      ) : tasks.isPending ? (
        <p>正在加载科研任务…</p>
      ) : members.length ? (
        <div className="agent-task-list">
          {members.map((task) => (
            <Link
              to="/tasks/$taskId"
              params={{ taskId: task.id }}
              key={task.id}
            >
              <FolderOpen size={18} />
              <span>
                <strong>{task.title}</strong>
                <small>科研任务</small>
              </span>
              <small>
                {task.runs.length
                  ? statusLabels[task.runs[task.runs.length - 1].status]
                  : "新任务"}
              </small>
            </Link>
          ))}
        </div>
      ) : (
        <div className="agent-empty">
          <FolderOpen size={32} />
          <h2>为下一次发现留一个位置。</h2>
          <p>点击“整理任务”添加已有任务，或从新的研究问题开始。</p>
          <Link to="/">新建科研任务</Link>
        </div>
      )}
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="project-dialog">
          <DialogTitle>整理任务</DialogTitle>
          <DialogDescription>
            选择要归入“{project.name}”的任务。移出项目时，原始任务仍会保留。
          </DialogDescription>
          <div className="project-task-options">
            {tasks.data?.map((task) => (
              <label key={task.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(task.id)}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? [...selected, task.id]
                        : selected.filter((id) => id !== task.id),
                    )
                  }
                />
                <span>{task.title}</span>
              </label>
            ))}
          </div>
          {!tasks.data?.length && (
            <p>暂无科研任务。新建任务后即可在这里整理。</p>
          )}
          {error && (
            <p role="alert" className="agent-error">
              {error}
            </p>
          )}
          <button
            type="button"
            className="project-action"
            onClick={() => {
              try {
                store.save(
                  store.projects.map((item) =>
                    item.id === projectId
                      ? { ...item, taskIds: selected }
                      : item,
                  ),
                )
                setEditing(false)
              } catch (error) {
                setError(
                  error instanceof Error ? error.message : "项目保存失败。",
                )
              }
            }}
          >
            保存项目
          </button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
