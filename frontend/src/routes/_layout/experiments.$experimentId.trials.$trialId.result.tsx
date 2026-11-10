import { createFileRoute } from "@tanstack/react-router"
import { TrialResultPage } from "@/features/trials/result"

export const Route = createFileRoute(
  "/_layout/experiments/$experimentId/trials/$trialId/result",
)({
  component: () => {
    const { experimentId, trialId } = Route.useParams()
    return <TrialResultPage experimentId={experimentId} trialId={trialId} />
  },
  head: () => ({ meta: [{ title: "单次分析结果 - LingSight Science" }] }),
})
