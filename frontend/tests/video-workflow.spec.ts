import { expect, test } from "@playwright/test"
import { stubProjectsApi } from "./utils/projectsApi"

test.use({ storageState: { cookies: [], origins: [] } })
test.skip(
  process.env.VITE_MOCK_VIDEO_WORKFLOW !== "true",
  "Requires the mock workflow preview",
)

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "test-token")
    localStorage.setItem("lingsight.onboarding-seen.v1", "1")
  })
  stubProjectsApi(page)
  await page.route("**/api/v1/users/me", (route) =>
    route.fulfill({
      json: { id: "test-user", email: "user@example.com", is_active: true },
    }),
  )
  await page.route("**/api/v1/agent/tasks", (route) =>
    route.fulfill({ json: [] }),
  )
})

test("网盘视频在项目对话内逐步核对、导入和分析", async ({ page }) => {
  await page.goto("/projects/learning-memory")
  await page.getByRole("button", { name: "上传视频", exact: true }).click()
  await page.getByRole("button", { name: "网盘", exact: true }).click()
  await page.getByRole("checkbox", { name: /训练第 1 天/ }).check()
  await page.getByRole("checkbox", { name: /训练第 5 天/ }).check()
  await page.getByRole("button", { name: "添加所选视频" }).click()
  const composer = page.getByRole("textbox", { name: "研究问题" })
  const goal = "比较训练日的逃逸潜伏期"
  await composer.fill(goal)
  await page.getByRole("button", { name: "发送研究问题" }).click()
  const progress = page.getByRole("list", { name: "视频分析进度" })
  const current = progress.locator('[aria-current="step"]')
  await expect(current).toContainText("人工核对")
  await expect(page.getByText("正式推理完成", { exact: false })).toHaveCount(0)
  await expect(composer).toBeDisabled()

  await page.getByRole("button", { name: "退回修改" }).click()
  await page.getByRole("textbox", { name: "核对意见" }).fill("复查头尾点")
  await page.getByRole("button", { name: "按意见重跑" }).click()
  await expect(page.getByText("第 2 版 · 待确认")).toBeVisible()
  await expect(page.getByText(/上次核对意见：复查头尾点/)).toBeVisible()
  await page.reload()
  await expect(current).toContainText("人工核对")
  await expect(page.getByText("第 2 版 · 待确认")).toBeVisible()
  await page.getByRole("button", { name: "通过，开始正式推理" }).click()
  await expect(current).toContainText("核对入库")
  await expect(page.getByRole("table")).toContainText("29.8")
  await expect(page.getByRole("heading", { name: "已导入 MySQL" })).toHaveCount(
    0,
  )
  await expect(composer).toBeDisabled()
  await page.getByRole("button", { name: "通过，确认入库" }).click()
  await expect(
    page.getByRole("heading", { name: "已导入 MySQL" }),
  ).toBeVisible()
  await expect(current).toContainText("分析数据库")
  await page.getByRole("button", { name: "分析已入库数据" }).click()
  await expect(
    page.getByRole("heading", { name: "数据库分析", exact: true }),
  ).toBeVisible()
  await expect(page.getByText(/读取 2 段视频的模拟记录/)).toBeVisible()
  await expect(page.getByText(/只能做视频级描述统计/)).toBeVisible()
  await composer.fill("查看有效轨迹覆盖率")
  await composer.press("Enter")
  await expect(
    page.getByRole("heading", { name: "数据库分析", exact: true }),
  ).toHaveCount(2)

  await page
    .locator(".workspace-scope")
    .getByRole("link", { name: "学习与记忆" })
    .click()
  await page
    .getByRole("region", { name: "项目对话" })
    .getByRole("link", { name: new RegExp(goal) })
    .click()
  await expect(
    page.getByRole("heading", { name: "数据库分析", exact: true }),
  ).toHaveCount(2)
})

test("本地视频可单独发送，并可在发送前移除", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: /水迷宫分析/ }).click()
  await expect(
    page.getByRole("button", { name: "网盘", exact: true }),
  ).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("button", { name: "Close", exact: true }).click()
  await page.getByRole("button", { name: /本地视频.*选择本次实验录像/ }).click()
  await expect(
    page.getByRole("button", { name: "本地文件", exact: true }),
  ).toHaveAttribute("aria-pressed", "true")
  await page.locator('input[type="file"]').setInputFiles([
    {
      name: "trial-a.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from("fixture"),
    },
    {
      name: "trial-b.mov",
      mimeType: "video/quicktime",
      buffer: Buffer.from("fixture"),
    },
  ])
  await page.getByRole("textbox", { name: "研究问题" }).clear()
  const selected = page.getByRole("list", { name: "已选视频" })
  await expect(selected.getByRole("listitem")).toHaveCount(2)
  await page.getByRole("button", { name: "移除 trial-b.mov" }).click()
  await page.getByRole("button", { name: "发送研究问题" }).click()
  await expect(page.getByRole("heading", { name: "trial-a.mp4" })).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "请核对预标注" }),
  ).toBeVisible()
  await expect(selected.getByRole("listitem")).toHaveCount(1)
})
