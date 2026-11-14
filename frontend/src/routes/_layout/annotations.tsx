import { createFileRoute } from "@tanstack/react-router"
import { TrialDirectoryPage } from "@/features/trials/directory"
export const Route = createFileRoute("/_layout/annotations")({
  component: TrialDirectoryPage,
  head: () => ({ meta: [{ title: "视频标注 - LingSight Science" }] }),
})
