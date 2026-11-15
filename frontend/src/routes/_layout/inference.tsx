import { createFileRoute } from "@tanstack/react-router"
import { InferencePage } from "@/features/inference/InferencePage"

type InferenceSearch = {
  project_id?: string
  source_id?: string
  path?: string
}

export const Route = createFileRoute("/_layout/inference")({
  validateSearch: (search: Record<string, unknown>): InferenceSearch => ({
    project_id:
      typeof search.project_id === "string" ? search.project_id : undefined,
    source_id:
      typeof search.source_id === "string" ? search.source_id : undefined,
    path: typeof search.path === "string" ? search.path : undefined,
  }),
  component: InferenceRoute,
  head: () => ({ meta: [{ title: "视频推理 - LingSight Science" }] }),
})

function InferenceRoute() {
  const { project_id, source_id, path } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <InferencePage
      projectId={project_id}
      sourceId={source_id}
      directory={path}
      onProjectChange={(projectId) =>
        void navigate({ search: { project_id: projectId } })
      }
      onDirectoryChange={(directory) =>
        void navigate({
          search: { project_id, source_id, path: directory || undefined },
        })
      }
    />
  )
}
