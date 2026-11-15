import { expect, type Page, test } from "@playwright/test"
import {
  personalAgentFixture,
  personalTaskBinding,
} from "./utils/personalAgentApi"
import { stubProjectsApi } from "./utils/projectsApi"

const supported = {
  execution: {
    contract: "durable-run-v1",
    requests: "persistent-v1",
    recovery: "safe-v1",
    engine: "pi-durable",
    version: "1.5.2",
    enabled: true,
  },
}
const id = "11111111-1111-4111-8111-111111111111"
const runId = "22222222-2222-4222-8222-222222222222"
const artifactId = "33333333-3333-4333-8333-333333333333"
test.use({ storageState: { cookies: [], origins: [] } })

async function fixture(
  page: Page,
  capability: unknown = supported,
  status = "succeeded",
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
  const writes: string[] = []
  const task = {
    ...personalTaskBinding,
    id,
    title: "合成分析",
    goal: "合成分析",
    created_at: personalAgentFixture.created_at,
    runs: [
      {
        id: runId,
        instruction: "合成分析",
        status,
        error: null,
        execution: {
          id: "execution-77",
          engine: "pi-durable",
          version: "1.5.2",
          conversation_id: 1,
          submission_id: 2,
        },
        clarifications: [
          { id: artifactId, question: "合成口径确认", answer: null },
        ],
        answer:
          status === "succeeded"
            ? { text: "合成解释已完成，无真实科研数据。" }
            : null,
      },
    ],
    artifacts: [
      {
        id: artifactId,
        run_id: runId,
        kind: "report",
        name: "synthetic.md",
        bytes: 120,
        sha256: "abc123",
      },
    ],
  }
  await page.route("**/api/v1/agent/**", async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname.split("/agent/")[1]
    if (req.method() === "POST") {
      writes.push(path)
      return route.fulfill({ status: 202, json: { task, run: task.runs[0] } })
    }
    if (path === "capabilities") return route.fulfill({ json: capability })
    if (path === "personal-agent")
      return route.fulfill({ json: personalAgentFixture })
    if (path === "tasks") return route.fulfill({ json: [task] })
    if (path === `tasks/${id}/events`)
      return route.fulfill({
        json: [
          {
            id: 1,
            run_id: runId,
            type: "step.completed",
            data: { tool: "write_report" },
          },
        ],
      })
    if (path === `tasks/${id}`) return route.fulfill({ json: task })
    if (path === `artifacts/${artifactId}`)
      return route.fulfill({
        contentType: "text/markdown",
        body: "# 合成结果\n\n来源：合成用户输入；无真实数据。\n\n内容版本：abc123。",
      })
    return route.fulfill({ json: {} })
  })
  return { writes, task }
}

for (const [name, capability] of [
  ["legacy", {}],
  [
    "legacy-requests",
    {
      execution: {
        contract: "durable-run-v1",
        engine: "pi-durable",
        version: "1.5.2",
        enabled: true,
      },
    },
  ],
  ["missing", { execution: null }],
  ["invalid", { execution: { ...supported.execution, enabled: "true" } }],
  ["disabled", { execution: { ...supported.execution, enabled: false } }],
] as const) {
  test(`${name} Durable service disables submissions without any execution write`, async ({
    page,
  }) => {
    const { writes } = await fixture(page, capability)
    await page.goto("/")
    const input = page.getByRole("textbox", { name: "研究问题", exact: true })
    await input.fill("保留合成问题")
    await expect(
      page.getByRole("button", { name: "发送研究问题" }),
    ).toBeDisabled()
    await input.press("Enter")
    await input.evaluate((el) => el.closest("form")?.requestSubmit())
    await expect(input).toHaveValue("保留合成问题")
    expect(writes).toEqual([])
    await expect(page.getByRole("region", { name: "执行引擎" })).toContainText(
      /不可用|未配置/,
    )
  })
}

test("supported Durable task shows execution, progress and a sourced versioned preview/download", async ({
  page,
}) => {
  await fixture(page)
  await page.goto("/")
  await page
    .getByRole("textbox", { name: "研究问题", exact: true })
    .fill("合成分析")
  await page.getByRole("button", { name: "发送研究问题" }).click()
  await expect(page).toHaveURL(new RegExp(`/tasks/${id}`))
  await expect(page.getByRole("region", { name: "执行引擎" })).toContainText(
    "Pi Durable",
  )
  await expect(
    page.getByText("合成解释已完成，无真实科研数据。", { exact: true }),
  ).toBeVisible()
  await expect(page.getByText(/科研流程/)).toContainText("1 步已完成")
  await expect(page.getByText(/execution-77/)).toBeVisible()
  await page.getByRole("button", { name: /synthetic.md/ }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText("已保留来源与版本")
  await expect(dialog).toContainText("内容 SHA-256：abc123")
  await expect(dialog).toContainText("来源：合成用户输入；无真实数据。")
  const downloaded = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "下载文件" }).click()
  expect((await downloaded).suggestedFilename()).toBe("synthetic.md")
  await page.keyboard.press("Escape")
  await page.reload()
  await expect(page.getByText(/execution-77/)).toBeVisible()
})

for (const status of ["failed", "waiting_for_input"] as const) {
  test(`missing Durable capability disables ${status} continuation but preserves artifact reads`, async ({
    page,
  }) => {
    const { writes } = await fixture(page, {}, status)
    await page.goto(`/tasks/${id}`)
    if (status === "failed")
      await expect(
        page.getByRole("button", { name: "从已保存的材料恢复" }),
      ).toBeDisabled()
    else {
      await expect(
        page.getByRole("textbox", { name: "科研口径", exact: true }),
      ).toBeDisabled()
      await expect(
        page.getByRole("button", { name: "确认并继续" }),
      ).toBeDisabled()
    }
    await page.getByRole("button", { name: /synthetic.md/ }).click()
    await expect(page.getByRole("dialog")).toContainText("合成结果")
    expect(writes).toEqual([])
  })
}

test("a failed capability refresh cannot reuse a formerly enabled execution grant", async ({
  page,
}) => {
  await page.clock.install()
  const { writes } = await fixture(page)
  await page.goto("/")
  await expect(page.getByRole("region", { name: "执行引擎" })).toContainText(
    "Pi Durable",
  )
  const input = page.getByRole("textbox", { name: "研究问题", exact: true })
  await input.fill("刷新失败后保留问题")
  await page.route("**/api/v1/agent/capabilities", (route) =>
    route.fulfill({ status: 503, json: { detail: "合成能力故障" } }),
  )
  await page.clock.fastForward(5100)
  await expect(page.getByRole("region", { name: "执行引擎" })).toContainText(
    "执行能力不可用",
  )
  await expect(
    page.getByRole("button", { name: "发送研究问题" }),
  ).toBeDisabled()
  await input.press("Enter")
  await input.evaluate((el) => el.closest("form")?.requestSubmit())
  await expect(input).toHaveValue("刷新失败后保留问题")
  expect(writes).toEqual([])
  await page.route("**/api/v1/agent/capabilities", (route) =>
    route.fulfill({ json: supported }),
  )
  await page.getByRole("button", { name: "重试执行能力" }).click()
  await expect(page.getByRole("button", { name: "发送研究问题" })).toBeEnabled()
})
