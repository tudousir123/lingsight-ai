import { expect, type Page, test } from "@playwright/test"
import {
  executionCapabilityFixture,
  personalAgentFixture,
  personalTaskBinding,
} from "./utils/personalAgentApi"
import { stubProjectsApi } from "./utils/projectsApi"

const taskId = "11111111-1111-4111-8111-111111111111"
const runId = "22222222-2222-4222-8222-222222222222"
const operationId = "33333333-3333-4333-8333-333333333333"
test.use({ storageState: { cookies: [], origins: [] } })
async function fixture(
  page: Page,
  status = "result_unknown",
  conflict = false,
  loseAcknowledgement = false,
) {
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "synthetic-token")
    localStorage.setItem("lingsight.onboarding-seen.v1", "1")
  })
  stubProjectsApi(page)
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
  const task = {
    ...personalTaskBinding,
    id: taskId,
    title: "操作核验",
    goal: "合成操作",
    created_at: personalAgentFixture.created_at,
    artifacts: [],
    runs: [
      {
        id: runId,
        instruction: "合成操作",
        status,
        error: "External completion cannot be confirmed",
        answer: null,
        cancellation:
          status === "cancel_unconfirmed"
            ? {
                requested_at: "2026-11-16T00:00:00Z",
                confirmed_at: null,
                reason: "External worker did not acknowledge stop",
              }
            : null,
      },
    ],
  }
  const operation = {
    operation_id: operationId,
    run_id: runId,
    tool: "synthetic_browser_submit",
    policy: "unknown",
    state: "unknown",
    version: 3,
    attempts: 1,
    checkpoint: { phase: "execute", durable_task_id: "19" },
    reason: "External receipt missing",
    evidence: null,
    result_saved: false,
    stop_confirmed_at: null,
  }
  const writes: Record<string, unknown>[] = []
  let lost = false
  await page.route("**/api/v1/agent/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname.split("/agent/")[1]
    if (req.method() === "POST") {
      writes.push(req.postDataJSON())
      if (conflict)
        return route.fulfill({
          status: 409,
          json: { error: "操作版本已变更，请重新核对" },
        })
      operation.state = "effect_confirmed"
      operation.version++
      operation.evidence = {
        source: "owner_decision",
        text: req.postDataJSON().evidence,
      } as never
      task.runs[0].status = "interrupted"
      if (loseAcknowledgement && !lost) {
        lost = true
        return route.abort("failed")
      }
      return route.fulfill({
        json: {
          operation,
          accepted: true,
          request_id: req.postDataJSON().request_id,
        },
      })
    }
    if (path === "capabilities")
      return route.fulfill({ json: executionCapabilityFixture })
    if (path === "personal-agent")
      return route.fulfill({ json: personalAgentFixture })
    if (path === "tasks") return route.fulfill({ json: [task] })
    if (path === `tasks/${taskId}`) return route.fulfill({ json: task })
    if (path === `runs/${runId}/operations`)
      return route.fulfill({ json: [operation] })
    if (path.endsWith("/events")) return route.fulfill({ json: [] })
    return route.fulfill({ json: {} })
  })
  return { writes, operation, task }
}
test("unknown result persists after refresh and owner records evidence without a resend", async ({
  page,
}) => {
  const f = await fixture(page)
  await page.goto(`/tasks/${taskId}`)
  const panel = page.getByRole("region", { name: "工具操作核验" })
  await expect(panel).toBeVisible()
  await expect(panel).toContainText(operationId)
  await expect(panel).toContainText("execute")
  await expect(panel).toContainText("External receipt missing")
  await expect(
    page.getByRole("button", { name: "从已保存的材料恢复" }),
  ).toHaveCount(0)
  await page.reload()
  await expect(panel).toContainText(operationId)
  await panel.getByLabel("人工核验依据").fill("独立核对合成回执，确认已生效")
  await panel.getByRole("button", { name: "保存人工核验记录" }).click()
  await expect.poll(() => f.writes.length).toBe(1)
  expect(f.writes[0]).toMatchObject({
    expected_version: 3,
    decision: "confirm_effect",
    evidence: "独立核对合成回执，确认已生效",
    stop_confirmed: false,
  })
  expect(f.writes[0].request_id).toMatch(/^[a-f0-9-]{36}$/)
  await page.reload()
  await expect(panel).toContainText("人工核验记录")
  await expect(panel).toContainText("不会自动重发")
})
test("unconfirmed cancellation remains honest and blocks new work across refresh", async ({
  page,
}) => {
  await fixture(page, "cancel_unconfirmed")
  await page.goto(`/tasks/${taskId}`)
  await expect(
    page.getByText("停止未确认", { exact: true }).first(),
  ).toBeVisible()
  await expect(
    page.getByText("External worker did not acknowledge stop"),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByText("停止未确认", { exact: true }).first(),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "从已保存的材料恢复" }),
  ).toHaveCount(0)
  await expect(page.getByRole("textbox", { name: "研究问题" })).toBeDisabled()
  await expect(
    page.getByRole("button", { name: "发送研究问题" }),
  ).toBeDisabled()
})
test("stale review is surfaced without overwriting the server operation", async ({
  page,
}) => {
  const f = await fixture(page, "result_unknown", true)
  await page.goto(`/tasks/${taskId}`)
  const panel = page.getByRole("region", { name: "工具操作核验" })
  await panel.getByLabel("人工核验依据").fill("合成核验")
  await panel.getByRole("button", { name: "保存人工核验记录" }).click()
  await expect(panel.getByRole("alert")).toContainText("版本已变更")
  expect(f.operation.state).toBe("unknown")
  await expect(
    panel.getByRole("button", { name: "放弃本地重试并刷新" }),
  ).toBeVisible()
})

test("lost review acknowledgement retains original decision UUID and version across refresh", async ({
  page,
}) => {
  const f = await fixture(page, "result_unknown", false, true)
  await page.goto(`/tasks/${taskId}`)
  const panel = page.getByRole("region", { name: "工具操作核验" })
  await panel.getByLabel("人工核验依据").fill("合成独立核验凭据")
  await panel.getByRole("button", { name: "保存人工核验记录" }).click()
  await expect(panel.getByRole("alert")).toBeVisible()
  await page.reload()
  await panel.getByRole("button", { name: "重试未确认核验请求" }).click()
  await expect.poll(() => f.writes.length).toBe(2)
  expect(f.writes[1]).toEqual(f.writes[0])
})
