import { createFileRoute } from "@tanstack/react-router"
import { InferencePage } from "@/features/inference/InferencePage"

type InferenceSearch = { source_id?: string; path?: string }

export const Route = createFileRoute("/_layout/inference")({
  validateSearch: (search: Record<string, unknown>): InferenceSearch => ({
    source_id:
      typeof search.source_id === "string" ? search.source_id : undefined,
    path: typeof search.path === "string" ? search.path : undefined,
  }),
  component: InferenceRoute,
  head: () => ({ meta: [{ title: "视频推理 - LingSight Science" }] }),
})

function InferenceRoute() {
  const { source_id, path } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <InferencePage
      sourceId={source_id}
      directory={path ?? ""}
      onDirectoryChange={(directory) =>
        void navigate({ search: { source_id, path: directory || undefined } })
      }
    />
  )
}
