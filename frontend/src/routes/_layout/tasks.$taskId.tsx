import { createFileRoute } from "@tanstack/react-router"
import { useWorkspaceProjects } from "@/features/agent/projects"
import { VideoWorkflowConversation } from "@/features/agent/VideoWorkflowConversation"
import { useVideoWorkflows } from "@/features/agent/videoWorkflow"
import { AgentWorkspace } from "@/features/agent/Workspace"

export const Route = createFileRoute("/_layout/tasks/$taskId")({
  validateSearch: (search: Record<string, unknown>): { project?: string } =>
    typeof search.project === "string" ? { project: search.project } : {},
  component: TaskPage,
  head: () => ({ meta: [{ title: "研究任务 - LingSight Science" }] }),
})

function TaskPage() {
  const { taskId } = Route.useParams()
  const { project } = Route.useSearch()
  const flow = useVideoWorkflows().find((item) => item.id === taskId)
  const projects = useWorkspaceProjects()
  if (flow) {
    return (
      <VideoWorkflowConversation
        key={taskId}
        flow={flow}
        projectName={
          projects.data?.find((item) => item.id === flow.projectId)?.name
        }
      />
    )
  }
  return <AgentWorkspace taskId={taskId} projectContextId={project} />
}
