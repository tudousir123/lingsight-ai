import type { Page } from "@playwright/test"

export const personalAgentFixture = {
  id: "aaaaaaaa-1111-4111-8111-111111111111",
  owner_user_id: "user",
  created_at: "2026-11-15T00:00:00Z",
  environment: {
    id: "eeeeeeee-1111-4111-8111-111111111111",
    status: "ready",
    contract: "task-workspace-v1",
    isolation: "service-owned-task-directories",
    inputs: "read-only",
    outputs: "task-run-only",
    arbitrary_host_paths: false,
    host_shell: false,
  },
}
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
    contract: "durable-run-v1",
    requests: "persistent-v1",
    recovery: "safe-v1",
    engine: "pi-durable",
    version: "1.5.2",
    enabled: true,
  },
}
