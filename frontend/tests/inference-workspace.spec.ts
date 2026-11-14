import { expect, type Page, test } from "@playwright/test"
import { stubProjectsApi } from "./utils/projectsApi"

test.use({ storageState: { cookies: [], origins: [] } })

async function mockWorkspace(page: Page) {
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
  stubProjectsApi(page)
}

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
  await mockWorkspace(page)
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

test("视频目录浏览可归入项目并从项目页移出", async ({ page }) => {
  await mockWorkspace(page)
  await page.route("**/api/v1/inference/**", (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith("/videos"))
      return route.fulfill({
        json: {
          items: [{ type: "video", name: "Day5-Trial3.mp4", id: "vid-77" }],
        },
      })
    if (url.pathname.endsWith("/tasks") && route.request().method() === "GET")
      return route.fulfill({ json: { items: [] } })
    return route.fulfill({ status: 404, json: { detail: "not stubbed" } })
  })
  await page.goto("/inference")
  await page
    .getByRole("button", { name: "将 Day5-Trial3.mp4 归入项目" })
    .click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "学习与记忆", exact: true }).click()
  await expect(
    dialog.getByText("已将“Day5-Trial3.mp4”归入“学习与记忆”。"),
  ).toBeVisible()
  await page.goto("/projects/learning-memory?view=details")
  await expect(
    page.getByRole("tabpanel").getByText("Day5-Trial3.mp4", { exact: true }),
  ).toBeVisible()
  await page.getByRole("button", { name: "移出视频 Day5-Trial3.mp4" }).click()
  await expect(page.getByText("暂无原始视频。")).toBeVisible()
})

const publishedResult = (taskId: string) => ({
  task_id: taskId,
  project_id: "learning-memory",
  video_id: "day01/maze.mp4",
  fps: 30,
  total_frames: 600,
  valid_frames: 580,
  frames_with_heading: 570,
  proposal_frames: 12,
  heading_algorithm: "frozen-ball-chord-7px-v1",
  keypoint_protocol: "fixed-mask-centroid-crop256-fp32-v9",
  video_sha256: "a".repeat(64),
  content_fingerprint: "f".repeat(64),
  review_note: "看过叠加视频",
  published_at: "2026-11-10T10:00:00Z",
  replayed: false,
})

test("复核通过后出现发布动作，发布结果进项目且重放幂等", async ({ page }) => {
  const taskId = "44444444-4444-4444-8444-444444444444"
  let publishCount = 0
  const task = {
    id: taskId,
    video_id: "day01/maze.mp4",
    status: "succeeded",
    stage: "overlay",
    error: null,
    review: { tracking_ok: true, note: "看过叠加视频" },
    candidate: null,
    confirmed: null,
  }
  await mockWorkspace(page)
  await page.route("**/api/v1/inference/**", (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith("/tasks") && route.request().method() === "GET")
      return route.fulfill({ json: { items: [task] } })
    return route.fulfill({ status: 404, json: { detail: "not stubbed" } })
  })
  await page.route("**/api/v1/projects/*/results", async (route) => {
    if (route.request().method() !== "POST")
      return route.fulfill({ json: { data: [], count: 0 } })
    expect(route.request().postDataJSON()).toEqual({ task_id: taskId })
    publishCount += 1
    return route.fulfill({
      status: publishCount === 1 ? 201 : 200,
      json: { ...publishedResult(taskId), replayed: publishCount > 1 },
    })
  })
  await page.goto("/inference")
  await page.getByRole("button", { name: /推理完成/ }).click()
  await page.getByRole("button", { name: "发布到项目" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "学习与记忆", exact: true }).click()
  await expect(
    dialog.getByText(/已发布到“学习与记忆”：570 帧带朝向/),
  ).toBeVisible()
  await dialog.getByRole("button", { name: "学习与记忆", exact: true }).click()
  await expect(dialog.getByText(/幂等重放/)).toBeVisible()
  expect(publishCount).toBe(2)
})

test("未通过复核的结果不出现发布动作", async ({ page }) => {
  const task = {
    id: "55555555-5555-4555-8555-555555555555",
    video_id: "day01/maze.mp4",
    status: "succeeded",
    stage: "overlay",
    error: null,
    review: { tracking_ok: false, note: "轨迹断了" },
    candidate: null,
    confirmed: null,
  }
  await mockWorkspace(page)
  await page.route("**/api/v1/inference/**", (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith("/tasks") && route.request().method() === "GET")
      return route.fulfill({ json: { items: [task] } })
    return route.fulfill({ status: 404, json: { detail: "not stubbed" } })
  })
  await page.goto("/inference")
  await page.getByRole("button", { name: /推理完成/ }).click()
  await expect(page.getByText("结果已核对：需复查")).toBeVisible()
  await expect(page.getByRole("button", { name: "发布到项目" })).toHaveCount(0)
})

test("发布失败呈现服务端拒绝原因", async ({ page }) => {
  const taskId = "66666666-6666-4666-8666-666666666666"
  const task = {
    id: taskId,
    video_id: "day01/maze.mp4",
    status: "succeeded",
    stage: "overlay",
    error: null,
    review: { tracking_ok: true, note: "" },
    candidate: null,
    confirmed: null,
  }
  await mockWorkspace(page)
  await page.route("**/api/v1/inference/**", (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith("/tasks") && route.request().method() === "GET")
      return route.fulfill({ json: { items: [task] } })
    return route.fulfill({ status: 404, json: { detail: "not stubbed" } })
  })
  await page.route("**/api/v1/projects/*/results", (route) =>
    route.fulfill({
      status: 409,
      json: { detail: "只有通过人工复核（tracking_ok）的推理任务才能发布" },
    }),
  )
  await page.goto("/inference")
  await page.getByRole("button", { name: /推理完成/ }).click()
  await page.getByRole("button", { name: "发布到项目" }).click()
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "学习与记忆", exact: true })
    .click()
  await expect(
    page.getByRole("dialog").getByText(/只有通过人工复核/),
  ).toBeVisible()
})

test("目录 URL 保留来源并支持刷新和前进后退 (#59)", async ({ page }) => {
  await mockWorkspace(page)
  const requests: string[] = []
  await page.route("**/api/v1/inference/**", (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith("/videos")) {
      requests.push(url.search)
      const path = url.searchParams.get("path") || ""
      return route.fulfill({
        json: {
          items: path
            ? [{ type: "video", name: "sample.mp4", id: "sample" }]
            : [{ type: "directory", name: "批次 A", path: "批次 A" }],
        },
      })
    }
    return route.fulfill({ json: { items: [] } })
  })
  await page.goto("/inference?source_id=source-a")
  await page.getByRole("button", { name: "打开", exact: true }).click()
  await expect
    .poll(() => new URL(page.url()).searchParams.get("path"))
    .toBe("批次 A")
  expect(new URL(page.url()).searchParams.get("source_id")).toBe("source-a")
  await expect(page.getByText(/sample\.mp4/)).toBeVisible()
  await page.reload()
  await expect(page.getByText(/sample\.mp4/)).toBeVisible()
  await page.goBack()
  await expect(page.getByText("实验视频目录", { exact: true })).toBeVisible()
  await page.goForward()
  await expect(page.getByText(/sample\.mp4/)).toBeVisible()
  await page.getByRole("button", { name: "返回上一级", exact: true }).click()
  await expect(page.getByText("实验视频目录", { exact: true })).toBeVisible()
  expect(new URL(page.url()).searchParams.get("path")).toBeNull()
  expect(
    requests.every(
      (query) => new URLSearchParams(query).get("source_id") === "source-a",
    ),
  ).toBe(true)
})

test("后退后迟到的目录响应不能覆盖当前位置 (#59)", async ({ page }) => {
  await mockWorkspace(page)
  let release = () => {}
  await page.route("**/api/v1/inference/**", async (route) => {
    const url = new URL(route.request().url())
    if (!url.pathname.endsWith("/videos"))
      return route.fulfill({ json: { items: [] } })
    if (url.searchParams.get("path")) {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return route.fulfill({
        json: { items: [{ type: "video", name: "stale.mp4", id: "stale" }] },
      })
    }
    return route.fulfill({
      json: { items: [{ type: "directory", name: "目录", path: "folder" }] },
    })
  })
  await page.goto("/inference")
  const pending = page.waitForRequest(
    (request) => new URL(request.url()).searchParams.get("path") === "folder",
  )
  await page.getByRole("button", { name: "打开", exact: true }).click()
  await pending
  await page.goBack()
  await expect(page.getByText("实验视频目录", { exact: true })).toBeVisible()
  const completed = page
    .waitForResponse(
      (response) =>
        new URL(response.url()).searchParams.get("path") === "folder",
    )
    .catch(() => null)
  release()
  await completed
  await expect(
    page.getByRole("button", { name: "打开", exact: true }),
  ).toBeVisible()
  await expect(page.getByText(/stale\.mp4/)).toHaveCount(0)
})
