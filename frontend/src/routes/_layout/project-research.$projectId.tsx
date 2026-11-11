import { createFileRoute } from "@tanstack/react-router"
import { AgentWorkspace } from "@/features/agent/Workspace"

export const Route = createFileRoute("/_layout/project-research/$projectId")({
  component: ProjectResearch,
  head: () => ({ meta: [{ title: "项目研究 - LingSight Science" }] }),
})

function ProjectResearch() {
  return <AgentWorkspace projectId={Route.useParams().projectId} />
}
