import { createFileRoute } from "@tanstack/react-router"
import { AnalysisPage } from "@/features/agent/Workspace"
export const Route = createFileRoute("/_layout/analysis")({
  component: AnalysisPage,
  head: () => ({ meta: [{ title: "Analysis & reports - LingSight Science" }] }),
})
