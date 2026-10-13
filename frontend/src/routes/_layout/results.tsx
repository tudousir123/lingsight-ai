import { createFileRoute, Navigate } from "@tanstack/react-router"
import { ResultsPage } from "@/features/mwm-demo/pages"

function ResultsRoute() {
  const isDemo =
    import.meta.env.DEV && import.meta.env.VITE_DEMO_PREVIEW === "true"
  // Outside the demo preview the fixed sample page must not stay reachable:
  // real per-trial results live on the trial result page.
  return isDemo ? <ResultsPage /> : <Navigate to="/" replace />
}

export const Route = createFileRoute("/_layout/results")({
  component: ResultsRoute,
  head: () => ({ meta: [{ title: "单次分析结果 - LingSight AI" }] }),
})
