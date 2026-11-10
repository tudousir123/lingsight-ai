import { createFileRoute } from "@tanstack/react-router"
import { InferencePage } from "@/features/inference/InferencePage"
export const Route = createFileRoute("/_layout/inference")({
  component: InferencePage,
  head: () => ({ meta: [{ title: "视频推理 - LingSight Science" }] }),
})
