import { expect, type Page, test } from "@playwright/test"
import { personalAgentFixture as personal } from "./utils/personalAgentApi"
import { stubProjectsApi } from "./utils/projectsApi"

test.use({ storageState: { cookies: [], origins: [] } })
async function fixture(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "synthetic-token")
    localStorage.setItem("lingsight.onboarding-seen.v1", "1")
  })
  stubProjectsApi(page)
  const tasks: Record<string, unknown>[] = []
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
  await page.route("**/api/v1/agent/**", async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname.split("/agent/")[1]
    if (path === "personal-agent") return route.fulfill({ json: personal })
    if (path === "tasks" && req.method() === "POST") {
      const { goal } = req.postDataJSON()
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
            id: `run-${id}`,
            status: "succeeded",
            instruction: goal,
            error: null,
            answer: {
              text: `已完成合成解释：${goal}`,
              source_refs: [],
              limitations: [],
            },
          },
        ],
        artifacts: [
          {
            id: `artifact-${id}`,
            run_id: `run-${id}`,
            kind: "report",
            name: "note.md",
            bytes: 32,
            sha256: "synthetic",
          },
        ],
      }
      tasks.push(task)
      return route.fulfill({ status: 202, json: { task, run: task.runs[0] } })
    }
    if (path === "tasks") return route.fulfill({ json: tasks })
    if (path?.endsWith("/events")) return route.fulfill({ json: [] })
    if (path?.startsWith("tasks/"))
      return route.fulfill({
        json: tasks.find((t) => t.id === path.split("/")[1]),
      })
    return route.fulfill({ json: {} })
  })
  return tasks
}

test("two tasks retain one visible personal environment and separate persisted answers after refresh", async ({
  page,
}) => {
  await fixture(page)
  await page.goto("/")
  const panel = page.getByRole("region", { name: "个人 Agent 与工作环境" })
  await expect(panel).toContainText(personal.id)
  await expect(panel).toContainText(personal.environment.id)
  await expect(panel).toContainText("环境可用")
  for (const question of ["合成问题甲", "合成问题乙"]) {
    await page
      .getByRole("textbox", { name: "研究问题", exact: true })
      .fill(question)
    await page.getByRole("button", { name: "发送研究问题" }).click()
    await expect(page).toHaveURL(/tasks\//)
    await expect(panel).toContainText(personal.id)
    await expect(
      page.getByText(`已完成合成解释：${question}`, { exact: true }),
    ).toBeVisible()
    await page.reload()
    await expect(panel).toContainText(personal.environment.id)
    await expect(
      page.getByText(`已完成合成解释：${question}`, { exact: true }),
    ).toBeVisible()
    await expect(page.getByRole("button", { name: /note.md/ })).toBeVisible()
    if (question === "合成问题甲") await page.goto("/")
  }
  await page.goto("/tasks/11111111-1111-4111-8111-000000000001")
  await expect(
    page.getByText("已完成合成解释：合成问题甲", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText("已完成合成解释：合成问题乙", { exact: true }),
  ).toHaveCount(0)
})

for (const mode of ["unsupported", "unavailable"] as const) {
  test(`${mode} personal environment keeps draft and disables execution without fallback`, async ({
    page,
  }) => {
    const tasks = await fixture(page)
    let writes = 0
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/agent/")) writes++
    })
    await page.route("**/api/v1/agent/personal-agent", (route) =>
      mode === "unsupported"
        ? route.fulfill({
            status: 503,
            json: { detail: "个人 Agent 持久工作环境尚未就绪，请先更新服务" },
          })
        : route.fulfill({
            json: {
              ...personal,
              environment: { ...personal.environment, status: "unavailable" },
            },
          }),
    )
    await page.goto("/")
    const panel = page.getByRole("region", { name: "个人 Agent 与工作环境" })
    await expect(panel).toContainText("个人环境不可用")
    await page
      .getByRole("textbox", { name: "研究问题", exact: true })
      .fill("保留这条合成输入")
    await expect(
      page.getByRole("button", { name: "发送研究问题" }),
    ).toBeDisabled()
    await page
      .getByRole("textbox", { name: "研究问题", exact: true })
      .press("Enter")
    expect(writes).toBe(0)
    expect(tasks).toHaveLength(0)
    await page.route("**/api/v1/agent/personal-agent", (route) =>
      route.fulfill({ json: personal }),
    )
    await panel.getByRole("button", { name: "重试个人环境" }).click()
    await expect(panel).toContainText("环境可用")
    await expect(
      page.getByRole("textbox", { name: "研究问题", exact: true }),
    ).toHaveValue("保留这条合成输入")
    await expect(
      page.getByRole("button", { name: "发送研究问题" }),
    ).toBeEnabled()
  })
}

for (const binding of [null, "other-environment"]) {
  test(`unclaimed or mismatched task cannot execute but can still be stopped (${binding})`, async ({
    page,
  }) => {
    const tasks = await fixture(page)
    tasks.push({
      id: "11111111-1111-4111-8111-000000000001",
      title: "历史合成任务",
      goal: "历史合成任务",
      personal_agent_id: binding ? personal.id : null,
      environment_id: binding,
      runs: [
        {
          id: "synthetic-run",
          instruction: "历史合成任务",
          status: "interrupted",
          error: null,
        },
      ],
      artifacts: [],
      created_at: personal.created_at,
    })
    let cancelled = false
    await page.route("**/api/v1/agent/runs/synthetic-run/cancel", (route) => {
      cancelled = true
      return route.fulfill({ json: { status: "cancelled" } })
    })
    await page.goto("/tasks/11111111-1111-4111-8111-000000000001")
    await expect(page.getByText(/未绑定当前个人环境/)).toBeVisible()
    await expect(
      page.getByRole("button", { name: "从已保存的材料恢复" }),
    ).toBeDisabled()
    await page
      .getByRole("textbox", { name: "研究问题", exact: true })
      .fill("不应执行")
    await expect(
      page.getByRole("button", { name: "发送研究问题" }),
    ).toBeDisabled()
    await page.getByRole("button", { name: "停止", exact: true }).click()
    expect(cancelled).toBe(true)
  })
}
