import { expect, type Page, test } from "@playwright/test"
import { stubProjectsApi } from "./utils/projectsApi"

test.use({ storageState: { cookies: [], origins: [] } })

async function workspace(
  page: Page,
  initialFolder: {
    source_id: string
    path: string
    label: string
  } | null = null,
) {
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "test-token")
    localStorage.setItem("lingsight.onboarding-seen.v1", "1")
  })
  await page.route("**/api/v1/users/me", (route) =>
    route.fulfill({
      json: {
        id: "folder-owner",
        email: "owner@example.com",
        is_active: true,
        is_superuser: false,
        full_name: "研究者",
      },
    }),
  )
  await page.route("**/api/v1/agent/tasks", (route) =>
    route.fulfill({ json: [] }),
  )
  const state = stubProjectsApi(page, [
    { id: "folder-project", name: "视频研究", members: [] },
  ])
  let folder = initialFolder
  await page.route(/\/api\/v1\/projects\/?$/, (route) =>
    route.fulfill({
      json: {
        data: state.projects.map((project) => ({
          ...project,
          video_folder: folder,
        })),
        count: state.projects.length,
      },
    }),
  )
  await page.route(
    "**/api/v1/projects/folder-project/video-folder",
    (route) => {
      const body = route.request().postDataJSON()
      folder = { ...body, label: "NAS 视频 / 十月" }
      return route.fulfill({
        json: { ...state.projects[0], video_folder: folder },
      })
    },
  )
  await page.route("**/api/v1/inference/sources", (route) =>
    route.fulfill({
      json: {
        items: [
          { id: "nas", label: "NAS 视频", kind: "filesystem", available: true },
        ],
      },
    }),
  )
  await page.route("**/api/v1/inference/videos?*", (route) => {
    const url = new URL(route.request().url())
    return route.fulfill({
      json: {
        source_id: url.searchParams.get("source_id"),
        path: url.searchParams.get("path"),
        items:
          url.searchParams.get("path") === "十月"
            ? [{ type: "video", id: "nas:十月/鼠1.mp4", name: "鼠1.mp4" }]
            : [{ type: "directory", path: "十月", name: "十月" }],
      },
    })
  })
  return state
}

test("项目先选择来源和视频文件夹，刷新后保留", async ({ page }) => {
  await workspace(page)
  await page.goto("/projects/folder-project?view=details")
  await expect(
    page.getByRole("heading", { name: "选择视频文件夹" }),
  ).toBeVisible()
  await page.getByLabel("视频来源", { exact: true }).selectOption("nas")
  await page.getByRole("button", { name: "打开文件夹 十月" }).click()
  await page.getByRole("button", { name: "使用此文件夹" }).click()
  await expect(page.getByText("NAS 视频 / 十月", { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText("NAS 视频 / 十月", { exact: true })).toBeVisible()
  await expect(
    page.getByRole("checkbox", { name: "选择视频 鼠1.mp4" }),
  ).toBeVisible()
})

test("批量归入所选视频，部分失败后保留失败项供重试，长视频标识完整保存", async ({
  page,
}) => {
  await workspace(page, {
    source_id: "nas",
    path: "十月",
    label: "NAS 视频 / 十月",
  })
  const longId = `source:nas:${"深层目录/".repeat(100)}鼠2.mp4`
  await page.route("**/api/v1/inference/videos?*", (route) =>
    route.fulfill({
      json: {
        items: [
          { type: "video", id: "nas:十月/鼠1.mp4", name: "鼠1.mp4" },
          { type: "video", id: longId, name: "鼠2.mp4" },
        ],
      },
    }),
  )
  let fail = true
  await page.route("**/api/v1/projects/folder-project/members", (route) => {
    if (route.request().postDataJSON().id === longId && fail) {
      fail = false
      return route.fulfill({
        status: 503,
        json: { detail: "保存引用暂时失败" },
      })
    }
    return route.fallback()
  })
  await page.goto("/projects/folder-project?view=details")
  await page.getByRole("checkbox", { name: "选择视频 鼠1.mp4" }).check()
  await page.getByRole("checkbox", { name: "选择视频 鼠2.mp4" }).check()
  await page.getByRole("button", { name: "将所选视频归入项目" }).click()
  await expect(page.getByRole("alert")).toContainText("1 个视频未归入")
  await expect(
    page.getByRole("checkbox", { name: "选择视频 鼠1.mp4" }),
  ).toBeDisabled()
  await expect(
    page.getByRole("checkbox", { name: "选择视频 鼠2.mp4" }),
  ).toBeChecked()
  await page.getByRole("button", { name: "将所选视频归入项目" }).click()
  await expect(
    page.getByRole("checkbox", { name: "选择视频 鼠2.mp4" }),
  ).toBeDisabled()
  await page.reload()
  await expect(
    page.getByRole("checkbox", { name: "选择视频 鼠2.mp4" }),
  ).toBeDisabled()
  await expect(
    page.getByRole("heading", { name: "归入项目的视频" }),
  ).toBeVisible()
})

test("来源离线和保存失败给出错误，取消更换保留原文件夹", async ({ page }) => {
  await workspace(page, {
    source_id: "nas",
    path: "十月",
    label: "NAS 视频 / 十月",
  })
  await page.route("**/api/v1/inference/sources", (route) =>
    route.fulfill({
      json: {
        items: [
          { id: "nas", label: "NAS 视频", kind: "filesystem", available: true },
          {
            id: "offline",
            label: "另一台 NAS",
            kind: "filesystem",
            available: false,
            error: { code: "source_unavailable", message: "NAS 暂时离线" },
          },
        ],
      },
    }),
  )
  await page.route("**/api/v1/projects/folder-project/video-folder", (route) =>
    route.fulfill({ status: 503, json: { detail: "无法保存视频文件夹" } }),
  )
  await page.goto("/projects/folder-project?view=details")
  await page.getByRole("button", { name: "更换文件夹" }).click()
  await page.getByLabel("视频来源", { exact: true }).selectOption("offline")
  await expect(page.getByRole("alert")).toContainText("NAS 暂时离线")
  await expect(
    page.getByRole("button", { name: "使用此文件夹" }),
  ).toBeDisabled()
  await page.getByLabel("视频来源", { exact: true }).selectOption("nas")
  await page.getByRole("button", { name: "使用此文件夹" }).click()
  await expect(page.getByRole("alert")).toContainText("无法保存视频文件夹")
  await expect(page.getByText("NAS 视频 / 十月", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "取消更换" }).click()
  await expect(
    page.getByRole("checkbox", { name: "选择视频 鼠1.mp4" }),
  ).toBeVisible()
  await expect(page.getByRole("alert")).toHaveCount(0)
})

test("切换来源后慢响应不会覆盖新目录", async ({ page }) => {
  await workspace(page)
  await page.route("**/api/v1/inference/sources", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "slow",
            label: "慢速 NAS",
            kind: "filesystem",
            available: true,
          },
          {
            id: "fast",
            label: "其他 NAS",
            kind: "filesystem",
            available: true,
          },
        ],
      },
    }),
  )
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let finished: () => void = () => {}
  const oldFinished = new Promise<void>((resolve) => {
    finished = resolve
  })
  await page.route("**/api/v1/inference/videos?*", async (route) => {
    if (
      new URL(route.request().url()).searchParams.get("source_id") === "slow"
    ) {
      await held
      try {
        await route.fulfill({
          json: { items: [{ type: "directory", name: "旧来源", path: "old" }] },
        })
      } finally {
        finished()
      }
      return
    }
    return route.fulfill({
      json: { items: [{ type: "directory", name: "新来源", path: "new" }] },
    })
  })
  const slow = page.waitForRequest((request) =>
    request.url().includes("/inference/videos?source_id=slow"),
  )
  await page.goto("/projects/folder-project?view=details")
  await slow
  await page.getByLabel("视频来源", { exact: true }).selectOption("fast")
  await expect(
    page.getByRole("button", { name: "打开文件夹 新来源" }),
  ).toBeVisible()
  release()
  await oldFinished
  await expect(
    page.getByRole("button", { name: "打开文件夹 旧来源" }),
  ).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "打开文件夹 新来源" }),
  ).toBeVisible()
})

test("读取目录失败不冒充空目录，重试恢复", async ({ page }) => {
  await workspace(page)
  let unavailable = true
  await page.route("**/api/v1/inference/videos?*", (route) =>
    unavailable
      ? route.fulfill({
          status: 503,
          json: {
            detail: { code: "source_unavailable", message: "NAS 连接已中断" },
          },
        })
      : route.fulfill({ json: { items: [] } }),
  )
  await page.goto("/projects/folder-project?view=details")
  await expect(page.getByRole("alert")).toContainText("NAS 连接已中断")
  await expect(page.getByText("此文件夹为空。", { exact: true })).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "使用此文件夹" }),
  ).toBeDisabled()
  unavailable = false
  await page.getByRole("button", { name: "重试读取文件夹" }).click()
  await expect(page.getByText("此文件夹为空。", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "使用此文件夹" })).toBeEnabled()
})

test("退出并切换账号后不显示上个账号的文件夹或来源缓存", async ({ page }) => {
  await workspace(page, {
    source_id: "nas",
    path: "十月",
    label: "NAS 视频 / 十月",
  })
  let secondAccount = false
  await page.route("**/api/v1/users/me", (route) =>
    route.fulfill({
      json: {
        id: secondAccount ? "another-owner" : "folder-owner",
        email: secondAccount ? "another@example.com" : "owner@example.com",
        full_name: "研究者",
        is_active: true,
        is_superuser: false,
      },
    }),
  )
  await page.route("**/api/v1/login/access-token", (route) => {
    secondAccount = true
    return route.fulfill({
      json: { access_token: "another-test-token", token_type: "bearer" },
    })
  })
  await page.route(/\/api\/v1\/projects\/?$/, (route) =>
    secondAccount
      ? route.fulfill({
          json: {
            data: [
              {
                id: "another-project",
                name: "另一个项目",
                members: [],
                video_folder: null,
              },
            ],
            count: 1,
          },
        })
      : route.fallback(),
  )
  await page.route("**/api/v1/inference/sources", (route) =>
    secondAccount
      ? route.fulfill({
          json: {
            items: [
              {
                id: "another-nas",
                label: "另一个账号的 NAS",
                kind: "filesystem",
                available: true,
              },
            ],
          },
        })
      : route.fallback(),
  )
  await page.goto("/projects/folder-project?view=details")
  await page.getByRole("checkbox", { name: "选择视频 鼠1.mp4" }).check()
  await page.getByTestId("user-menu").click()
  await page.getByRole("menuitem", { name: "退出登录" }).click()
  await page.getByLabel("Email", { exact: true }).fill("another@example.com")
  await page.getByLabel("Password", { exact: true }).fill("test-password")
  await page.getByRole("button", { name: "Log In" }).click()
  await page.getByRole("link", { name: "另一个项目", exact: true }).click()
  await page.getByRole("link", { name: "项目资料" }).click()
  await expect(page.getByLabel("视频来源", { exact: true })).toHaveValue(
    "another-nas",
  )
  await expect(page.getByText("NAS 视频 / 十月", { exact: true })).toHaveCount(
    0,
  )
  await expect(
    page.getByRole("checkbox", { name: "选择视频 鼠1.mp4" }),
  ).toHaveCount(0)
  await expect(
    page.getByRole("option", { name: "NAS 视频", exact: true }),
  ).toHaveCount(0)
})

test("项目文件夹带到推理页，同源目录的视频仅在点击开始后提交", async ({
  page,
}) => {
  await workspace(page)
  const starts: string[] = []
  const opaqueId = "v1:nas:5Y2B5pyIL-m8oDEubXA0"
  await page.route("**/api/v1/inference/videos?*", (route) => {
    const query = new URL(route.request().url()).searchParams
    return route.fulfill({
      json: {
        items:
          query.get("source_id") === "nas" && query.get("path") === "十月"
            ? [{ type: "video", id: opaqueId, name: "鼠1.mp4" }]
            : [{ type: "directory", name: "十月", path: "十月" }],
      },
    })
  })
  await page.route("**/api/v1/inference/tasks", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { items: [] } })
    starts.push(route.request().postDataJSON().video_id)
    return route.fulfill({
      json: {
        id: "synthetic-inference-task",
        video_id: opaqueId,
        status: "queued",
        stage: "preannotation",
        candidate: null,
        error: null,
        confirmed: null,
        review: null,
      },
    })
  })
  await page.goto("/projects/folder-project?view=details")
  await page.getByRole("button", { name: "打开文件夹 十月" }).click()
  await page.getByRole("button", { name: "使用此文件夹" }).click()
  await page.getByRole("link", { name: "前往视频推理" }).click()
  await expect(page.getByText("鼠1.mp4", { exact: false })).toBeVisible()
  expect(starts).toEqual([])
  await page.getByRole("button", { name: "开始", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "排队中 · 预标注" }),
  ).toBeVisible()
  expect(starts).toEqual([opaqueId])
})

test("后台刷新项目文件夹后，视频列表跟随已保存的新目录", async ({ page }) => {
  await workspace(page, {
    source_id: "nas",
    path: "十月",
    label: "NAS 视频 / 十月",
  })
  let folder = "十月"
  await page.route(/\/api\/v1\/projects\/?$/, (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: "folder-project",
            name: "视频研究",
            members: [],
            video_folder: {
              source_id: "nas",
              path: folder,
              label: `NAS 视频 / ${folder}`,
            },
          },
        ],
        count: 1,
      },
    }),
  )
  await page.route("**/api/v1/inference/videos?*", (route) =>
    route.fulfill({
      json: {
        items:
          new URL(route.request().url()).searchParams.get("path") === "十一月"
            ? [
                {
                  type: "video",
                  id: "nas:十一月/新视频.mp4",
                  name: "新视频.mp4",
                },
              ]
            : [
                {
                  type: "video",
                  id: "nas:十月/旧视频.mp4",
                  name: "旧视频.mp4",
                },
              ],
      },
    }),
  )
  await page.goto("/projects/folder-project?view=details")
  await expect(
    page.getByRole("checkbox", { name: "选择视频 旧视频.mp4" }),
  ).toBeVisible()
  folder = "十一月"
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")))
  await expect(
    page.getByText("NAS 视频 / 十一月", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("checkbox", { name: "选择视频 新视频.mp4" }),
  ).toBeVisible()
  await expect(
    page.getByRole("checkbox", { name: "选择视频 旧视频.mp4" }),
  ).toHaveCount(0)
})
