import { expect, type Page, test } from "@playwright/test"
import {
  executionCapabilityFixture,
  personalAgentFixture,
  personalTaskBinding,
} from "./utils/personalAgentApi"
import { stubProjectsApi } from "./utils/projectsApi"

const id = "11111111-1111-4111-8111-111111111111"
const runId = "22222222-2222-4222-8222-222222222222"
const qid = "33333333-3333-4333-8333-333333333333"
test.use({ storageState: { cookies: [], origins: [] } })
async function fixture(page: Page, status = "succeeded") {
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
  const writes: { path: string; body: Record<string, unknown> }[] = []
  const cursors: number[] = []
  let lose = true
  let reconnect = false
  const task = {
    ...personalTaskBinding,
    id,
    title: "合成分析",
    goal: "Explain synthetic orientation",
    created_at: personalAgentFixture.created_at,
    runs: [
      {
        id: runId,
        instruction: "Explain synthetic orientation",
        status,
        error: null,
        clarifications:
          status === "waiting_for_input"
            ? [{ id: qid, question: "合成口径？", answer: null }]
            : [],
        answer: status === "succeeded" ? { text: "合成回答" } : null,
      },
    ],
    artifacts: [],
  }
  const events = [
    { id: 1, run_id: runId, type: "execution.recovered", data: {} },
    {
      id: 2,
      run_id: runId,
      type: "step.completed",
      data: { tool: "read_research_skill" },
    },
  ]
  await page.route("**/api/v1/agent/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname.split("/agent/")[1]
    if (req.method() === "POST") {
      writes.push({ path, body: req.postDataJSON() })
      if (lose) {
        lose = false
        return route.abort("failed")
      }
      return route.fulfill({
        status: 202,
        json: {
          task,
          run: task.runs[0],
          request_id: req.postDataJSON().request_id,
          accepted: true,
        },
      })
    }
    if (path === "capabilities")
      return route.fulfill({ json: executionCapabilityFixture })
    if (path === "personal-agent")
      return route.fulfill({ json: personalAgentFixture })
    if (path === "tasks") return route.fulfill({ json: [task] })
    if (path === `tasks/${id}`) return route.fulfill({ json: task })
    if (path.endsWith("/events")) {
      const after = Number(url.searchParams.get("after"))
      cursors.push(after)
      if (reconnect) {
        reconnect = false
        return route.abort("failed")
      }
      return route.fulfill({ json: events.filter((e) => e.id > after) })
    }
    return route.fulfill({ json: {} })
  })
  return {
    writes,
    cursors,
    events,
    disconnect: () => {
      reconnect = true
    },
  }
}
for (const kind of ["create", "message", "resume", "clarification"] as const) {
  test(`${kind} retains unacknowledged request identity and content across reload`, async ({
    page,
  }) => {
    const status =
      kind === "resume"
        ? "interrupted"
        : kind === "clarification"
          ? "waiting_for_input"
          : "succeeded"
    const f = await fixture(page, status)
    await page.goto(kind === "create" ? "/" : `/tasks/${id}`)
    const submit = async () => {
      if (kind === "resume")
        await page.getByRole("button", { name: "从已保存的材料恢复" }).click()
      else if (kind === "clarification")
        await page.getByRole("button", { name: "确认并继续" }).click()
      else await page.getByRole("button", { name: "发送研究问题" }).click()
    }
    if (kind === "clarification")
      await page
        .getByRole("textbox", { name: "科研口径" })
        .fill("方向，不是注意")
    else if (kind !== "resume")
      await page
        .getByRole("textbox", { name: "研究问题", exact: true })
        .fill("Explain synthetic orientation again")
    await submit()
    await expect.poll(() => f.writes.length).toBe(1)
    expect(f.writes[0].body.request_id).toMatch(/^[a-f0-9-]{36}$/)
    await page.reload()
    if (kind === "clarification")
      await expect(page.getByRole("textbox", { name: "科研口径" })).toHaveValue(
        "方向，不是注意",
      )
    else if (kind !== "resume")
      await expect(
        page.getByRole("textbox", { name: "研究问题", exact: true }),
      ).toHaveValue("Explain synthetic orientation again")
    await submit()
    await expect.poll(() => f.writes.length).toBe(2)
    expect(f.writes[1]).toEqual(f.writes[0])
    if (kind === "create")
      await expect(page).toHaveURL(new RegExp(`/tasks/${id}`))
  })
}
test("reopening fills only missing event suffix and closing the page never cancels the Run", async ({
  page,
}) => {
  const f = await fixture(page, "running")
  await page.goto(`/tasks/${id}`)
  await expect.poll(() => f.cursors.length).toBeGreaterThan(0)
  await expect(
    page.getByText("已从持久检查点恢复", { exact: false }),
  ).toBeVisible()
  await page.goto("/")
  f.events.push({
    id: 3,
    run_id: runId,
    type: "step.completed",
    data: { tool: "write_report" },
  })
  await page.goto(`/tasks/${id}`)
  await expect.poll(() => f.cursors.includes(2)).toBe(true)
  await expect(page.getByText("2 步已完成", { exact: false })).toBeVisible()
  expect(f.writes).toEqual([])
})

test("an ambiguous submission cannot silently change intent and acknowledgement releases its request ID", async ({
  page,
}) => {
  const f = await fixture(page)
  await page.goto(`/tasks/${id}`)
  const input = page.getByRole("textbox", { name: "研究问题", exact: true })
  const send = page.getByRole("button", { name: "发送研究问题" })
  await input.fill("Explain synthetic direction")
  await send.click()
  await expect.poll(() => f.writes.length).toBe(1)
  await expect(send).toBeEnabled()
  await input.fill("A different synthetic request")
  await send.click()
  await expect(
    page.getByText(
      "上次请求接收状态未确认。请恢复原文或刷新工作区后重试；不要重复创建任务。",
      { exact: true },
    ),
  ).toBeVisible()
  expect(f.writes).toHaveLength(1)
  await input.fill("Explain synthetic direction")
  await send.click()
  await expect.poll(() => f.writes.length).toBe(2)
  await expect(input).toHaveValue("")
  await input.fill("Explain synthetic direction")
  await send.click()
  await expect.poll(() => f.writes.length).toBe(3)
  expect(f.writes[2].body.request_id).not.toBe(f.writes[1].body.request_id)
})

test("transient event disconnect resumes the last cursor without duplicate progress or cancellation", async ({
  page,
}) => {
  const f = await fixture(page, "running")
  await page.goto(`/tasks/${id}`)
  await expect(page.getByText("1 步已完成", { exact: false })).toBeVisible()
  f.disconnect()
  await expect(page.getByText("进度连接已断开", { exact: false })).toBeVisible({
    timeout: 10000,
  })
  f.events.push({
    id: 3,
    run_id: runId,
    type: "step.completed",
    data: { tool: "write_report" },
  })
  await expect(page.getByText("2 步已完成", { exact: false })).toBeVisible({
    timeout: 10000,
  })
  expect(f.cursors.slice(1).every((cursor) => cursor >= 2)).toBe(true)
  expect(f.writes).toEqual([])
})
