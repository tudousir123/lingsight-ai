import { createFileRoute } from "@tanstack/react-router"
import { AgentWorkspace } from "@/features/agent/Workspace"
export const Route = createFileRoute("/_layout/tasks/$taskId")({
  component: TaskPage,
  head: () => ({ meta: [{ title: "研究任务 - LingSight Science" }] }),
})
function TaskPage() {
  const { taskId } = Route.useParams()
  return <AgentWorkspace taskId={taskId} />
}
