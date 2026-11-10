import { createFileRoute } from "@tanstack/react-router"
import LingSightLanding from "@/features/marketing/LingSightLanding"

export const Route = createFileRoute("/welcome")({
  component: LingSightLanding,
  head: () => ({
    meta: [{ title: "LingSight Science · Animal Behavior Research" }],
  }),
})
