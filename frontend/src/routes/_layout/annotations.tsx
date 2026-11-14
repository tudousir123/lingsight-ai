import { createFileRoute } from "@tanstack/react-router"
import { AnnotationsPage } from "@/features/annotations/annotations"
export const Route = createFileRoute("/_layout/annotations")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { view?: "directory" } => ({
    view: search.view === "directory" ? "directory" : undefined,
  }),
  component: AnnotationsRoute,
  head: () => ({ meta: [{ title: "视频标注 - LingSight Science" }] }),
})

function AnnotationsRoute() {
  const { view } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <AnnotationsPage
      tab={view === "directory" ? "directory" : "manual"}
      onTabChange={(tab) =>
        void navigate({
          search: tab === "directory" ? { view: "directory" } : {},
          replace: true,
        })
      }
    />
  )
}
