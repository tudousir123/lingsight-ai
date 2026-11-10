import { createFileRoute } from "@tanstack/react-router"
import { ProjectPage } from "@/features/agent/ProjectPage"

export const Route = createFileRoute("/_layout/projects/$projectId")({
  component: () => <ProjectPage projectId={Route.useParams().projectId} />,
  head: () => ({ meta: [{ title: "Project · LingSight Science" }] }),
})
