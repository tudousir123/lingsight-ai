import { expect, type Page, type Route, test } from "@playwright/test"
import { stubProjectsApi } from "./utils/projectsApi"

test.use({ storageState: { cookies: [], origins: [] } })

const PROJECT = "learning-memory"
const VIDEO = "upl_1"
const TASK = "11111111-1111-4111-8111-111111111111"
const VERSION = "v".repeat(64)
const W = 1000
const H = 800
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)
const square = (x: number, y: number): [number, number][] => [
  [x, y],
  [x + 80, y],
  [x + 80, y + 80],
  [x, y + 80],
]

type Confirmation = {
  id: string
  project_id: string
  video_id: string
  task_id: string
  candidate_version: string
  video_sha256: string
  width: number
  height: number
  frame_count: number
  seed: unknown
  pool: unknown
  marks: unknown
  confirmed_by: string
  confirmed_at: string
  tracking_dispatch: { status: string; error_code: string | null }
}

// 可控的平台替身：候选、确认持久化、任务状态都在这里，且记录对旧 /confirm 的任何调用。
async function mockPlatform(
  page: Page,
  options: {
    dispatch?: "pending" | "accepted" | "failed"
    confirmError?: { status: number; code: string }
  } = {},
) {
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
  stubProjectsApi(page, [
    {
      id: PROJECT,
      name: "学习与记忆",
      members: [],
      videos: [
        {
          video_id: VIDEO,
          filename: "trial.mp4",
          format: "mp4",
          bytes: 1024,
          width: W,
          height: H,
          frame_count: 300,
          fps: 30,
        },
      ],
    },
  ])
  const state = {
    status: "waiting_for_review",
    confirmation: null as Confirmation | null,
    posts: [] as { body: Record<string, unknown>; key: string }[],
    legacyConfirmCalls: 0,
  }
  const task = () => ({
    id: TASK,
    project_id: PROJECT,
    video_id: VIDEO,
    source_kind: "user_upload",
    confirmation_id: state.confirmation?.id ?? null,
    status: state.status,
    stage: state.status === "waiting_for_review" ? "preannotation" : "tracking",
    error: null,
    review: null,
  })
  await page.route("**/api/v1/inference/**", (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith("/confirm")) {
      state.legacyConfirmCalls += 1
      return route.fulfill({
        status: 409,
        json: {
          detail: { code: "project_confirmation_required", message: "x" },
        },
      })
    }
    if (url.pathname.includes("/artifacts/candidate.jpg"))
      return route.fulfill({ contentType: "image/png", body: PNG })
    if (url.pathname.endsWith("/tasks") && route.request().method() === "GET")
      return route.fulfill({ json: [task()] })
    return route.fulfill({ status: 404, json: { detail: "not stubbed" } })
  })
  const base = `**/api/v1/projects/${PROJECT}/videos/${VIDEO}`
  await page.route(`${base}/preannotation?*`, (route) =>
    route.fulfill({
      json: {
        project_id: PROJECT,
        video_id: VIDEO,
        task_id: TASK,
        candidate_version: VERSION,
        video_sha256: "b".repeat(64),
        frame_index: 7,
        width: W,
        height: H,
        frame_count: 300,
        image_url: `/api/v1/inference/tasks/${TASK}/artifacts/candidate.jpg`,
        seed: { frame: 7, x: 300, y: 300 },
        pool: { cx: 500, cy: 400, radius: 300 },
        marks: [
          { label: "mark-0", polygon: square(300, 150), confidence: 0.9 },
          { label: "mark-1", polygon: square(600, 150), confidence: 0.4 },
          { label: "mark-2", polygon: square(300, 550), confidence: 0.8 },
          { label: "mark-3", polygon: null },
        ],
        evidence: { review_reasons: ["mark-3 缺失"] },
      },
    }),
  )
  await page.route(`${base}/preannotation-confirmation`, (route) =>
    state.confirmation
      ? route.fulfill({ json: state.confirmation })
      : route.fulfill({
          status: 404,
          json: { detail: { code: "resource_not_found", message: "x" } },
        }),
  )
  await page.route(`${base}/preannotation-confirmations`, (route: Route) => {
    const body = route.request().postDataJSON()
    state.posts.push({
      body,
      key: route.request().headers()["idempotency-key"] ?? "",
    })
    if (options.confirmError)
      return route.fulfill({
        status: options.confirmError.status,
        json: {
          detail: { code: options.confirmError.code, message: "server" },
        },
      })
    const replay =
      state.confirmation &&
      state.posts.filter(
        (post) => post.key === state.posts[state.posts.length - 1].key,
      ).length > 1
    state.confirmation = {
      id: "22222222-2222-4222-8222-222222222222",
      project_id: PROJECT,
      video_id: VIDEO,
      task_id: TASK,
      candidate_version: body.candidate_version,
      video_sha256: "b".repeat(64),
      width: W,
      height: H,
      frame_count: 300,
      seed: body.seed,
      pool: body.pool,
      marks: body.marks,
      confirmed_by: "user",
      confirmed_at: "2026-11-15T01:02:03Z",
      tracking_dispatch: {
        status: replay ? "accepted" : (options.dispatch ?? "pending"),
        error_code:
          !replay && options.dispatch === "failed" ? "upstream_error" : null,
      },
    }
    state.status =
      state.confirmation.tracking_dispatch.status === "failed"
        ? "waiting_for_review"
        : "queued"
    return route.fulfill({
      status: replay ? 200 : 201,
      json: state.confirmation,
    })
  })
  return state
}

async function openTask(page: Page) {
  await page.goto(`/inference?project_id=${PROJECT}`)
  await page.getByRole("button", { name: /等待预标注确认/ }).click()
  await expect(page.getByRole("img", { name: "预标注参考帧" })).toBeVisible()
}

// 把原视频像素换算成页面坐标（经过画布缩放后的真实位置）。
async function toPage(page: Page, x: number, y: number) {
  const overlay = page.getByRole("img", { name: "水池、小鼠起点和标志物候选" })
  await overlay.scrollIntoViewIfNeeded()
  const box = await overlay.boundingBox()
  if (!box) throw new Error("overlay not laid out")
  return { x: box.x + (x / W) * box.width, y: box.y + (y / H) * box.height }
}

test("画布按候选帧原像素叠加，拖动起点后提交的是原视频像素，确认后读回服务器版本", async ({
  page,
}) => {
  const state = await mockPlatform(page)
  await openTask(page)
  await expect(page.getByText(/第 7 帧，1000×800/)).toBeVisible()
  await expect(page.getByText("需核对：mark-3 缺失")).toBeVisible()
  // 缺轮廓的候选不进入草稿；其余三个都在。
  await expect(page.getByText("标志物（3）")).toBeVisible()
  await page
    .locator(".preannotation")
    .screenshot({ path: "test-results/canvas-before-confirm.png" })

  // 拖动小鼠起点 (300,300) -> (520,430)，水池 (500,400,r300) 之内。
  const from = await toPage(page, 300, 300)
  const to = await toPage(page, 520, 430)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2)
  await page.mouse.move(to.x, to.y)
  await page.mouse.up()
  const seedX = Number(await page.getByLabel("小鼠 X").inputValue())
  const seedY = Number(await page.getByLabel("小鼠 Y").inputValue())
  expect(Math.abs(seedX - 520)).toBeLessThan(3)
  expect(Math.abs(seedY - 430)).toBeLessThan(3)

  // 删除一个候选标志物。
  await page.getByRole("button", { name: "删除 mark-1" }).click()
  await expect(page.getByText("标志物（2）")).toBeVisible()

  await page.getByRole("button", { name: "确认并开始追踪" }).click()
  await expect.poll(() => state.posts.length).toBe(1)
  const { body, key } = state.posts[0]
  expect(key).toMatch(/^[0-9a-f-]{36}$/)
  expect(body).toMatchObject({
    task_id: TASK,
    candidate_version: VERSION,
    expected_confirmation_id: null,
    pool: { cx: 500, cy: 400, radius: 300 },
  })
  const seed = body.seed as { frame: number; x: number; y: number }
  expect(seed.frame).toBe(7)
  expect(Math.abs(seed.x - 520)).toBeLessThan(3)
  // 原像素而非 CSS 像素：坐标在 0..1000 内，且与显示缩放无关。
  expect((body.marks as { label: string }[]).map((m) => m.label)).toEqual([
    "mark-0",
    "mark-2",
  ])

  // 服务器上的确认版本被读回并显示，状态为待下发而非追踪完成。
  await expect(
    page.getByText("22222222-2222-4222-8222-222222222222"),
  ).toBeVisible()
  await expect(page.getByText("追踪尚未下发")).toBeVisible()
  await expect(page.getByText(/预标注确认不等于发布/)).toBeVisible()
  await page
    .locator(".preannotation")
    .screenshot({ path: "test-results/canvas-after-confirm.png" })
  expect(state.legacyConfirmCalls).toBe(0)

  // 刷新后仍能从服务器读到同一确认版本（草稿不在浏览器里）。
  await page.reload()
  await page.getByRole("button", { name: /排队中/ }).click()
  await expect(
    page.getByText("22222222-2222-4222-8222-222222222222"),
  ).toBeVisible()
  expect(state.legacyConfirmCalls).toBe(0)
})

test("删除后重画标志物：点击顶点并完成轮廓，空标志物列表也可提交", async ({
  page,
}) => {
  const state = await mockPlatform(page)
  await openTask(page)
  await page.getByRole("button", { name: "重画 mark-0" }).click()
  // 少于 3 个点时不能提交。
  await expect(page.getByRole("alert")).toContainText("至少需要 3 个点")
  await expect(
    page.getByRole("button", { name: "确认并开始追踪" }),
  ).toBeDisabled()
  for (const [x, y] of [
    [150, 150],
    [260, 160],
    [220, 260],
  ]) {
    const point = await toPage(page, x, y)
    await page.mouse.click(point.x, point.y)
  }
  await page.getByRole("button", { name: "完成轮廓" }).click()
  await expect(page.getByRole("alert")).toHaveCount(0)
  await page.getByRole("button", { name: "删除 mark-1" }).click()
  await page.getByRole("button", { name: "删除 mark-2" }).click()
  await page.getByRole("button", { name: "确认并开始追踪" }).click()
  await expect.poll(() => state.posts.length).toBe(1)
  const marks = state.posts[0].body.marks as {
    label: string
    polygon: number[][]
  }[]
  expect(marks).toHaveLength(1)
  expect(marks[0].polygon).toHaveLength(3)
  expect(Math.abs(marks[0].polygon[0][0] - 150)).toBeLessThan(3)
})

test("标志物全部删除后空列表也可提交（完整替换语义）", async ({ page }) => {
  const state = await mockPlatform(page)
  await openTask(page)
  for (const name of ["mark-0", "mark-1", "mark-2"])
    await page.getByRole("button", { name: `删除 ${name}` }).click()
  await expect(page.getByText(/空列表可以提交/)).toBeVisible()
  await page.getByRole("button", { name: "确认并开始追踪" }).click()
  await expect.poll(() => state.posts.length).toBe(1)
  expect(state.posts[0].body.marks).toEqual([])
})

test("几何无效在前端先拦下；服务端 invalid_geometry / stale_version 按 code 提示", async ({
  page,
}) => {
  await mockPlatform(page, {
    confirmError: { status: 422, code: "invalid_geometry" },
  })
  await openTask(page)
  await page.getByLabel("小鼠 X").fill("1500")
  await expect(page.getByRole("alert")).toContainText("小鼠起点落在画面外")
  await expect(
    page.getByRole("button", { name: "确认并开始追踪" }),
  ).toBeDisabled()
  await page.getByLabel("小鼠 X").fill("")
  await expect(page.getByRole("alert")).toContainText("存在无效数值")
  await page.getByLabel("小鼠 X").fill("320")
  await page.getByRole("button", { name: "确认并开始追踪" }).click()
  // 提示由 code 决定，而不是服务端的中文/英文文案。
  await expect(page.getByRole("alert")).toContainText("标注几何无效")
  await expect(page.getByRole("alert")).not.toContainText("server")
})

test("下发失败可用同一幂等键重试；accepted 不代表追踪完成", async ({
  page,
}) => {
  const state = await mockPlatform(page, { dispatch: "failed" })
  await openTask(page)
  await page.getByRole("button", { name: "确认并开始追踪" }).click()
  await expect(page.getByText(/下发追踪失败/)).toBeVisible()
  await page.getByRole("button", { name: "重试下发" }).click()
  await expect.poll(() => state.posts.length).toBe(2)
  expect(state.posts[1].key).toBe(state.posts[0].key)
  expect(state.posts[1].body).toEqual(state.posts[0].body)
  await expect(page.getByText(/并不代表追踪完成/)).toBeVisible()
  expect(state.legacyConfirmCalls).toBe(0)
})
