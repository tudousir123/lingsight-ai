import { createFileRoute } from "@tanstack/react-router"
import { AnnotationsPage } from "@/features/annotations/annotations"
export const Route = createFileRoute("/_layout/annotations")({
  component: AnnotationsPage,
  head: () => ({ meta: [{ title: "视频标注 - LingSight Science" }] }),
})
