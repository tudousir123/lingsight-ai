import { createFileRoute } from "@tanstack/react-router"
import { TrialDirectoryPage } from "@/features/trials/directory"

export const Route = createFileRoute("/_layout/experiments/")({
  component: TrialDirectoryPage,
  head: () => ({ meta: [{ title: "Experiments & data · LingSight Science" }] }),
})
