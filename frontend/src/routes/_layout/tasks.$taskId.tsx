import { createFileRoute } from "@tanstack/react-router"
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
  return <AgentWorkspace taskId={taskId} projectContextId={project} />
}
