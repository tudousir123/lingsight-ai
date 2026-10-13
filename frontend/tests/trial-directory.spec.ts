import { expect, test } from "@playwright/test"

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

test("researcher selects a trial and reloads its stable address", async ({
  page,
}) => {
  await page.route("**/api/v1/experiments", (route) =>
    route.fulfill({ json: { data: [experiment] } }),
  )
  await page.route("**/api/v1/experiments/fixture-e1/trials?*", (route) =>
    route.fulfill({ json: { data: [trial, otherTrial], count: 2 } }),
  )
  await page.route("**/api/v1/experiments/fixture-e1/trials/trial-a", (route) =>
    route.fulfill({ json: trial }),
  )

  await page.goto("/")
  await expect(
    page.getByRole("heading", { name: "实验与视频管理" }),
  ).toBeVisible()
  await expect(page.getByText("sample-a.mp4")).toBeVisible()
  await page.getByRole("textbox", { name: "搜索试次" }).fill("A2 2")
  await expect(page.getByText("sample-b.mp4")).toHaveCount(0)
  await page.getByRole("link", { name: "查看试次 sample-a.mp4" }).click()

  await expect(page).toHaveURL(/\/experiments\/fixture-e1\/trials\/trial-a$/)
  await expect(
    page.getByRole("heading", { name: "sample-a.mp4" }),
  ).toBeVisible()
  await expect(page.getByText("A2 · 2")).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "sample-a.mp4" }),
  ).toBeVisible()
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

  await page.goto("/")
  await expect(page.getByText("实验列表加载失败")).toBeVisible()
  await page.getByRole("button", { name: "重试" }).click()
  await expect(page.getByText("暂无可访问的实验")).toBeVisible()
})

test("a trial in an ungranted experiment stays forbidden", async ({ page }) => {
  await page.route("**/api/v1/experiments/fixture-e2/trials/trial-c", (route) =>
    route.fulfill({
      status: 403,
      json: { detail: "Experiment access denied" },
    }),
  )
  await page.goto("/experiments/fixture-e2/trials/trial-c")
  await expect(page.getByText("无权访问此实验")).toBeVisible()
  await expect(page).toHaveURL(/\/experiments\/fixture-e2\/trials\/trial-c$/)
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
  await page.goto("/")
  await expect(page.getByText("该实验没有符合条件的试次。")).toBeVisible()
})
