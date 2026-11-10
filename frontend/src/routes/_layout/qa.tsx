import { createFileRoute } from "@tanstack/react-router"

import { QaPage } from "@/features/qa/qa-page"

export const Route = createFileRoute("/_layout/qa")({
  component: QaPage,
  head: () => ({ meta: [{ title: "科研问答 - LingSight Science" }] }),
})
