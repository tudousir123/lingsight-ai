import { Link, useNavigate } from "@tanstack/react-router"
import { FolderOpen, Pencil, Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { statusLabels } from "./api"
import {
  membersOfKind,
  projectErrorText,
  useDeleteProject,
  useRemoveProjectMember,
  useRenameProject,
  useSaveProjectTasks,
  useWorkspaceProjects,
  type WorkspaceProject,
} from "./projects"
import { useTasks } from "./queries"

function ProjectTasks({
  project,
  tasksReady,
}: {
  project: WorkspaceProject
  tasksReady: Map<string, { title: string; status: string | undefined }>
}) {
  const members = membersOfKind(project, "agent_task")
  if (!members.length) return null
  return (
    <div className="agent-task-list">
      {members.map((member) => {
        const task = tasksReady.get(member.id)
        return (
          <Link
            to="/tasks/$taskId"
            params={{ taskId: member.id }}
            key={member.id}
          >
            <FolderOpen size={18} />
            <span>
              <strong>{task?.title ?? member.id}</strong>
              <small>科研任务</small>
            </span>
            <small>{task ? (task.status ?? "新任务") : "任务不可用"}</small>
          </Link>
        )
      })}
    </div>
  )
}

function ProjectVideos({ project }: { project: WorkspaceProject }) {
  const removeMember = useRemoveProjectMember()
  const members = membersOfKind(project, "video")
  if (!members.length) return null
  return (
    <section aria-labelledby="project-videos-title" className="space-y-2">
      <h2 id="project-videos-title" className="text-lg font-medium">
        归入项目的视频
      </h2>
      <ul className="agent-task-list">
        {members.map((member) => (
          <li
            key={member.id}
            className="flex items-center justify-between gap-3"
          >
            <Link to="/inference" className="flex items-center gap-3">
              <FolderOpen size={18} />
              <span>
                <strong>{member.label ?? member.id}</strong>
                <small>视频引用</small>
              </span>
            </Link>
            <button
              type="button"
              className="project-action"
              disabled={removeMember.isPending}
              aria-label={`移出视频 ${member.label ?? member.id}`}
              onClick={() =>
                removeMember.mutate({
                  projectId: project.id,
                  kind: "video",
                  id: member.id,
                })
              }
            >
              移出
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

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
  const tasksReady = new Map(
    (tasks.data ?? []).map((task) => [
      task.id,
      {
        title: task.title,
        status: task.runs.length
          ? statusLabels[task.runs[task.runs.length - 1].status]
          : undefined,
      },
    ]),
  )
  const taskMemberIds = membersOfKind(project, "agent_task").map(
    (member) => member.id,
  )
  const videoMembers = membersOfKind(project, "video")
  const closeEdit = () => {
    setEditing(false)
    setError("")
  }
  const closeRename = () => {
    setEditingName(false)
    setNameError("")
  }
  return (
    <div className="agent-results-page" lang="zh-CN">
      <span className="agent-eyebrow">科研项目</span>
      <h1 className="project-title">
        <FolderOpen size={24} />
        {project.name}
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
          <Pencil size={15} />
          重命名
        </button>
        <button
          type="button"
          aria-label="删除项目"
          className="project-action"
          onClick={() => {
            setDeleteError("")
            setConfirmingDelete(true)
          }}
        >
          <Trash2 size={15} />
          删除项目
        </button>
      </h1>
      <p>
        项目归集科研任务与视频引用，保存在你的平台账号中；移出项目不会删除任务或视频本体。
      </p>
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
        <Plus size={15} />
        整理任务
      </button>
      {tasks.error ? (
        <p role="alert">无法加载科研任务：{tasks.error.message}</p>
      ) : tasks.isPending ? (
        <p>正在加载科研任务…</p>
      ) : (
        <>
          <ProjectTasks project={project} tasksReady={tasksReady} />
          {!taskMemberIds.length && (
            <div className="agent-empty">
              <FolderOpen size={32} />
              <h2>为下一次发现留一个位置。</h2>
              <p>
                点击“整理任务”添加已有任务，或在“视频推理”页把视频归入项目。
              </p>
              <Link to="/">新建科研任务</Link>
            </div>
          )}
        </>
      )}
      <ProjectVideos project={project} />
      {videoMembers.length === 0 && taskMemberIds.length > 0 && (
        <p className="research-history-note">
          还没有归入视频。到“视频推理”页浏览目录时可将视频加入项目。
        </p>
      )}
      <Dialog
        open={editing}
        onOpenChange={(open) => (open ? null : closeEdit())}
      >
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
