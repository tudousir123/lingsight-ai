import { expect, type Page, test } from "@playwright/test"
import { stubProjectsApi } from "./utils/projectsApi"

test.skip(
  process.env.VITE_LINGSIGHT_MOCK_TOOLS !== "true",
  "Requires the mock workspace",
)
test.use({ storageState: { cookies: [], origins: [] } })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "mock-workspace-test")
    localStorage.setItem("lingsight.onboarding-seen.v1", "1")
  })
  stubProjectsApi(page, [])
  await page.route("**/api/v1/users/me", (route) =>
    route.fulfill({
      json: {
        id: "mock-user",
        email: "researcher@example.com",
        is_active: true,
        is_superuser: false,
      },
    }),
  )
  await page.route("**/api/v1/agent/tasks", (route) =>
    route.fulfill({ json: [] }),
  )
  await page.goto("/")
})

async function send(page: Page, message?: string) {
  if (message)
    await page.getByRole("textbox", { name: "研究目标" }).fill(message)
  await page.getByRole("button", { name: "发送研究目标" }).click()
}

test("从同一对话建项目、选网盘视频、确认推理并导出训练日对比", async ({
  page,
}) => {
  await page.getByRole("button", { name: "从网盘比较训练日" }).click()
  await expect(page.getByText(/已创建项目/)).toHaveCount(0)
  await send(page)
  await expect(
    page.getByRole("heading", { name: "水迷宫训练日对比" }),
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "加入项目" })).toBeDisabled()
  await page.getByRole("checkbox", { name: /Day 1 · Trial 01/ }).check()
  await page.getByRole("checkbox", { name: /Day 5 · Trial 01/ }).check()
  await page.getByRole("button", { name: "加入项目" }).click()
  await send(page, "先不要开始推理")
  await expect(page.getByRole("button", { name: "开始推理" })).toBeVisible()
  await send(page, "请开始推理")
  await expect(
    page.getByRole("progressbar", { name: "视频推理进度" }),
  ).toBeVisible()
  await page.getByRole("button", { name: "按训练日对比" }).click()
  const table = page.getByRole("table")
  await expect(table.getByRole("rowheader", { name: "第 1 天" })).toBeVisible()
  await expect(table.getByRole("rowheader", { name: "第 5 天" })).toBeVisible()
  await expect(page.getByText("模拟结果")).toBeVisible()
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "导出 CSV" }).click()
  expect((await download).suggestedFilename()).toBe(
    "lingsight-simulated-analysis.csv",
  )
  await expect(page).toHaveURL(/\/$/)
})

test("手机可选本地文件，缺训练日时仅按视频汇总", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("button", { name: "从本地分析视频" }).click()
  await send(page)
  await page.getByLabel("选择本地视频").setInputFiles({
    name: "local-trial.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("mock file"),
  })
  await page.getByRole("button", { name: "加入项目" }).click()
  await page.getByRole("button", { name: "开始推理" }).click()
  await expect(
    page.getByRole("button", { name: "按训练日对比" }),
  ).toBeDisabled()
  await page.getByRole("button", { name: "按视频汇总" }).click()
  await expect(
    page.getByRole("rowheader", { name: "local-trial.mp4" }),
  ).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  )
  await expect(page.getByRole("textbox", { name: "研究目标" })).toBeInViewport()
})
