import { expect, type Page, test } from "@playwright/test"
import {
  executionCapabilityFixture,
  personalAgentFixture as personal,
} from "./utils/personalAgentApi"
import { stubProjectsApi } from "./utils/projectsApi"

test.use({ storageState: { cookies: [], origins: [] } })
const taskId = "11111111-1111-4111-8111-000000000001"
const memory = {
  id: "mmmmmmmm-1111-4111-8111-111111111111",
  owner_user_id: "user",
  personal_agent_id: personal.id,
  kind: "personal_preference",
  project_id: null,
  content: "以后请用中文回答。",
  content_version: 1,
  state: "active",
  confirmation: "not_required",
  sources: [
    {
      id: "source-1",
      task_id: taskId,
      run_id: "run-1",
      source_key: "run-1:instruction",
      source_version: 1,
      source_sha256: "a".repeat(64),
      excerpt: "以后请用中文回答。",
    },
  ],
}
async function fixture(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "synthetic-token")
    localStorage.setItem("lingsight.onboarding-seen.v1", "1")
  })
  await stubProjectsApi(page)
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
  const tasks: Record<string, unknown>[] = []
  const state = {
    saved: false,
    unavailable: false,
    disabled: false,
    index: "ready",
  }
  await page.route("**/api/v1/agent/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.split("/agent/")[1]
    if (path === "capabilities")
      return route.fulfill({ json: executionCapabilityFixture })
    if (path === "personal-agent") return route.fulfill({ json: personal })
    if (path === "memories") {
      if (state.unavailable)
        return route.fulfill({
          status: 503,
          json: { detail: "记忆服务暂时不可用" },
        })
      return route.fulfill({
        json: {
          contract: "personal-memory-v1",
          processing: {
            state: state.disabled ? "disabled" : "enabled",
            extraction: state.disabled
              ? null
              : { recipient: "http://127.0.0.1:9999/v1", model: "synthetic" },
            embedding: state.disabled
              ? null
              : { recipient: "http://127.0.0.1:9999/v1", model: "synthetic" },
            reranking: "disabled",
            telemetry: "disabled",
          },
          index: { state: state.index },
          items: state.saved ? [memory] : [],
        },
      })
    }
    if (path === "tasks" && request.method() === "POST") {
      const { goal } = request.postDataJSON()
      if (goal === memory.content) state.saved = true
      const id = `11111111-1111-4111-8111-${String(tasks.length + 1).padStart(12, "0")}`
      const task = {
        id,
        title: goal,
        goal,
        created_at: personal.created_at,
        personal_agent_id: personal.id,
        environment_id: personal.environment.id,
        runs: [
          {
            id: `run-${tasks.length + 1}`,
            status: "succeeded",
            instruction: goal,
            error: null,
            answer: {
              text: `合成完成：${goal}`,
              source_refs: [],
              limitations: [],
            },
          },
        ],
        artifacts: [],
      }
      tasks.push(task)
      return route.fulfill({ status: 202, json: { task, run: task.runs[0] } })
    }
    if (path === "tasks") return route.fulfill({ json: tasks })
    if (path?.endsWith("/events")) return route.fulfill({ json: [] })
    if (path?.endsWith("/memories"))
      return route.fulfill({
        json: {
          contract: "personal-memory-v1",
          items:
            state.saved && !state.disabled
              ? [
                  {
                    run_id: "run-2",
                    memory_id: memory.id,
                    content: memory.content,
                    content_version: 1,
                    available: true,
                    sources: memory.sources,
                  },
                ]
              : [],
        },
      })
    if (path?.startsWith("tasks/"))
      return route.fulfill({
        json: tasks.find((t) => t.id === path.split("/")[1]),
      })
    return route.fulfill({ json: {} })
  })
  return state
}

test("stable preference and source are visible, and a new task shows the version supplied to its engine", async ({
  page,
}) => {
  await fixture(page)
  await page.goto("/")
  await page
    .getByRole("textbox", { name: "研究问题", exact: true })
    .fill(memory.content)
  await page.getByRole("button", { name: "发送研究问题" }).click()
  const panel = page.getByRole("region", { name: "个人偏好记忆" })
  await panel.getByText("查看个人偏好", { exact: false }).click()
  await expect(panel).toContainText(memory.content)
  await expect(panel).toContainText("来源版本 1")
  await expect(
    panel.getByRole("link", { name: "查看来源任务" }),
  ).toHaveAttribute("href", `/tasks/${taskId}`)
  await page.goto("/")
  await page
    .getByRole("textbox", { name: "研究问题", exact: true })
    .fill("解释朝向概念")
  await page.getByRole("button", { name: "发送研究问题" }).click()
  await panel.getByText("查看个人偏好", { exact: false }).click()
  await expect(panel).toContainText("已提供给本任务")
  await expect(panel).toContainText("内容版本 1")
  await page.reload()
  await panel.getByText("查看个人偏好", { exact: false }).click()
  await expect(panel).toContainText(memory.content)
  await expect(panel).toContainText("已提供给本任务")
})

test("disabled processing and index outage are explicit without disabling normal task input", async ({
  page,
}) => {
  const state = await fixture(page)
  state.disabled = true
  state.index = "disabled"
  await page.goto("/")
  const panel = page.getByRole("region", { name: "个人偏好记忆" })
  await expect(panel).toContainText("未配置获授权记忆处理服务")
  await page
    .getByRole("textbox", { name: "研究问题", exact: true })
    .fill("普通任务")
  await expect(page.getByRole("button", { name: "发送研究问题" })).toBeEnabled()
  state.disabled = false
  state.saved = true
  state.index = "unavailable"
  await panel.getByRole("button", { name: "刷新偏好" }).click()
  await expect(panel).toContainText("索引暂不可用")
  await panel.getByText("查看个人偏好", { exact: false }).click()
  await expect(panel).toContainText(memory.content)
  await expect(panel).toContainText("权威记录仍可查看")
})

test("failed memory refresh does not present cached saved preferences as currently available", async ({
  page,
}) => {
  const state = await fixture(page)
  state.saved = true
  await page.goto("/")
  const panel = page.getByRole("region", { name: "个人偏好记忆" })
  await panel.getByText("查看个人偏好", { exact: false }).click()
  await expect(panel).toContainText(memory.content)
  state.unavailable = true
  await panel.getByRole("button", { name: "刷新偏好" }).click()
  await expect(panel).toContainText("记忆服务暂时不可用")
  await expect(panel.getByText(memory.content, { exact: true })).toHaveCount(0)
})
