import { expect, test } from "@playwright/test"
import { stubProjectsApi } from "./utils/projectsApi"

test.use({ storageState: { cookies: [], origins: [] } })
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "directory-test")
    localStorage.setItem("lingsight.onboarding-seen.v1", "1")
  })
  await page.route("**/api/v1/users/me", (route) =>
    route.fulfill({
      json: {
        id: "directory-user",
        email: "directory@example.com",
        is_active: true,
      },
    }),
  )
  stubProjectsApi(page, [])
  await page.route("**/api/v1/agent/tasks", (route) =>
    route.fulfill({ json: [] }),
  )
})

const experiment = { id: "fixture-e1", name: "示例实验一", trial_count: 2 }
const trial = {
  id: "trial-a",
  experiment_id: "fixture-e1",
  video_name: "sample-a.mp4",
  group_name: "A2",
  mouse_id: "2",
  phase: "training_day",
  date_dir: "0804",
  training_day: 1,
  session_no: 1,
  session_label: "第1次",
  trial_no: "4",
  media_available: true,
  result_available: false,
}
const otherTrial = {
  ...trial,
  id: "trial-b",
  video_name: "sample-b.mp4",
  group_name: "c1",
  mouse_id: "1",
  phase: "probe_platform_present",
  date_dir: "0809",
  training_day: null,
  session_no: 2,
  session_label: "第2象限",
  trial_no: "1",
}

test("researcher filters the retained directory and reloads it", async ({
  page,
}) => {
  await page.route("**/api/v1/experiments", (route) =>
    route.fulfill({ json: { data: [experiment] } }),
  )
  await page.route("**/api/v1/experiments/fixture-e1/trials?*", (route) =>
    route.fulfill({ json: { data: [trial, otherTrial], count: 2 } }),
  )
  await page.goto("/annotations?view=directory")
  await expect(page.getByRole("tab", { name: "试次目录" })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await expect(page.getByText("sample-a.mp4")).toBeVisible()
  await page.getByRole("textbox", { name: "搜索试次" }).fill("A2 2")
  await expect(page.getByText("sample-b.mp4")).toHaveCount(0)
  // ADR-0014 retired trial preparation; the retained directory exposes IDs.
  await expect(
    page.getByTitle("试次详情页已随旧分析闭环下线：sample-a.mp4"),
  ).toHaveText("trial-a")
  await expect(page.getByRole("link", { name: /打开分析准备/ })).toHaveCount(0)
  await page.reload()
  await expect(page.getByText("sample-a.mp4")).toBeVisible()
  await expect(page.getByText("sample-b.mp4")).toBeVisible()
})

test("empty experiment list and retryable load failure are distinct", async ({
  page,
}) => {
  let calls = 0
  await page.route("**/api/v1/experiments", (route) => {
    calls += 1
    if (calls === 1) {
      return route.fulfill({
        status: 503,
        json: { detail: "Research catalog unavailable" },
      })
    }
    return route.fulfill({ json: { data: [] } })
  })

  await page.goto("/annotations?view=directory")
  await expect(page.getByText("实验列表加载失败")).toBeVisible()
  await page.getByRole("button", { name: "重试" }).click()
  await expect(page.getByText("暂无可访问的实验")).toBeVisible()
})

test("an ungranted experiment never reveals its trials", async ({ page }) => {
  await page.route("**/api/v1/experiments", (route) =>
    route.fulfill({ json: { data: [experiment] } }),
  )
  await page.route("**/api/v1/experiments/fixture-e1/trials?*", (route) =>
    route.fulfill({
      status: 403,
      json: { detail: "Experiment access denied" },
    }),
  )
  await page.goto("/annotations?view=directory")
  await expect(page.getByText("试次列表加载失败")).toBeVisible()
  await expect(page.getByText("sample-a.mp4")).toHaveCount(0)
})

test("an experiment with no matching trials has an empty state", async ({
  page,
}) => {
  await page.route("**/api/v1/experiments", (route) =>
    route.fulfill({ json: { data: [experiment] } }),
  )
  await page.route("**/api/v1/experiments/fixture-e1/trials?*", (route) =>
    route.fulfill({ json: { data: [], count: 0 } }),
  )
  await page.goto("/annotations?view=directory")
  await expect(page.getByText("该实验没有符合条件的试次。")).toBeVisible()
})

test("researcher filters by training-day number", async ({ page }) => {
  await page.route("**/api/v1/experiments", (route) =>
    route.fulfill({ json: { data: [experiment] } }),
  )
  await page.route("**/api/v1/experiments/fixture-e1/trials?*", (route) => {
    const dateDir = new URL(route.request().url()).searchParams.get("date_dir")
    return route.fulfill({
      json: {
        data: dateDir === "0804" ? [trial] : [trial, otherTrial],
        count: dateDir === "0804" ? 1 : 2,
      },
    })
  })

  await page.goto("/annotations?view=directory")
  await page.getByRole("combobox", { name: "训练日" }).click()
  await page.getByRole("option", { name: "第 1 训练日" }).click()
  await expect(page.getByText("sample-a.mp4")).toBeVisible()
  await expect(page.getByText("sample-b.mp4")).toHaveCount(0)
})
