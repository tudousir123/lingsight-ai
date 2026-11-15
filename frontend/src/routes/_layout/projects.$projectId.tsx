import { createFileRoute } from "@tanstack/react-router"
import { ProjectPage } from "@/features/agent/ProjectPage"
import { AgentWorkspace } from "@/features/agent/Workspace"

export const Route = createFileRoute("/_layout/projects/$projectId")({
  validateSearch: (search: Record<string, unknown>): { view?: "details" } =>
    search.view === "details" ? { view: "details" } : {},
  component: ProjectRoute,
  head: () => ({ meta: [{ title: "项目 · LingSight Science" }] }),
})

function ProjectRoute() {
  const { projectId } = Route.useParams()
  const { view } = Route.useSearch()
  return view === "details" ? (
    <ProjectPage key={projectId} projectId={projectId} />
  ) : (
    <AgentWorkspace projectId={projectId} />
  )
}
