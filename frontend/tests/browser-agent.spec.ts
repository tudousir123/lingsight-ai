import { expect, type Page, test } from "@playwright/test"
import {
  agentBrowserContract,
  agentExecutionContract,
  agentFilesContract,
  agentPersonalMemoryContract,
} from "../src/lib/upstreamRoutes.gen"
import {
  executionCapabilityFixture,
  personalAgentFixture,
  personalTaskBinding,
} from "./utils/personalAgentApi"
import { stubProjectsApi } from "./utils/projectsApi"

const taskId = "11111111-1111-4111-8111-111111111111",
  runId = "22222222-2222-4222-8222-222222222222"
test.use({ storageState: { cookies: [], origins: [] } })
async function fixture(
  page: Page,
  status = "running",
  lose = false,
  browserOverride: Record<string, unknown> = {},
  openPanel = true,
) {
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "synthetic-token")
    localStorage.setItem("lingsight.onboarding-seen.v1", "1")
  })
  stubProjectsApi(page)
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
  const task = {
    ...personalTaskBinding,
    id: taskId,
    title: "合成浏览器",
    goal: "合成浏览器",
    created_at: personalAgentFixture.created_at,
    artifacts: [],
    runs: [{ id: runId, instruction: "合成浏览器", status, error: null }],
  }
  const writes: Record<string, unknown>[] = [],
    grants: unknown[] = []
  await page.route("**/api/v1/agent/**", async (r) => {
    const req = r.request(),
      path = new URL(req.url()).pathname.split("/agent/")[1]
    if (req.method() === "POST") {
      writes.push(req.postDataJSON())
      if (lose && writes.length === 1) return r.abort("failed")
      grants.push({
        id: "grant-synthetic",
        ...req.postDataJSON(),
        expires_at: "2026-11-16T10:00:00Z",
        operation_id: null,
        file: null,
      })
      return r.fulfill({ status: 201, json: { grant: grants[0] } })
    }
    const json =
      path === "capabilities"
        ? {
            ...executionCapabilityFixture,
            files: agentFilesContract,
            personal_memory: agentPersonalMemoryContract,
            browser: {
              ...agentBrowserContract,
              enabled: true,
              javascript: false,
              downloads: false,
              ...browserOverride,
            },
          }
        : path === "personal-agent"
          ? personalAgentFixture
          : path === "tasks"
            ? [task]
            : path?.endsWith("/browser-grants")
              ? grants
              : path?.endsWith("/events") ||
                  path?.endsWith("/operations") ||
                  path === "memories"
                ? []
                : path === "inputs"
                  ? [
                      {
                        id: "owned-input",
                        name: "synthetic.txt",
                        bytes: 12,
                        sha256: "approved-sha",
                      },
                    ]
                  : task
    return r.fulfill({ json })
  })
  await page.goto(`/tasks/${taskId}`)
  if (openPanel)
    await page
      .getByText("受控浏览器 · 独立个人会话与单次授权", { exact: true })
      .click()
  return writes
}
async function fill(page: Page) {
  for (const [name, value] of [
    ["审核页面 URL", "https://synthetic.invalid/form"],
    ["提交目标 URL", "https://synthetic.invalid/effect"],
    ["表单选择器", "#approved"],
    ["提交按钮选择器", "#send"],
  ])
    await page.getByLabel(name, { exact: true }).fill(value)
  await page
    .getByLabel("精确表单字段 JSON")
    .fill('{"note":"approved synthetic action"}')
}
test("browser authorization is explicit exact one-use scope and owned file references only", async ({
  page,
}) => {
  const writes = await fixture(page)
  await fill(page)
  await expect(
    page.getByRole("button", { name: "授权一次提交", exact: true }),
  ).toBeDisabled()
  await page.getByLabel("授权上传材料").selectOption("owned-input")
  await page.getByLabel("文件表单字段名").fill("material")
  await page
    .getByRole("checkbox", {
      name: "我已核对目标、精确字段及上传材料，同意本次外部提交",
    })
    .check()
  await page.getByRole("button", { name: "授权一次提交", exact: true }).click()
  await expect(
    page.getByText("授权 grant-synthetic", { exact: true }),
  ).toBeVisible()
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({
    method: "POST",
    page_url: "https://synthetic.invalid/form",
    action_url: "https://synthetic.invalid/effect",
    form_selector: "#approved",
    submit_selector: "#send",
    fields: { note: "approved synthetic action" },
    file: { field: "material", input_id: "owned-input" },
  })
  expect(writes[0].request_id).toMatch(/^[a-f0-9-]{36}$/)
  expect(JSON.stringify(writes)).not.toContain("host_path")
})
test("lost authorization acknowledgement retries original request identity after reload", async ({
  page,
}) => {
  const writes = await fixture(page, "running", true)
  await fill(page)
  const check = page.getByRole("checkbox", {
    name: "我已核对目标、精确字段及上传材料，同意本次外部提交",
  })
  await check.check()
  await page.getByRole("button", { name: "授权一次提交", exact: true }).click()
  await expect(
    page.getByLabel("受控浏览器", { exact: true }).getByRole("alert"),
  ).toBeVisible()
  await page.reload()
  await page
    .getByText("受控浏览器 · 独立个人会话与单次授权", { exact: true })
    .click()
  await expect(page.getByLabel("审核页面 URL", { exact: true })).toHaveValue(
    "https://synthetic.invalid/form",
  )
  await check.check()
  await page.getByRole("button", { name: "授权一次提交", exact: true }).click()
  await expect(
    page.getByText("授权 grant-synthetic", { exact: true }),
  ).toBeVisible()
  expect(writes).toHaveLength(2)
  expect(writes[0]).toEqual(writes[1])
})
test("unknown browser result cannot be turned into fresh authorization by page content", async ({
  page,
}) => {
  const writes = await fixture(page, "result_unknown")
  await expect(
    page.getByText(
      "当前执行已结束或已请求停止，不能新建浏览器授权。请先核验原操作，不要盲目重复提交。",
    ),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "授权一次提交", exact: true }),
  ).toHaveCount(0)
  expect(writes).toHaveLength(0)
})

for (const [field, value] of [
  ["contract", "unsupported-browser-contract"],
  ["profile", "unsupported-owner-profile"],
  ["enabled", false],
  ["enabled", 1],
  ["javascript", true],
  ["javascript", 0],
  ["downloads", true],
  ["downloads", 0],
] as const) {
  test(`incompatible browser ${field}=${value} exposes no authorization`, async ({
    page,
  }) => {
    const writes = await fixture(
      page,
      "running",
      false,
      { [field]: value },
      false,
    )
    await expect(
      page.getByText(`Pi Durable · ${agentExecutionContract.version}`, {
        exact: true,
      }),
    ).toBeVisible()
    await expect(
      page.getByText("受控浏览器 · 独立个人会话与单次授权", { exact: true }),
    ).toHaveCount(0)
    await expect(page.getByLabel("审核页面 URL", { exact: true })).toHaveCount(
      0,
    )
    await expect(
      page.getByRole("button", { name: "授权一次提交", exact: true }),
    ).toHaveCount(0)
    expect(writes).toHaveLength(0)
  })
}
