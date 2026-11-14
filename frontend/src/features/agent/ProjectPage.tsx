import { Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeft, Pencil, Plus, Settings2, Trash2 } from "lucide-react"
import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { ProjectMaterials } from "./ProjectMaterials"
import {
  membersOfKind,
  projectErrorText,
  useDeleteProject,
  useRenameProject,
  useSaveProjectTasks,
  useWorkspaceProjects,
} from "./projects"
import { useTasks } from "./queries"

export function ProjectPage({ projectId }: { projectId: string }) {
  const store = useWorkspaceProjects()
  const tasks = useTasks()
  const navigate = useNavigate()
  const saveTasks = useSaveProjectTasks()
  const renameProject = useRenameProject()
  const deleteProject = useDeleteProject()
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState("")
  const [nameError, setNameError] = useState("")
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteError, setDeleteError] = useState("")
  const [error, setError] = useState("")
  if (store.isPending) return <p className="agent-empty">正在加载项目…</p>
  const project = store.data?.find((item) => item.id === projectId)
  if (!project)
    return (
      <div className="agent-empty">
        <h1>项目不可用</h1>
        <p>
          {store.error
            ? "无法加载项目，请稍后重试。"
            : "此项目不存在或已被删除。"}
        </p>
        <Link to="/">新建科研任务</Link>
      </div>
    )
  const taskMemberIds = membersOfKind(project, "agent_task").map(
    (member) => member.id,
  )
  const closeEdit = () => {
    setEditing(false)
    setError("")
  }
  const closeRename = () => {
    setEditingName(false)
    setNameError("")
  }
  return (
    <div className="agent-results-page project-materials" lang="zh-CN">
      <header className="project-details-header">
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          className="project-action"
        >
          <ArrowLeft size={15} /> 返回项目对话
        </Link>
        <div className="materials-heading">
          <div>
            <h1>项目资料</h1>
            <p>{project.name}</p>
          </div>
          <details className="materials-settings">
            <summary>
              <Settings2 size={16} /> 项目设置
            </summary>
            <div className="project-details-actions">
              <button
                type="button"
                aria-label="重命名项目"
                className="project-action"
                onClick={() => {
                  setNameDraft(project.name)
                  setNameError("")
                  setEditingName(true)
                }}
              >
                <Pencil size={15} /> 重命名
              </button>
              <button
                type="button"
                className="project-action"
                disabled={!tasks.data || !!tasks.error}
                onClick={() => {
                  setSelected(taskMemberIds)
                  setError("")
                  setEditing(true)
                }}
              >
                <Plus size={15} /> 整理对话
              </button>
              <button
                type="button"
                className="project-action"
                onClick={() => {
                  setDeleteError("")
                  setConfirmingDelete(true)
                }}
              >
                <Trash2 size={15} /> 删除项目
              </button>
              {tasks.error && <p role="alert">无法加载对话。</p>}
            </div>
          </details>
        </div>
      </header>
      <ProjectMaterials project={project} tasks={tasks.data ?? []} />
      <Dialog
        open={editing}
        onOpenChange={(open) => (open ? null : closeEdit())}
      >
        <DialogContent className="project-dialog">
          <DialogTitle>整理对话</DialogTitle>
          <DialogDescription>
            选择要归入“{project.name}”的对话。
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
          {!tasks.data?.length && <p>暂无对话。</p>}
          {error && (
            <p role="alert" className="agent-error">
              {error}
            </p>
          )}
          <button
            type="button"
            className="project-action"
            disabled={saveTasks.isPending}
            onClick={() =>
              saveTasks.mutate(
                { projectId, taskIds: selected },
                {
                  onSuccess: closeEdit,
                  onError: (mutationError) =>
                    setError(
                      projectErrorText(mutationError, "项目保存失败，请重试。"),
                    ),
                },
              )
            }
          >
            保存项目
          </button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={editingName}
        onOpenChange={(open) => (open ? null : closeRename())}
      >
        <DialogContent className="project-dialog">
          <DialogTitle>重命名项目</DialogTitle>
          <DialogDescription>
            为“{project.name}”输入新的项目名称。
          </DialogDescription>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              const name = nameDraft.trim()
              if (!name || name === project.name) {
                closeRename()
                return
              }
              renameProject.mutate(
                { projectId, name },
                {
                  onSuccess: closeRename,
                  onError: (mutationError) =>
                    setNameError(
                      projectErrorText(mutationError, "重命名失败，请重试。"),
                    ),
                },
              )
            }}
          >
            <label htmlFor="project-rename">项目名称</label>
            <input
              id="project-rename"
              maxLength={80}
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              required
            />
            {nameError && (
              <p role="alert" className="agent-error">
                {nameError}
              </p>
            )}
            <button
              className="project-action"
              type="submit"
              disabled={!nameDraft.trim() || renameProject.isPending}
            >
              保存名称
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={confirmingDelete}
        onOpenChange={(open) => (open ? null : setConfirmingDelete(false))}
      >
        <DialogContent className="project-dialog">
          <DialogTitle>删除项目</DialogTitle>
          <DialogDescription>
            将删除“{project.name}
            ”及其归组关系；任务与视频本体不受影响。此操作不可撤销。
          </DialogDescription>
          {deleteError && (
            <p role="alert" className="agent-error">
              {deleteError}
            </p>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              className="project-action"
              onClick={() => setConfirmingDelete(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="project-action"
              disabled={deleteProject.isPending}
              onClick={() =>
                deleteProject.mutate(projectId, {
                  onSuccess: () => void navigate({ to: "/" }),
                  onError: (mutationError) =>
                    setDeleteError(
                      projectErrorText(mutationError, "删除失败，请重试。"),
                    ),
                })
              }
            >
              确认删除
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
