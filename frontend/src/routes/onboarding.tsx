import { createFileRoute } from "@tanstack/react-router"
import Onboarding from "@/features/research/Onboarding"

export const Route = createFileRoute("/onboarding")({
  component: Onboarding,
  head: () => ({
    meta: [{ title: "Start your research · LingSight Science" }],
  }),
})
