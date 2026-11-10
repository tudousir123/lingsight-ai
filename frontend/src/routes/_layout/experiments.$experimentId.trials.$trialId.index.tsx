import { createFileRoute } from "@tanstack/react-router"
import { TrialPreparePage } from "@/features/trials/prepare"

export const Route = createFileRoute(
  "/_layout/experiments/$experimentId/trials/$trialId/",
)({
  component: () => {
    const { experimentId, trialId } = Route.useParams()
    return <TrialPreparePage experimentId={experimentId} trialId={trialId} />
  },
  head: () => ({ meta: [{ title: "分析准备 - LingSight Science" }] }),
})
