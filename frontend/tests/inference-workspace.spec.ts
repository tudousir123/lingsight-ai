import { expect, test } from "@playwright/test"

test.use({ storageState: { cookies: [], origins: [] } })

test("预标注编辑在轮询后保留，并作为独立确认提交", async ({ page }) => {
  const id = "11111111-1111-4111-8111-111111111111"
  const marks = Array.from({ length: 4 }, (_, i) => ({
    label: `mark-${i}`,
    polygon: [
      [1, 1],
      [2, 1],
      [1, 2],
    ],
  }))
  let status = "waiting_for_review"
  let confirmation: unknown = null
  const task = () => ({
    id,
    video_id: "one",
    status,
    stage: status === "queued" ? "tracking" : "preannotation",
    error: null,
    review: null,
    candidate: {
      width: 100,
      height: 100,
      frame_count: 100,
      seed: { frame: 3, x: 20, y: 25 },
      pool: { cx: 50, cy: 50, radius: 35 },
      marks,
      evidence: { review_reasons: [] },
    },
  })
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "test-token")
    localStorage.setItem("lingsight.onboarding-seen.v1", "1")
  })
  await page.route("**/api/v1/users/me", (route) =>
    route.fulfill({
      json: {
        id: "user",
        email: "owner@example.com",
        full_name: "研究者",
        is_active: true,
        is_superuser: false,
      },
    }),
  )
  await page.route("**/api/v1/inference/**", async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith("/videos"))
      return route.fulfill({
        json: { items: [{ type: "video", name: "test.mp4", id: "one" }] },
      })
    if (url.pathname.endsWith("/tasks") && route.request().method() === "GET")
      return route.fulfill({ json: { items: [task()] } })
    if (url.pathname.endsWith("/confirm")) {
      confirmation = route.request().postDataJSON()
      status = "queued"
      return route.fulfill({ json: task() })
    }
    if (url.pathname.endsWith("candidate.jpg"))
      return route.fulfill({ status: 404 })
    return route.fulfill({ json: task() })
  })
  await page.goto("/inference")
  await page.getByRole("button", { name: /等待预标注确认/ }).click()
  await page.getByLabel("小鼠 X").fill("24")
  await page.waitForTimeout(3300)
  await expect(page.getByLabel("小鼠 X")).toHaveValue("24")
  await page.getByRole("button", { name: "确认并开始追踪" }).click()
  await expect
    .poll(() => confirmation)
    .toMatchObject({
      seed: { frame: 3, x: 24, y: 25 },
      pool: { cx: 50, cy: 50, radius: 35 },
      marks,
    })
  await expect(page.getByRole("heading", { name: /排队中/ })).toBeVisible()
})
