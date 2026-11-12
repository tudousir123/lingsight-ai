import { withTokenQuery } from "@/lib/credentials"
import {
  type InferenceArtifactName,
  inferenceGatewayBase,
  inferenceRoutes,
} from "@/lib/upstreamRoutes.gen"

export function inferenceArtifactUrl(
  taskId: string,
  name: InferenceArtifactName,
) {
  const path = inferenceRoutes.tasksByTaskIdArtifactsByArtifactName(
    encodeURIComponent(taskId),
    name,
  )
  return withTokenQuery(`${inferenceGatewayBase}/${path}`)
}
