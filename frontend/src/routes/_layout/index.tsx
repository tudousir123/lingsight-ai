import { createFileRoute, redirect } from "@tanstack/react-router"
import { AgentWorkspace } from "@/features/agent/Workspace"
import { ResearchCopilot } from "@/features/research/copilot/ResearchCopilot"
import { onboardingSeen } from "@/features/research/entry"
import { isLoggedIn } from "@/hooks/useAuth"
export const Route = createFileRoute("/_layout/")({
  beforeLoad: () => {
    if (isLoggedIn() && !onboardingSeen()) throw redirect({ to: "/onboarding" })
  },
  component:
    import.meta.env.VITE_LINGSIGHT_MOCK_TOOLS === "true"
      ? ResearchCopilot
      : AgentWorkspace,
  head: () => ({ meta: [{ title: "科研工作区 - 灵视科技" }] }),
})
