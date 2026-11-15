import { expect, type Page, test } from "@playwright/test"
import { stubProjectsApi, workspaceInfo } from "./utils/projectsApi"

test.use({ storageState: { cookies: [], origins: [] } })

async function session(
  page: Page,
  projects: Parameters<typeof stubProjectsApi>[1],
) {
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "test-token")
    localStorage.setItem("lingsight.onboarding-seen.v1", "1")
  })
  await page.route("**/api/v1/users/me", (route) =>
    route.fulfill({
      json: {
        id: "user",
        email: "new@example.com",
        full_name: "新用户",
        is_active: true,
        is_superuser: false,
      },
    }),
  )
  await page.route("**/api/v1/agent/tasks", (route) =>
    route.fulfill({ json: [] }),
  )
  const state = stubProjectsApi(page, projects)
  // 新账号：工作区可用，但没有任何整库或实验授权。
  await page.route("**/api/v1/users/me/workspace", (route) =>
    route.fulfill({ json: workspaceInfo() }),
  )
  return state
}

const mp4 = (name = "trial.mp4") => ({
  name,
  mimeType: "video/mp4",
  buffer: Buffer.from("fake-video-bytes"),
})

test("没有项目时引导先新建项目，不提供无项目上传入口", async ({ page }) => {
  await session(page, [])
  await page.goto("/inference")
  await expect(
    page.getByText(/还没有项目。视频必须先归入你的项目/),
  ).toBeVisible()
  await expect(page.getByLabel("选择视频文件")).toHaveCount(0)
  await expect(page.getByText("已授权的实验视频目录")).toHaveCount(0)
})

test("先有项目再上传 mp4：multipart 单个 file 字段 + 幂等键，列表出现该视频", async ({
  page,
}) => {
  const state = await session(page, [
    { id: "p1", name: "我的第一个项目", members: [] },
  ])
  const uploads: { key: string; body: string }[] = []
  await page.route("**/api/v1/projects/p1/videos", async (route) => {
    if (route.request().method() === "POST")
      uploads.push({
        key: route.request().headers()["idempotency-key"] ?? "",
        body: route.request().postData() ?? "",
      })
    return route.fallback()
  })
  await page.goto("/projects/p1?view=details")
  // 新账号没有整库/实验授权：不出现目录来源入口，只有上传。
  await expect(page.getByText(/^(添加视频|管理视频来源)$/)).toHaveCount(0)
  await expect(page.getByText("暂无原始视频。")).toBeVisible()
  await expect(page.getByRole("button", { name: "上传到项目" })).toBeDisabled()

  await page.getByLabel("选择视频文件").setInputFiles(mp4())
  await page.getByRole("button", { name: "上传到项目" }).click()
  await expect(page.getByText("已上传“trial.mp4”")).toBeVisible()
  const list = page.getByRole("list", { name: "项目上传视频" })
  await expect(list.getByText("trial.mp4")).toBeVisible()
  await expect(list.getByText(/MP4/)).toBeVisible()

  await page
    .locator("section[aria-labelledby=project-videos-title]")
    .screenshot({ path: "test-results/upload-project-materials.png" })
  expect(uploads).toHaveLength(1)
  expect(uploads[0].key).toMatch(/^[0-9a-f-]{36}$/)
  expect(uploads[0].body.match(/name="file"/g)).toHaveLength(1)
  expect(state.projects[0].videos).toHaveLength(1)

  // 刷新后仍能从服务器列表读到（不是前端状态）。
  await page.reload()
  await expect(
    page.getByRole("list", { name: "项目上传视频" }).getByText("trial.mp4"),
  ).toBeVisible()
})

test("客户端预检：非 mp4/avi 直接拦截，不发请求", async ({ page }) => {
  await session(page, [{ id: "p1", name: "项目", members: [] }])
  let posted = 0
  await page.route("**/api/v1/projects/p1/videos", (route) => {
    if (route.request().method() === "POST") posted++
    return route.fallback()
  })
  await page.goto("/projects/p1?view=details")
  await page.getByLabel("选择视频文件").setInputFiles({
    name: "clip.mov",
    mimeType: "video/quicktime",
    buffer: Buffer.from("x"),
  })
  await expect(page.getByRole("alert")).toContainText("仅支持 mp4 或 avi")
  await expect(page.getByRole("button", { name: "上传到项目" })).toBeDisabled()
  expect(posted).toBe(0)
})

const serverErrors = [
  { status: 413, code: "file_too_large", text: "超过 2 GB 上限" },
  { status: 415, code: "unsupported_media_type", text: "仅支持 mp4 或 avi" },
  { status: 422, code: "invalid_video", text: "无法解码或为空" },
  { status: 503, code: "service_unavailable", text: "服务暂不可用" },
]
for (const failure of serverErrors) {
  test(`服务器 ${failure.status} ${failure.code} 按 code 给出对应提示`, async ({
    page,
  }) => {
    await session(page, [{ id: "p1", name: "项目", members: [] }])
    await page.route("**/api/v1/projects/p1/videos", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: failure.status,
            // 文案故意与 code 无关，证明前端不靠文案分支。
            json: {
              detail: { code: failure.code, message: "irrelevant text" },
            },
          })
        : route.fallback(),
    )
    await page.goto("/projects/p1?view=details")
    await page.getByLabel("选择视频文件").setInputFiles(mp4())
    await page.getByRole("button", { name: "上传到项目" }).click()
    await expect(page.getByRole("alert")).toContainText(failure.text)
    await expect(page.getByRole("alert")).not.toContainText("irrelevant")
  })
}

test("幂等键：同文件失败重试沿用同一键，idempotency_conflict 后换新键", async ({
  page,
}) => {
  await session(page, [{ id: "p1", name: "项目", members: [] }])
  const keys: string[] = []
  const answers = [
    { status: 503, code: "service_unavailable" },
    { status: 409, code: "idempotency_conflict" },
  ]
  await page.route("**/api/v1/projects/p1/videos", (route) => {
    if (route.request().method() !== "POST") return route.fallback()
    keys.push(route.request().headers()["idempotency-key"] ?? "")
    const answer = answers.shift()
    if (!answer) return route.fallback()
    return route.fulfill({
      status: answer.status,
      json: { detail: { code: answer.code, message: "x" } },
    })
  })
  await page.goto("/projects/p1?view=details")
  await page.getByLabel("选择视频文件").setInputFiles(mp4())
  const upload = page.getByRole("button", { name: "上传到项目" })
  await upload.click()
  await expect(page.getByRole("alert")).toContainText("服务暂不可用")
  await upload.click()
  await expect(page.getByRole("alert")).toContainText("幂等键")
  await upload.click()
  await expect(page.getByText("已上传“trial.mp4”")).toBeVisible()
  expect(keys).toHaveLength(3)
  expect(keys[1]).toBe(keys[0])
  expect(keys[2]).not.toBe(keys[1])
})

test("预览：mp4 播原视频，avi 走 preview_url（带鉴权 token）", async ({
  page,
}) => {
  await session(page, [
    {
      id: "p1",
      name: "项目",
      members: [],
      videos: [
        {
          video_id: "upl_1",
          filename: "a.mp4",
          format: "mp4",
          bytes: 10,
          width: 640,
          height: 480,
          frame_count: 30,
          fps: 30,
        },
        {
          video_id: "upl_2",
          filename: "b.avi",
          format: "avi",
          bytes: 10,
          width: 640,
          height: 480,
          frame_count: 30,
          fps: 30,
        },
      ],
    },
  ])
  await page.goto("/projects/p1?view=details")
  const media = page.waitForRequest((request) =>
    request.url().includes("/projects/p1/videos/upl_1/media"),
  )
  await page.getByRole("button", { name: "预览视频 a.mp4" }).click()
  expect(new URL((await media).url()).searchParams.get("token")).toBe(
    "test-token",
  )
  await page.keyboard.press("Escape")
  const preview = page.waitForRequest((request) =>
    request.url().includes("/projects/p1/videos/upl_2/preview"),
  )
  await page.getByRole("button", { name: "预览视频 b.avi" }).click()
  // AVI 浏览器多半不能直接解码：走平台生成的兼容 MP4 预览地址。
  expect(new URL((await preview).url()).searchParams.get("token")).toBe(
    "test-token",
  )
})

test("项目页的视频推理入口带上项目，推理页只列该项目上传的视频并以项目+视频创建任务", async ({
  page,
}) => {
  await session(page, [
    {
      id: "p1",
      name: "项目",
      members: [],
      videos: [
        {
          video_id: "upl_1",
          filename: "a.mp4",
          format: "mp4",
          bytes: 10,
          width: 640,
          height: 480,
          frame_count: 30,
          fps: 30,
        },
      ],
    },
  ])
  const starts: { body: unknown; key: string }[] = []
  await page.route("**/api/v1/inference/**", (route) => {
    const url = new URL(route.request().url())
    if (
      url.pathname.endsWith("/tasks") &&
      route.request().method() === "POST"
    ) {
      starts.push({
        body: route.request().postDataJSON(),
        key: route.request().headers()["idempotency-key"] ?? "",
      })
      return route.fulfill({
        status: 202,
        json: {
          id: "33333333-3333-4333-8333-333333333333",
          project_id: "p1",
          video_id: "upl_1",
          source_kind: "user_upload",
          confirmation_id: null,
          status: "queued",
          stage: "preannotation",
          error: null,
          review: null,
        },
      })
    }
    if (url.pathname.endsWith("/tasks")) return route.fulfill({ json: [] })
    return route.fulfill({ status: 404, json: { detail: "not stubbed" } })
  })
  await page.goto("/projects/p1?view=details")
  await page.getByRole("link", { name: "用 a.mp4 做视频推理" }).click()
  await expect(page).toHaveURL(/\/inference\?project_id=p1/)
  // 新账号没有授权：不显示目录来源区。
  await expect(page.getByText("已授权的实验视频目录")).toHaveCount(0)
  await page.getByRole("button", { name: "开始推理 a.mp4" }).click()
  await expect(page.getByTestId("task-video")).toContainText("上传视频：a.mp4")
  await expect(page.getByTestId("task-video")).toContainText("不对应科研库试次")
  expect(starts).toHaveLength(1)
  expect(starts[0].body).toEqual({ project_id: "p1", video_id: "upl_1" })
  expect(starts[0].key).toMatch(/^[0-9a-f-]{36}$/)
})

test("移出上传视频后列表随之更新；移除最后归组按 code 提示", async ({
  page,
}) => {
  await session(page, [
    {
      id: "p1",
      name: "项目",
      members: [],
      videos: [
        {
          video_id: "upl_1",
          filename: "a.mp4",
          format: "mp4",
          bytes: 10,
          width: 640,
          height: 480,
          frame_count: 30,
          fps: 30,
        },
      ],
    },
  ])
  let refuse = true
  await page.route("**/api/v1/projects/p1/members/video/upl_1", (route) => {
    if (!refuse) return route.fallback()
    refuse = false
    return route.fulfill({
      status: 409,
      json: { detail: { code: "last_project_reference", message: "x" } },
    })
  })
  await page.goto("/projects/p1?view=details")
  const list = page.getByRole("list", { name: "项目上传视频" })
  await expect(list.getByText("a.mp4")).toBeVisible()
  await page.getByRole("button", { name: "移出视频 a.mp4" }).click()
  await expect(page.getByRole("alert")).toContainText("最后一个归组")
  await expect(list.getByText("a.mp4")).toBeVisible()
  await page.getByRole("button", { name: "移出视频 a.mp4" }).click()
  await expect(page.getByText("暂无原始视频。")).toBeVisible()
})
