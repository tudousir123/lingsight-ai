import { Link } from "@tanstack/react-router"
import { ChevronRight, FolderOpen, MessageSquare } from "lucide-react"
import { statusLabels, type Task } from "./api"
import { membersOfKind, type WorkspaceProject } from "./projects"
import { useVideoWorkflows, videoWorkflowTask } from "./videoWorkflow"
import "./project-conversations.css"

export function ProjectConversationHome({
  project,
  tasks,
  tasksLoading,
  tasksUnavailable,
}: {
  project: WorkspaceProject
  tasks: Task[]
  tasksLoading: boolean
  tasksUnavailable: boolean
}) {
  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  const previewConversations = useVideoWorkflows()
    .filter((flow) => flow.projectId === project.id)
    .map(videoWorkflowTask)
  const previewMembers = previewConversations.map((task) => ({
    id: task.id,
    label: task.title,
    added_at: task.created_at,
  }))
  const conversations = [
    ...membersOfKind(project, "agent_task"),
    ...previewMembers,
  ]
    .map((member) => ({ member, task: tasksById.get(member.id) }))
    .sort((a, b) =>
      (b.task?.created_at ?? b.member.added_at ?? "").localeCompare(
        a.task?.created_at ?? a.member.added_at ?? "",
      ),
    )

  return (
    <div className="project-conversations">
      <header className="project-conversations-heading">
        <h1>
          <FolderOpen size={22} />
          {project.name}
        </h1>
        <Link
          className="project-materials-link"
          to="/projects/$projectId"
          params={{ projectId: project.id }}
          search={{ view: "details" }}
        >
          项目资料
        </Link>
      </header>
      <section aria-labelledby="project-conversations-title">
        <h2 id="project-conversations-title">项目对话</h2>
        {tasksLoading || tasksUnavailable ? (
          <p className="project-conversations-empty">
            {tasksLoading ? "正在加载对话…" : "对话暂时无法加载。"}
          </p>
        ) : conversations.length > 0 ? (
          <ul className="project-conversation-list">
            {conversations.map(({ member, task }) => {
              const run = task?.runs[task.runs.length - 1]
              return (
                <li key={member.id}>
                  <Link
                    to="/tasks/$taskId"
                    params={{ taskId: member.id }}
                    search={{ project: project.id }}
                  >
                    <MessageSquare size={17} aria-hidden="true" />
                    <span className="project-conversation-name">
                      {task?.title ?? member.label ?? "未命名对话"}
                    </span>
                    <span
                      className={`project-conversation-status ${run ? `status-${run.status}` : ""}`}
                    >
                      {run
                        ? statusLabels[run.status]
                        : task
                          ? "新对话"
                          : "暂不可用"}
                    </span>
                    <ChevronRight size={15} aria-hidden="true" />
                  </Link>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="project-conversations-empty">
            暂无对话，从下方输入框开始。
          </p>
        )}
      </section>
    </div>
  )
}
