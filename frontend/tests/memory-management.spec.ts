import { expect, type Page, test } from "@playwright/test"
import {
  agentMemoryManagementContract,
  agentResearchMemoryContract,
} from "../src/lib/upstreamRoutes.gen"
import {
  executionCapabilityFixture,
  personalAgentFixture as personal,
} from "./utils/personalAgentApi"
import { stubProjectsApi } from "./utils/projectsApi"

const taskId = "11111111-1111-4111-8111-000000000001",
  projectId = "11111111-2222-4111-8111-000000000001"
test.use({ storageState: { cookies: [], origins: [] } })
async function fixture(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "synthetic")
    localStorage.setItem("lingsight.onboarding-seen.v1", "1")
  })
  await stubProjectsApi(page, [
    { id: projectId, name: "Synthetic project", members: [] },
  ])
  await page.route("**/api/v1/users/me", (r) =>
    r.fulfill({
      json: {
        id: "user",
        email: "synthetic@example.com",
        is_active: true,
        is_superuser: false,
      },
    }),
  )
  const make = (research: boolean) => ({
    id: research
      ? "aaaaaaaa-1111-4111-8111-000000000001"
      : "bbbbbbbb-1111-4111-8111-000000000001",
    owner_user_id: "user",
    project_id: research ? projectId : null,
    kind: research ? "project_research" : "personal_preference",
    content: research ? "Original research fact." : "以后请用中文回答。",
    content_version: 1,
    version: 2,
    source_fingerprint: "b".repeat(64),
    confirmation: research ? "confirmed" : "not_required",
    state: "active",
    sources: [
      {
        id: "source",
        task_id: taskId,
        run_id: "run-1",
        source_version: 1,
        source_sha256: "a".repeat(64),
        excerpt: "Original synthetic source.",
      },
    ],
  })
  const state = {
    research: make(true),
    personal: make(false),
    lose: false,
    conflict: false,
    requests: [] as any[],
    supported: true,
  }
  const task = {
    id: taskId,
    project_id: projectId,
    title: "Synthetic review",
    goal: "Explain conceptually.",
    created_at: personal.created_at,
    personal_agent_id: personal.id,
    environment_id: personal.environment.id,
    runs: [
      {
        id: "run-1",
        status: "succeeded",
        instruction: "Explain conceptually.",
        error: null,
        answer: { text: "Synthetic answer.", source_refs: [], limitations: [] },
      },
    ],
    artifacts: [],
  }
  await page.route("**/api/v1/agent/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname.split("/agent/")[1],
      research = path?.includes("research-memories"),
      m = research ? state.research : state.personal
    if (path === "capabilities")
      return route.fulfill({
        json: {
          ...executionCapabilityFixture,
          research_memory: agentResearchMemoryContract,
          memory_management: state.supported
            ? agentMemoryManagementContract
            : "old",
          execution: {
            ...executionCapabilityFixture.execution,
            enabled: false,
          },
        },
      })
    if (path === "personal-agent") return route.fulfill({ json: personal })
    if (path === "tasks") return route.fulfill({ json: [task] })
    if (path === `tasks/${taskId}`) return route.fulfill({ json: task })
    if (path?.endsWith("/events")) return route.fulfill({ json: [] })
    if (path === `tasks/${taskId}/memories`)
      return route.fulfill({
        json: { contract: "personal-memory-v1", items: [] },
      })
    if (path?.endsWith("/history"))
      return route.fulfill({
        json: { items: [{ ...m, content: "Original archived version." }] },
      })
    if (path?.endsWith("/mutation")) {
      const body = req.postDataJSON()
      state.requests.push(body)
      if (state.conflict)
        return route.fulfill({
          status: 409,
          json: { error: { message: "Version changed" } },
        })
      if (state.lose) {
        state.lose = false
        await route.abort("failed")
        return
      }
      m.version++
      m.content_version++
      m.source_fingerprint = "c".repeat(64)
      if (body.action === "delete") m.state = "deleted"
      else {
        m.content = body.content
        m.confirmation = research ? "pending" : "not_required"
        m.sources[0].excerpt = body.source_text ?? body.content
      }
      return route.fulfill({ json: { accepted: true, memory: m } })
    }
    if (path === "memories" || path === `tasks/${taskId}/research-memories`)
      return route.fulfill({
        json: {
          contract: research
            ? agentResearchMemoryContract
            : "personal-memory-v1",
          project_id: research ? projectId : undefined,
          processing: { state: "disabled", extraction: null, embedding: null },
          index: {
            state: "unavailable",
            revision: "d".repeat(64),
            attempts: 3,
          },
          items: [m],
        },
      })
    return route.fulfill({ status: 404, json: { detail: path } })
  })
  await page.goto(`/tasks/${taskId}`)
  return state
}
test("disabled generation still permits explicit versioned correction, pending reload retry and deletion/history", async ({
  page,
}) => {
  const state = await fixture(page),
    panel = page.getByRole("region", { name: "项目科研记忆", exact: true })
  await panel.getByRole("button", { name: "纠正记忆", exact: true }).click()
  await panel.getByLabel("纠正内容").fill("Revised research fact.")
  await panel.getByLabel("纠正来源说明").fill("New synthetic source.")
  state.lose = true
  await panel.getByRole("button", { name: "保存纠正并使旧确认失效" }).click()
  await expect(panel.getByRole("button", { name: "重试原修改" })).toBeVisible()
  const first = state.requests[0]
  expect(first.expected_version).toBe(2)
  expect(first.content_version).toBe(1)
  expect(first.source_fingerprint).toBe("b".repeat(64))
  expect(first.request_id).toBeTruthy()
  await page.reload()
  await panel.getByRole("button", { name: "重试原修改" }).click()
  expect(state.requests[1]).toEqual(first)
  await expect(
    panel.getByText("Revised research fact.", { exact: true }),
  ).toBeVisible()
  await expect(panel.getByText("候选 · 待核对", { exact: true })).toBeVisible()
  await panel.getByRole("button", { name: "删除记忆", exact: true }).click()
  await panel.getByRole("button", { name: "确认删除此记忆" }).click()
  await expect(
    panel.getByText("已删除 · 不再复用", { exact: true }),
  ).toBeVisible()
  await panel.getByRole("button", { name: "查看受控版本历史" }).click()
  await expect(
    panel.getByText("Original archived version.", { exact: true }),
  ).toBeVisible()
  await expect(panel.getByText(/不会抹去既有报告/)).toBeVisible()
})
test("personal stale correction requires explicit abandon/refetch; exhausted index and old protocols fail closed", async ({
  page,
}) => {
  const state = await fixture(page),
    panel = page.getByRole("region", { name: "个人偏好记忆", exact: true })
  await panel.getByText("查看个人偏好（1）", { exact: true }).click()
  await panel.getByRole("button", { name: "纠正记忆", exact: true }).click()
  await panel.getByLabel("纠正内容").fill("以后请用英文回答。")
  state.conflict = true
  await panel.getByRole("button", { name: "保存偏好纠正" }).click()
  await expect(panel.getByText(/版本已变化/)).toBeVisible()
  await panel.getByRole("button", { name: "放弃旧修改并重新核对" }).click()
  await expect(panel.getByRole("button", { name: "重试原修改" })).toHaveCount(0)
  await expect(
    panel.getByRole("button", { name: "重建有效索引" }),
  ).toBeDisabled()
  state.supported = false
  await page.reload()
  await panel.getByText("查看个人偏好（1）", { exact: true }).click()
  await expect(
    panel.getByRole("button", { name: "纠正记忆", exact: true }),
  ).toHaveCount(0)
})
