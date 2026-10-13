import { createFileRoute } from "@tanstack/react-router"
import { TrialDetailPage } from "@/features/trials/directory"

export const Route = createFileRoute(
  "/_layout/experiments/$experimentId/trials/$trialId",
)({
  component: () => {
    const { experimentId, trialId } = Route.useParams()
    return <TrialDetailPage experimentId={experimentId} trialId={trialId} />
  },
  head: () => ({ meta: [{ title: "试次信息 - LingSight AI" }] }),
})
