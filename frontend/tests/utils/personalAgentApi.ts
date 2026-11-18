import type { Page } from "@playwright/test"
import {
  agentEnvironmentContract,
  agentExecutionContract,
  agentPersonalMemoryContract,
  agentResearchMemoryContract,
} from "../../src/lib/upstreamRoutes.gen"

export const personalAgentFixture = {
  id: "aaaaaaaa-1111-4111-8111-111111111111",
  owner_user_id: "user",
  created_at: "2026-11-15T00:00:00Z",
  environment: {
    id: "eeeeeeee-1111-4111-8111-111111111111",
    status: "ready",
    contract: agentEnvironmentContract,
    isolation: "service-owned-task-directories",
    inputs: "read-only",
    outputs: "task-run-only",
    arbitrary_host_paths: false,
    host_shell: false,
  },
}
export const requestIdPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/

export const personalTaskBinding = {
  personal_agent_id: personalAgentFixture.id,
  environment_id: personalAgentFixture.environment.id,
}
export async function stubPersonalAgent(page: Page, owner = "user") {
  await page.route("**/api/v1/agent/capabilities", (route) =>
    route.fulfill({ json: executionCapabilityFixture }),
  )
  await page.route("**/api/v1/agent/personal-agent", (route) =>
    route.fulfill({ json: { ...personalAgentFixture, owner_user_id: owner } }),
  )
}

export const executionCapabilityFixture = {
  execution: {
    ...agentExecutionContract,
    enabled: true,
  },
}

export const researchExecutionCapabilityFixture = {
  ...executionCapabilityFixture,
  research_memory: agentResearchMemoryContract,
}

// Non-memory UI scenarios still render memory panels. Return a valid disabled
// service view, not an unrelated task/array that raises protocol alerts.
export function emptyWorkspaceMemoryResponse(
  path: string,
  projectId?: string | null,
) {
  const relative = path.split("/agent/").at(-1)
  const view = {
    processing: { state: "disabled", extraction: null, embedding: null },
    index: { state: "disabled" },
    items: [],
  }
  if (relative === "memories")
    return { contract: agentPersonalMemoryContract, ...view }
  if (relative?.endsWith("/research-memories"))
    return {
      contract: agentResearchMemoryContract,
      project_id: projectId,
      ...view,
    }
  if (relative?.endsWith("/memories"))
    return { contract: agentPersonalMemoryContract, items: [] }
  return undefined
}
