import { createFileRoute, Navigate } from "@tanstack/react-router"
import { PreparationPage } from "@/features/mwm-demo/pages"

function PrepareRoute() {
  const isDemo =
    import.meta.env.DEV && import.meta.env.VITE_DEMO_PREVIEW === "true"
  // Outside the demo preview the fixed sample page must not stay reachable:
  // real analysis preparation lives on the per-trial prepare page.
  return isDemo ? <PreparationPage /> : <Navigate to="/" replace />
}

export const Route = createFileRoute("/_layout/prepare")({
  component: PrepareRoute,
  head: () => ({ meta: [{ title: "分析准备 - LingSight AI" }] }),
})
