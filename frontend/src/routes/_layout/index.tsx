import { createFileRoute } from "@tanstack/react-router"
import { ExperimentPage } from "@/features/mwm-demo/pages"
import { TrialDirectoryPage } from "@/features/trials/directory"

function HomePage() {
  const isDemo =
    import.meta.env.DEV && import.meta.env.VITE_DEMO_PREVIEW === "true"
  return isDemo ? <ExperimentPage /> : <TrialDirectoryPage />
}

export const Route = createFileRoute("/_layout/")({
  component: HomePage,
  head: () => ({ meta: [{ title: "实验与视频管理 - LingSight AI" }] }),
})
