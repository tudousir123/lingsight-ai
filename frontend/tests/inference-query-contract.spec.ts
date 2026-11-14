import { expect, type Page, type Request, test } from "@playwright/test"
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

function deferred() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

const root = {
  items: [
    { type: "directory", name: "dir-a", path: "a" },
    { type: "directory", name: "dir-b", path: "b" },
  ],
}
const dirItems: Record<string, unknown> = {
  "": root,
  a: { items: [{ type: "video", name: "a-video.mp4", id: "va" }] },
  b: { items: [{ type: "video", name: "b-video.mp4", id: "vb" }] },
}

type VideosHandler = (
  path: string,
  count: number,
  route: import("@playwright/test").Route,
) => Promise<void> | void

// 按目录路径与该目录的第几次请求分派 videos GET；其余推理接口给空任务列表。
async function mockVideos(page: Page, handler?: VideosHandler) {
  const counts: Record<string, number> = {}
  await page.route("**/api/v1/inference/**", async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith("/videos")) {
      const path = url.searchParams.get("path") ?? ""
      counts[path] = (counts[path] ?? 0) + 1
      if (handler) return handler(path, counts[path], route)
      return route.fulfill({ json: dirItems[path] })
    }
    if (url.pathname.endsWith("/tasks") && route.request().method() === "GET")
      return route.fulfill({ json: { items: [] } })
    return route.fulfill({ status: 404, json: { detail: "not stubbed" } })
  })
  return counts
}

const videosPath = (request: Request, path: string) =>
  request.url().includes("/videos") &&
  new URL(request.url()).searchParams.get("path") === path

test("切换目录时中止上一个目录的在途请求", async ({ page }) => {
  const hold = deferred()
  await mockWorkspace(page)
  await mockVideos(page, async (path, _count, route) => {
    if (path === "a") {
      await hold.promise
      return route.abort().catch(() => {})
    }
    return route.fulfill({ json: dirItems[path] })
  })
  const failed: string[] = []
  page.on("requestfailed", (request) => {
    if (videosPath(request, "a"))
      failed.push(request.failure()?.errorText ?? "")
  })
  await page.goto("/inference")
  const requestA = page.waitForRequest((r) => videosPath(r, "a"))
  await page.getByRole("button", { name: "打开" }).first().click()
  await requestA
  await page.getByRole("button", { name: "返回上一级" }).click()
  await expect.poll(() => failed).toContain("net::ERR_ABORTED")
  hold.release()
})

test("离开推理页（卸载）时中止在途的目录请求", async ({ page }) => {
  const hold = deferred()
  await mockWorkspace(page)
  await mockVideos(page, async (path, _count, route) => {
    if (path === "a") {
      await hold.promise
      return route.abort().catch(() => {})
    }
    return route.fulfill({ json: dirItems[path] })
  })
  const failed: string[] = []
  page.on("requestfailed", (request) => {
    if (videosPath(request, "a"))
      failed.push(request.failure()?.errorText ?? "")
  })
  await page.goto("/inference")
  const requestA = page.waitForRequest((r) => videosPath(r, "a"))
  await page.getByRole("button", { name: "打开" }).first().click()
  await requestA
  // 站内导航（不整页重载）才是真正的卸载。
  await page.getByRole("link", { name: "学习与记忆" }).first().click()
  await expect(page).toHaveURL(/\/projects\/learning-memory/)
  await expect.poll(() => failed).toContain("net::ERR_ABORTED")
  hold.release()
})

test("加载失败后下一轮轮询成功，错误清除并显示数据", async ({ page }) => {
  let tasksCalls = 0
  await mockWorkspace(page)
  await page.route("**/api/v1/inference/**", (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith("/videos")) return route.fulfill({ json: root })
    if (url.pathname.endsWith("/tasks") && route.request().method() === "GET") {
      tasksCalls += 1
      if (tasksCalls === 1)
        return route.fulfill({
          status: 503,
          json: { detail: "推理服务暂不可用" },
        })
      return route.fulfill({
        json: {
          items: [
            {
              id: "77777777-7777-4777-8777-777777777777",
              video_id: "one",
              status: "running",
              stage: "tracking",
              error: null,
              review: null,
              candidate: null,
            },
          ],
        },
      })
    }
    return route.fulfill({ status: 404, json: { detail: "not stubbed" } })
  })
  await page.goto("/inference")
  await expect(
    page.getByRole("alert").filter({ hasText: "推理服务暂不可用" }),
  ).toBeVisible()
  // 3s 的 refetchInterval 触发第二次请求。
  await expect(
    page.getByRole("alert").filter({ hasText: "推理服务暂不可用" }),
  ).toHaveCount(0, { timeout: 6000 })
  await expect(page.getByRole("button", { name: /运行中/ })).toBeVisible()
})

test("目录竞态：上一目录的慢响应不覆盖当前目录结果", async ({ page }) => {
  const holdA = deferred()
  await mockWorkspace(page)
  await mockVideos(page, async (path, _count, route) => {
    if (path === "a") {
      await holdA.promise
      // 请求已被中止时 fulfill 会抛错，忽略。
      return route.fulfill({ json: dirItems.a }).catch(() => {})
    }
    return route.fulfill({ json: dirItems[path] })
  })
  await page.goto("/inference")
  const requestA = page.waitForRequest((r) => videosPath(r, "a"))
  await page.getByRole("button", { name: "打开" }).first().click()
  await requestA
  await page.getByRole("button", { name: "返回上一级" }).click()
  await page.getByRole("button", { name: "打开" }).nth(1).click()
  await expect(page.getByText("b-video.mp4")).toBeVisible()
  holdA.release()
  // 给迟到的响应一个落地机会：以一次往返的 UI 查询为界，而非固定睡眠。
  await page.evaluate(() => new Promise((r) => setTimeout(r, 200)))
  await expect(page.getByText("b-video.mp4")).toBeVisible()
  await expect(page.getByText("a-video.mp4")).toHaveCount(0)
})

test("缓存回访：再次进入已加载目录立即显示缓存，不等待重新获取", async ({
  page,
}) => {
  const holdRefetch = deferred()
  await mockWorkspace(page)
  const counts = await mockVideos(page, async (path, count, route) => {
    if (path === "a" && count >= 2) {
      await holdRefetch.promise
      return route.fulfill({ json: dirItems.a }).catch(() => {})
    }
    return route.fulfill({ json: dirItems[path] })
  })
  await page.goto("/inference")
  await page.getByRole("button", { name: "打开" }).first().click()
  await expect(page.getByText("a-video.mp4")).toBeVisible()
  await page.getByRole("button", { name: "返回上一级" }).click()
  await expect(page.getByText("dir-a")).toBeVisible()
  await page.getByRole("button", { name: "打开" }).first().click()
  await expect.poll(() => counts.a).toBe(2)
  // 第二次获取仍被挂起，缓存内容必须已在页面上。
  await expect(page.getByText("a-video.mp4")).toBeVisible({ timeout: 1000 })
  holdRefetch.release()
})

const reviewTask = {
  id: "88888888-8888-4888-8888-888888888888",
  video_id: "one",
  status: "waiting_for_review",
  stage: "preannotation",
  error: null,
  review: null,
  candidate: {
    width: 100,
    height: 100,
    frame_count: 100,
    seed: { frame: 3, x: 20, y: 25 },
    pool: { cx: 50, cy: 50, radius: 35 },
    marks: [
      {
        label: "m0",
        polygon: [
          [1, 1],
          [2, 1],
          [1, 2],
        ],
      },
    ],
    evidence: { review_reasons: [] },
  },
}

test("轮廓 JSON 结构非法时在表单内报错、禁用提交，页面不崩溃", async ({
  page,
}) => {
  await mockWorkspace(page)
  await page.route("**/api/v1/inference/**", (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith("/videos"))
      return route.fulfill({ json: { items: [] } })
    if (url.pathname.endsWith("/tasks") && route.request().method() === "GET")
      return route.fulfill({ json: { items: [reviewTask] } })
    if (url.pathname.endsWith("candidate.jpg"))
      return route.fulfill({ status: 404 })
    return route.fulfill({ status: 404, json: { detail: "not stubbed" } })
  })
  await page.goto("/inference")
  await page.getByRole("button", { name: /等待预标注确认/ }).click()
  const textarea = page.getByRole("textbox", { name: /轮廓坐标/ })
  const confirm = page.getByRole("button", { name: "确认并开始追踪" })
  await expect(confirm).toBeEnabled()

  const invalid = [
    "[null]",
    '[{"label":"m0","polygon":[[1]]}]',
    '[{"label":"m0","polygon":[1,2,3]}]',
    '[{"label":"m0","polygon":[[1,"2"]]}]',
    '[{"polygon":[[1,1],[2,1],[1,2]]}]',
  ]
  for (const text of invalid) {
    await textarea.fill(text)
    await expect(
      page.getByRole("alert").filter({ hasText: "轮廓格式有误" }),
    ).toBeVisible()
    await expect(confirm).toBeDisabled()
    await expect(textarea).toHaveAttribute("aria-invalid", "true")
    await expect(
      page.getByRole("heading", { name: /等待预标注确认/ }),
    ).toBeVisible()
  }

  await textarea.fill('[{"label":"m0","polygon":[[1,1],[2,1],[1,2]]}]')
  await expect(
    page.getByRole("alert").filter({ hasText: "轮廓格式有误" }),
  ).toHaveCount(0)
  await expect(confirm).toBeEnabled()
})
