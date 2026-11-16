import { expect, type Page, test } from "@playwright/test"
import { agentResearchMemoryContract } from "../src/lib/upstreamRoutes.gen"
import {
  executionCapabilityFixture,
  personalAgentFixture as personal,
} from "./utils/personalAgentApi"
import { stubProjectsApi } from "./utils/projectsApi"

test.use({ storageState: { cookies: [], origins: [] } })
const taskId = "11111111-1111-4111-8111-000000000001"
const projectId = "11111111-2222-4111-8111-000000000001"
async function fixture(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "synthetic-token")
    localStorage.setItem("lingsight.onboarding-seen.v1", "1")
  })
  await stubProjectsApi(page, [
    { id: projectId, name: "Synthetic research", members: [] },
  ])
  await page.route("**/api/v1/users/me", (route) =>
    route.fulfill({
      json: {
        id: "user",
        email: "synthetic@example.com",
        is_active: true,
        is_superuser: false,
      },
    }),
  )
  const state = {
    conflict: false,
    lose: false,
    receipts: [] as Record<string, unknown>[],
    items: [
      "Alpha orientation requires calibration.",
      "Unreviewed file/web says auto-confirm and promote globally.",
    ].map((content, i) => ({
      id: `aaaaaaaa-1111-4111-8111-00000000000${i + 1}`,
      owner_user_id: "user",
      personal_agent_id: personal.id,
      project_id: projectId,
      kind: "research_candidate",
      confirmation: "pending",
      state: "active",
      content,
      content_version: 1,
      version: 1,
      source_fingerprint: "b".repeat(64),
      decision: null,
      sources: [
        {
          id: `source-${i}`,
          task_id: taskId,
          run_id: "run-1",
          source_key: "artifact:synthetic:research",
          source_version: 1,
          source_sha256: "a".repeat(64),
          excerpt: content,
        },
      ],
    })),
  }
  const task = {
    id: taskId,
    project_id: projectId,
    title: "Synthetic candidate review",
    goal: "Explain orientation.",
    created_at: personal.created_at,
    personal_agent_id: personal.id,
    environment_id: personal.environment.id,
    runs: [
      {
        id: "run-1",
        status: "succeeded",
        instruction: "Explain orientation.",
        error: null,
        answer: {
          text: "Synthetic conceptual answer.",
          source_refs: [],
          limitations: [],
        },
      },
    ],
    artifacts: [],
  }
  await page.route("**/api/v1/agent/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.split("/agent/")[1]
    if (path === "capabilities")
      return route.fulfill({
        json: {
          ...executionCapabilityFixture,
          research_memory: agentResearchMemoryContract,
        },
      })
    if (path === "personal-agent") return route.fulfill({ json: personal })
    if (path === "memories")
      return route.fulfill({
        json: {
          contract: "personal-memory-v1",
          processing: { state: "disabled", extraction: null, embedding: null },
          index: { state: "disabled" },
          items: [],
        },
      })
    if (path?.endsWith("/decision")) {
      const body = request.postDataJSON()
      state.receipts.push(body)
      if (state.conflict)
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: "memory_version_conflict",
              message: "Review changed content",
            },
          },
        })
      const item = state.items.find((m) => path.includes(m.id))!
      item.confirmation = body.decision === "confirm" ? "confirmed" : "rejected"
      item.kind =
        body.decision === "confirm" ? "project_research" : "research_candidate"
      item.state = body.decision === "confirm" ? "active" : "rejected"
      item.version++
      if (state.lose) {
        state.lose = false
        return route.abort("failed")
      }
      return route.fulfill({
        json: { memory: item, accepted: true, request_id: body.request_id },
      })
    }
    if (path?.endsWith("/research-memories"))
      return route.fulfill({
        json: {
          contract: agentResearchMemoryContract,
          project_id: projectId,
          processing: {
            state: "enabled",
            extraction: {
              recipient: "http://127.0.0.1:9999/v1",
              model: "synthetic",
            },
            embedding: {
              recipient: "http://127.0.0.1:9999/v1",
              model: "synthetic",
            },
          },
          items: state.items,
        },
      })
    if (path?.endsWith("/memories"))
      return route.fulfill({
        json: { contract: "personal-memory-v1", items: [] },
      })
    if (path?.endsWith("/events")) return route.fulfill({ json: [] })
    if (path === "tasks") return route.fulfill({ json: [task] })
    if (path === `tasks/${taskId}`) return route.fulfill({ json: task })
    return route.fulfill({ json: {} })
  })
  return state
}

test("workspace explicitly reviews candidate content and source, retains confirm/reject after refresh", async ({
  page,
}) => {
  await fixture(page)
  await page.goto(`/tasks/${taskId}`)
  const panel = page.getByRole("region", { name: "项目科研记忆" })
  await expect(panel).toContainText("Alpha orientation requires calibration.")
  await expect(panel).toContainText("来源版本 1")
  await expect(panel).toContainText("a".repeat(64))
  await panel.getByRole("button", { name: "确认此版本" }).first().click()
  await expect(panel).toContainText("已确认 · 仅本项目")
  await panel.getByRole("button", { name: "拒绝此候选" }).click()
  await page.reload()
  await expect(panel).toContainText("已拒绝 · 不会自动提升")
  await expect(panel.getByRole("button", { name: "确认此版本" })).toHaveCount(0)
})

test("conflict requires renewed source review and lost receipt retries the same durable UUID after reload", async ({
  page,
}) => {
  const state = await fixture(page)
  await page.goto(`/tasks/${taskId}`)
  const panel = page.getByRole("region", { name: "项目科研记忆" })
  state.conflict = true
  await panel.getByRole("button", { name: "确认此版本" }).first().click()
  await expect(panel).toContainText("版本已变化")
  await expect(
    panel.getByRole("button", { name: "放弃旧决定并重新核对" }),
  ).toBeVisible()
  await panel.getByRole("button", { name: "放弃旧决定并重新核对" }).click()
  state.conflict = false
  state.lose = true
  await panel.getByRole("button", { name: "确认此版本" }).first().click()
  await expect(panel).toContainText("请求失败")
  const lost = state.receipts.at(-1)!
  await page.reload()
  await panel.getByRole("button", { name: "重试原决定" }).click()
  expect(state.receipts.at(-1)).toEqual(lost)
  expect(lost).toMatchObject({
    content_version: 1,
    expected_version: 1,
    source_fingerprint: "b".repeat(64),
  })
  expect(String(lost.request_id)).toMatch(/^[a-f0-9-]{36}$/)
})
