import { expect, type Page, test } from "@playwright/test"
import {
  executionCapabilityFixture,
  personalAgentFixture,
  personalTaskBinding,
} from "./utils/personalAgentApi"
import { stubProjectsApi } from "./utils/projectsApi"

const id = "11111111-1111-4111-8111-111111111111",
  runId = "22222222-2222-4222-8222-222222222222",
  artifactId = "33333333-3333-4333-8333-333333333333"
const task = {
  ...personalTaskBinding,
  id,
  title: "水迷宫视频探索",
  goal: "核对视频数据",
  created_at: "2026-11-09T10:00:00Z",
  runs: [
    {
      id: runId,
      instruction: "核对视频数据",
      status: "succeeded",
      error: null,
    },
  ],
  artifacts: [
    {
      id: artifactId,
      run_id: runId,
      name: "report.md",
      kind: "report",
      bytes: 128,
      sha256: "abc",
    },
  ],
}
test.use({ storageState: { cookies: [], origins: [] } })
async function mock(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "test-token")
    localStorage.setItem("lingsight.onboarding-seen.v1", "1")
    localStorage.setItem("vite-ui-theme", "dark")
  })
  stubProjectsApi(page)
  await page.route("**/api/v1/users/me", (r) =>
    r.fulfill({
      json: {
        id: "user",
        email: "owner@example.com",
        full_name: "研究者",
        is_active: true,
        is_superuser: false,
      },
    }),
  )
  await page.route("**/api/v1/agent/**", async (r) => {
    const url = new URL(r.request().url())
    const path = url.pathname
    if (path.endsWith("/capabilities"))
      return r.fulfill({ json: executionCapabilityFixture })
    if (path.endsWith("/personal-agent"))
      return r.fulfill({ json: personalAgentFixture })
    if (path.endsWith("/events"))
      return r.fulfill({
        json:
          url.searchParams.get("after") === "0"
            ? [
                {
                  id: 1,
                  run_id: runId,
                  type: "agent.text",
                  data: { text: "已核对视频数据。" },
                },
              ]
            : [],
      })
    if (path.endsWith("/tasks"))
      return r.fulfill({
        json:
          r.request().method() === "POST"
            ? { task, run: task.runs[0] }
            : [task],
        status: r.request().method() === "POST" ? 202 : 200,
      })
    if (path.endsWith(`/tasks/${id}`)) return r.fulfill({ json: task })
    if (path.endsWith(`/artifacts/${artifactId}`))
      return r.fulfill({
        body: "# 研究报告\n\n<script>window.bad=true</script>",
        contentType: "text/markdown",
      })
    return r.fulfill({ json: { status: "queued" } })
  })
}
test.beforeEach(async ({ page }) => mock(page))

test("首页在中央展示研究入口，输入框固定在底部", async ({ page }) => {
  await page.goto("/")
  const main = page.getByRole("main")
  const intro = main.locator(".copilot-intro")
  await expect(
    intro.getByRole("heading", { name: "动物行为研究" }),
  ).toBeVisible()
  await expect(intro.getByRole("button")).toHaveCount(3)
  await expect(main.getByRole("textbox", { name: "研究问题" })).toBeVisible()
  await expect(main.getByText("最近任务", { exact: true })).toHaveCount(0)
  await expect(main.getByText("项目", { exact: true })).toHaveCount(0)
  await expect(main.getByText("视频与成果", { exact: true })).toHaveCount(0)
  await expect(main.locator(".agent-composer-wrap")).toBeVisible()
  expect(
    await main.evaluate((element) => {
      const composer = element.querySelector(".agent-composer-wrap")
      const thread = element.querySelector(".agent-scroll-area")
      if (!composer || !thread) return false
      const bottom = composer.getBoundingClientRect().bottom
      return (
        !thread.contains(composer) &&
        Math.abs(element.getBoundingClientRect().bottom - bottom) < 3
      )
    }),
  ).toBe(true)
  const navigation = page.getByRole("navigation", {
    name: "科研工作区导航",
  })
  await expect(
    navigation.getByRole("link", { name: "实验与数据" }),
  ).toHaveAttribute("href", "/experiments")
  await expect(
    navigation.getByRole("link", { name: "视频与标注" }),
  ).toHaveAttribute("href", "/annotations")
  await page.getByRole("link", { name: "分析与报告", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "分析与报告", exact: true }),
  ).toBeVisible()
})
for (const entry of [
  { name: "水迷宫分析", path: "/inference", heading: "视频推理" },
  { name: "本地视频", path: "/annotations", heading: "视频与标注" },
]) {
  test(`默认首页${entry.name}打开真实入口而非填写假视频问题`, async ({
    page,
  }) => {
    test.skip(
      process.env.VITE_MOCK_VIDEO_WORKFLOW === "true",
      "Default mode only",
    )
    await page.route("**/api/v1/inference/**", (route) =>
      route.fulfill({ json: [] }),
    )
    let writes = 0
    page.on("request", (request) => {
      if (request.method() === "POST") writes++
    })
    await page.goto("/")
    await page.getByRole("button", { name: new RegExp(entry.name) }).click()
    await expect(page).toHaveURL(entry.path)
    await expect(
      page.getByRole("heading", { name: entry.heading, exact: true }),
    ).toBeVisible()
    if (entry.path === "/annotations") {
      await expect(page.getByLabel("选择本地标注视频")).toBeAttached()
      await expect(page.getByRole("tab", { name: "手动标注" })).toHaveAttribute(
        "aria-selected",
        "true",
      )
    }
    expect(writes).toBe(0)
  })
}

test("待确认的研究任务在左侧栏显示", async ({ page }) => {
  const waiting = {
    ...task,
    id: "waiting-task",
    title: "等待确认视频范围",
    runs: [{ ...task.runs[0], status: "waiting_for_input" }],
  }
  await page.route("**/api/v1/agent/tasks", (route) =>
    route.fulfill({ json: [task, waiting] }),
  )
  await page.goto("/")
  await expect(
    page
      .locator(".research-sidebar-history")
      .getByRole("link", { name: /等待确认视频范围.*等待确认/ }),
  ).toHaveAttribute("href", "/tasks/waiting-task")
  await expect(
    page.getByRole("main").getByText("等待确认视频范围"),
  ).toHaveCount(0)
})

test("引导完成携带问题和范围但不自动提交", async ({ page }) => {
  let creates = 0
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/agent/tasks")) creates++
  })
  await page.addInitScript(() =>
    localStorage.removeItem("lingsight.onboarding-seen.v1"),
  )
  await page.goto("/")
  await expect(page).toHaveURL(/onboarding/)
  for (let step = 2; step <= 4; step++) {
    await page.getByRole("button", { name: "下一步" }).click()
    await expect(page.locator(".research-progress")).toContainText(
      `0${step} / 04`,
    )
  }
  await page
    .getByRole("button", {
      name: "探索轨迹与朝向",
      exact: true,
    })
    .click()
  await page.locator("summary").click()
  await page
    .getByLabel("数据范围", { exact: false })
    .fill("同一批次的视频 test-001")
  await page
    .getByLabel("研究问题", { exact: true })
    .fill("核对指定视频的有效轨迹")
  await page.getByRole("button", { name: "进入工作台", exact: true }).click()
  await expect(
    page.getByRole("textbox", { name: "研究问题", exact: true }),
  ).toHaveValue(/核对指定视频的有效轨迹/)
  await expect(
    page.getByRole("textbox", { name: "研究问题", exact: true }),
  ).toHaveValue(/test-001/)
  expect(creates).toBe(0)
})
for (const submission of ["button", "Enter"] as const) {
  test(`创建任务和刷新重放，交付物安全预览（${submission}）`, async ({
    page,
  }) => {
    await page.goto("/")
    await page
      .getByRole("textbox", { name: "研究问题", exact: true })
      .fill("核对视频数据")
    if (submission === "Enter")
      await page
        .getByRole("textbox", { name: "研究问题", exact: true })
        .press("Enter")
    else await page.getByRole("button", { name: "发送研究问题" }).click()
    await expect(page).toHaveURL(new RegExp(`/tasks/${id}`))
    await expect(
      page.getByText("已核对视频数据。", { exact: true }),
    ).toBeVisible()
    await page.reload()
    await expect(
      page.getByText("已核对视频数据。", { exact: true }),
    ).toBeVisible()
    await page.waitForTimeout(1700)
    expect(
      await page.getByText("已核对视频数据。", { exact: true }).count(),
    ).toBe(1)
    await page.getByRole("button", { name: /report.md/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await expect(page.getByRole("dialog")).toContainText(
      "<script>window.bad=true</script>",
    )
    expect(await page.evaluate(() => Object.hasOwn(window, "bad"))).toBe(false)
  })
}
test("提交失败保留输入", async ({ page }) => {
  await page.route("**/api/v1/agent/tasks", (r) =>
    r.request().method() === "POST"
      ? r.fulfill({ status: 503, json: { detail: "Agent 暂时不可用" } })
      : r.fulfill({ json: [] }),
  )
  await page.goto("/")
  await page
    .getByRole("textbox", { name: "研究问题", exact: true })
    .fill("请保留这条研究问题")
  await page.getByRole("button", { name: "发送研究问题" }).click()
  await expect(page.getByRole("alert")).toContainText("Agent 暂时不可用")
  await expect(
    page.getByRole("textbox", { name: "研究问题", exact: true }),
  ).toHaveValue("请保留这条研究问题")
})
for (const submission of ["Enter", "form"] as const) {
  test(`服务不可用时 ${submission} 不能绕过发送禁用`, async ({ page }) => {
    await page.route("**/api/v1/agent/tasks", (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ status: 503, json: { detail: "任务列表暂时不可用" } })
        : route.fallback(),
    )
    await page.goto("/")
    await expect(page.getByRole("alert")).toContainText("任务列表暂时不可用")
    const question = page.getByRole("textbox", {
      name: "研究问题",
      exact: true,
    })
    await question.fill("保留待发送的问题")
    await expect(
      page.getByRole("button", { name: "发送研究问题" }),
    ).toBeDisabled()
    const unexpectedWrite = page
      .waitForRequest(
        (request) =>
          request.method() === "POST" && request.url().includes("/agent/"),
        { timeout: 700 },
      )
      .then(
        () => true,
        () => false,
      )
    if (submission === "Enter") await question.press("Enter")
    else
      await question.locator("xpath=ancestor::form").evaluate((form) => {
        if (form instanceof HTMLFormElement) form.requestSubmit()
      })
    expect(await unexpectedWrite).toBe(false)
    await expect(question).toHaveValue("保留待发送的问题")
    await expect(page).toHaveURL("/")
  })
}

test("任务读取失败时 Enter 和表单保留草稿，不发送追问", async ({ page }) => {
  await page.route(`**/api/v1/agent/tasks/${id}`, (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "任务读取暂时不可用" },
    }),
  )
  await page.goto(`/tasks/${id}`)
  await expect(page.getByRole("alert")).toContainText("任务读取暂时不可用")
  const question = page.getByRole("textbox", { name: "研究问题", exact: true })
  await question.fill("保留追问")
  await expect(
    page.getByRole("button", { name: "发送研究问题" }),
  ).toBeDisabled()
  const unexpectedWrite = page
    .waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().includes("/agent/"),
      { timeout: 700 },
    )
    .then(
      () => true,
      () => false,
    )
  await question.press("Enter")
  await page.locator("form.agent-composer").evaluate((form) => {
    if (form instanceof HTMLFormElement) form.requestSubmit()
  })
  expect(await unexpectedWrite).toBe(false)
  await expect(question).toHaveValue("保留追问")
})

test("已有草稿进入等待口径后不能通过表单追问", async ({ page }) => {
  await page.clock.install()
  let waiting = false
  await page.route(`**/api/v1/agent/tasks/${id}`, (route) =>
    route.fulfill({
      json: waiting
        ? { ...task, runs: [{ ...task.runs[0], status: "waiting_for_input" }] }
        : task,
    }),
  )
  await page.goto(`/tasks/${id}`)
  const question = page.getByRole("textbox", { name: "研究问题", exact: true })
  await question.fill("稍后继续的追问")
  waiting = true
  await page.clock.runFor(2600)
  await expect(question).toBeDisabled()
  await expect(
    page.getByRole("button", { name: "发送研究问题" }),
  ).toBeDisabled()
  const unexpectedWrite = page
    .waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().includes("/agent/"),
      { timeout: 700 },
    )
    .then(
      () => true,
      () => false,
    )
  await page.locator("form.agent-composer").evaluate((form) => {
    if (form instanceof HTMLFormElement) form.requestSubmit()
  })
  expect(await unexpectedWrite).toBe(false)
  await expect(question).toHaveValue("稍后继续的追问")
})

test("待确认口径通过答复入口提交", async ({ page }) => {
  const waiting = {
    ...task,
    runs: [
      {
        ...task.runs[0],
        status: "waiting_for_input",
        clarifications: [
          { id: "question", question: "请确认视频 ID", answer: null },
        ],
      },
    ],
    artifacts: [],
  }
  let answer = ""
  await page.route(`**/api/v1/agent/tasks/${id}`, (r) =>
    r.fulfill({ json: waiting }),
  )
  await page.route("**/clarifications/question/answer", (r) => {
    answer = r.request().postDataJSON().answer
    return r.fulfill({ status: 202, json: { status: "queued" } })
  })
  await page.goto(`/tasks/${id}`)
  await expect(
    page.getByRole("button", { name: "发送研究问题" }),
  ).toBeDisabled()
  await page.getByRole("textbox", { name: "科研口径" }).fill("video-001")
  await page.getByRole("button", { name: "确认并继续" }).click()
  await expect.poll(() => answer).toBe("video-001")
})
test("窄屏输入框可见，侧栏可展开", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  await expect(
    page.getByRole("textbox", { name: "研究问题", exact: true }),
  ).toBeInViewport()
  expect(await page.evaluate(() => document.body.scrollWidth)).toBe(390)
  await page.locator("[data-sidebar=trigger]").click()
  await expect(
    page.getByRole("link", { name: "视频与标注", exact: true }),
  ).toBeVisible()
})

test("报告编辑失败保留修改，重试另存新版本", async ({ page }) => {
  let edits = 0
  let saved = ""
  await page.route(`**/api/v1/agent/artifacts/${artifactId}`, (route) => {
    if (route.request().method() !== "PATCH") {
      return route.fulfill({ body: "# 原始报告", contentType: "text/markdown" })
    }
    edits += 1
    if (edits === 1) {
      return route.fulfill({ status: 503, json: { detail: "保存暂时不可用" } })
    }
    saved = route.request().postDataJSON().markdown
    return route.fulfill({ json: { ...task.artifacts[0], id: "new-version" } })
  })
  await page.goto(`/tasks/${id}`)
  await page.getByRole("button", { name: /report.md/ }).click()
  await expect(
    page.getByRole("dialog").getByText("原始报告", { exact: true }),
  ).toBeVisible()
  await page.getByRole("button", { name: "编辑报告" }).click()
  await page
    .getByRole("textbox", { name: "报告 Markdown" })
    .fill("# 修订后的研究报告")
  await page.getByRole("button", { name: "另存为新版本" }).click()
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "保存暂时不可用",
  )
  await expect(
    page.getByRole("textbox", { name: "报告 Markdown" }),
  ).toHaveValue("# 修订后的研究报告")
  await page.getByRole("button", { name: "另存为新版本" }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  expect(saved).toBe("# 修订后的研究报告")
  expect(edits).toBe(2)
})

test("侧栏品牌菜单、真实任务状态与选中状态", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "灵视科研工作区菜单" }).click()
  await expect(page.getByRole("menuitem", { name: "工作区设置" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "产品首页" })).toBeVisible()
  await page.keyboard.press("Escape")
  const recent = page.getByRole("link", {
    name: /水迷宫视频探索 科研工作区 · 已完成/,
  })
  await recent.click()
  await expect(page).toHaveURL(new RegExp(`/tasks/${id}`))
  await expect(recent).toHaveAttribute("aria-current", "page")
  await page.locator(".research-sidebar-history > summary").click()
  await expect(recent).toBeHidden()
  await page.locator(".research-sidebar-history > summary").click()
  await expect(recent).toBeVisible()
})

test("搜索研究筛选完整任务列表，关闭后恢复最近任务", async ({ page }) => {
  const older = { ...task, id: "older-task", title: "早期训练日分析" }
  const recentTasks = Array.from({ length: 21 }, (_, i) => ({
    ...task,
    id: `task-${i}`,
    title: `轨迹复核 ${i + 1}`,
  }))
  await page.route("**/api/v1/agent/tasks", (route) =>
    route.fulfill({ json: [...recentTasks, older] }),
  )
  await page.goto("/")
  await expect(page.getByRole("link", { name: /早期训练日分析/ })).toHaveCount(
    0,
  )
  await page.getByRole("button", { name: "搜索研究", exact: true }).click()
  const search = page.getByRole("searchbox", { name: "搜索科研任务" })
  await expect(search).toBeFocused()
  await search.fill("早期")
  await expect(page.getByRole("link", { name: /早期训练日分析/ })).toBeVisible()
  await expect(
    page.getByRole("link", { name: /轨迹复核 1 科研工作区/ }),
  ).toHaveCount(0)
  await search.fill("没有这个任务")
  await expect(page.getByText("没有匹配的科研任务")).toBeVisible()
  await search.press("Escape")
  await expect(search).toHaveCount(0)
  await expect(
    page.getByRole("link", { name: /轨迹复核 1 科研工作区/ }),
  ).toBeVisible()
})

test("折叠侧栏仍可展开搜索，手机选择任务后关闭抽屉", async ({ page }) => {
  await page.goto("/")
  await page.locator("[data-sidebar=trigger]").click()
  await page.getByRole("button", { name: "搜索研究", exact: true }).click()
  await expect(
    page.getByRole("searchbox", { name: "搜索科研任务" }),
  ).toBeFocused()
  await page.getByRole("button", { name: "关闭搜索" }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator("[data-sidebar=trigger]").click()
  await expect(
    page.getByRole("button", { name: "灵视科研工作区菜单" }),
  ).toBeVisible()
  await page.getByRole("link", { name: /水迷宫视频探索 科研工作区/ }).click()
  await expect(page).toHaveURL(new RegExp(`/tasks/${id}`))
  await expect(page.locator('[data-mobile="true"]')).toBeHidden()
  await expect(
    page.getByRole("textbox", { name: "研究问题", exact: true }),
  ).toBeInViewport()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})

test("侧栏与首页使用中文，示例问题只填入草稿", async ({ page }) => {
  await page.route("**/api/v1/agent/tasks", (route) =>
    route.fulfill({ json: [] }),
  )
  await page.route("**/api/v1/users/me", (route) =>
    route.fulfill({
      json: {
        id: "user",
        full_name: "Researcher",
        email: "owner@example.com",
        is_superuser: false,
        is_active: true,
      },
    }),
  )
  let writes = 0
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/agent/"))
      writes++
  })
  await page.goto("/")
  await expect(
    page.getByRole("heading", { name: "动物行为研究" }),
  ).toBeVisible()
  await expect(
    page.getByRole("navigation", { name: "科研工作区导航" }).getByRole("link"),
  ).toHaveText([
    "新建科研任务",
    "实验与数据",
    "视频与标注",
    "视频推理",
    "分析与报告",
  ])
  await expect(
    page.getByRole("link", { name: "学习与记忆", exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("link", { name: "动物行为研究笔记", exact: true }),
  ).toBeVisible()
  expect(await page.locator("body").textContent()).not.toMatch(
    /Start with experimental data|New research task|Your research companion/,
  )
  await page.getByRole("button", { name: /分析已有数据/ }).click()
  await expect(
    page.getByRole("textbox", { name: "研究问题", exact: true }),
  ).toHaveValue(/比较不同训练日的逃逸潜伏期/)
  expect(writes).toBe(0)
})

test("项目可新建、归组任务、刷新保留并清空，不写 Agent 服务", async ({
  page,
}) => {
  let taskWrites = 0
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/agent/"))
      taskWrites++
  })
  await page.goto("/")
  await page.getByRole("button", { name: "新建项目", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("项目名称").fill("Spatial learning pilot")
  await dialog.getByRole("button", { name: "新建项目", exact: true }).click()
  await expect(dialog).toBeHidden()
  await page
    .getByRole("link", { name: "Spatial learning pilot", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "Spatial learning pilot" }),
  ).toBeVisible()
  await page.getByRole("link", { name: "项目资料" }).click()
  await page.getByText("项目设置", { exact: true }).click()
  await page.getByRole("button", { name: "整理对话" }).click()
  await page.getByRole("checkbox", { name: task.title }).check()
  await page.getByRole("button", { name: "保存项目" }).click()
  await page.getByRole("link", { name: "返回项目对话" }).click()
  await expect(
    page
      .getByRole("region", { name: "项目对话" })
      .getByRole("link", { name: new RegExp(task.title) }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page
      .getByRole("region", { name: "项目对话" })
      .getByRole("link", { name: new RegExp(task.title) }),
  ).toBeVisible()
  await page.getByRole("link", { name: "项目资料" }).click()
  await page.getByText("项目设置", { exact: true }).click()
  await page.getByRole("button", { name: "整理对话" }).click()
  await page.getByRole("checkbox", { name: task.title }).uncheck()
  await page.getByRole("button", { name: "保存项目" }).click()
  await page.getByRole("link", { name: "返回项目对话" }).click()
  await expect(page.getByText("暂无对话，从下方输入框开始。")).toBeVisible()
  await expect(
    page
      .locator(".research-history-list")
      .getByRole("link", { name: new RegExp(task.title) }),
  ).toBeVisible()
  expect(taskWrites).toBe(0)
})

test("项目可改名与删除，删除后任务保留", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("link", { name: "学习与记忆", exact: true }).click()
  await expect(page).toHaveURL(/\/projects\/learning-memory/)
  await page.getByRole("link", { name: "项目资料" }).click()
  await page.getByText("项目设置", { exact: true }).click()
  await page.getByRole("button", { name: "重命名项目" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("项目名称").fill("空间学习试点")
  await dialog.getByRole("button", { name: "保存名称" }).click()
  await expect(dialog).toBeHidden()
  await expect(
    page.getByRole("main").getByText("空间学习试点", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("link", { name: "空间学习试点", exact: true }),
  ).toBeVisible()
  await page.getByRole("button", { name: "删除项目" }).click()
  await expect(
    page.getByRole("dialog").getByText("此操作不可撤销"),
  ).toBeVisible()
  await page.getByRole("button", { name: "确认删除" }).click()
  await expect(page).toHaveURL("/")
  await expect(
    page.getByRole("link", { name: "空间学习试点", exact: true }),
  ).toHaveCount(0)
  await expect(
    page
      .locator(".research-history-list")
      .getByRole("link", { name: new RegExp(task.title) }),
  ).toBeVisible()
})

test("新建项目失败保留名称并允许重试", async ({ page }) => {
  let failCreate = true
  await page.route("**/api/v1/projects/", (route) => {
    if (route.request().method() === "POST" && failCreate)
      return route.fulfill({
        status: 503,
        json: { detail: "项目服务暂时不可用" },
      })
    return route.fallback()
  })
  await page.goto("/")
  await page.getByRole("button", { name: "新建项目", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("项目名称").fill("Keep this project name")
  await dialog.getByRole("button", { name: "新建项目", exact: true }).click()
  await expect(dialog.getByRole("alert")).toContainText("项目服务暂时不可用")
  await expect(dialog.getByLabel("项目名称")).toHaveValue(
    "Keep this project name",
  )
  await expect(
    page.getByRole("link", { name: "Keep this project name", exact: true }),
  ).toHaveCount(0)
  failCreate = false
  await dialog.getByRole("button", { name: "新建项目", exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(
    page.getByRole("link", { name: "Keep this project name", exact: true }),
  ).toBeVisible()
})

test("项目接口失败不阻塞科研任务", async ({ page }) => {
  await page.route("**/api/v1/projects/**", (route) =>
    route.fulfill({ status: 500, json: { detail: "projects down" } }),
  )
  await page.goto("/")
  await expect(page.getByText("无法加载项目，请稍后重试。")).toBeVisible()
  await expect(
    page.getByRole("button", { name: "新建项目", exact: true }),
  ).toBeDisabled()
  await expect(
    page.getByRole("textbox", { name: "研究问题", exact: true }),
  ).toBeVisible()
  await page
    .locator(".research-history-list")
    .getByRole("link", { name: new RegExp(task.title) })
    .click()
  await expect(page).toHaveURL(new RegExp(`/tasks/${id}`))
})

test("localStorage 旧项目一次性迁移导入且重放幂等", async ({ page }) => {
  const state = stubProjectsApi(page, [])
  let releaseInitialList!: () => void
  const initialListPending = new Promise<void>((resolve) => {
    releaseInitialList = resolve
  })
  let markInitialListStarted!: () => void
  const initialListStarted = new Promise<void>((resolve) => {
    markInitialListStarted = resolve
  })
  let initialList = true
  await page.route("**/api/v1/projects/", async (route) => {
    if (route.request().method() !== "GET" || !initialList)
      return route.fallback()
    initialList = false
    // The first read began before import: its empty snapshot arrives afterward.
    markInitialListStarted()
    await initialListPending
    return route.fulfill({ json: { data: [], count: 0 } })
  })
  await page.route("**/api/v1/projects/import", async (route) => {
    await initialListStarted
    return route.fallback()
  })
  await page.addInitScript(() => {
    localStorage.setItem(
      "lingsight.workspace-projects.v1:user",
      JSON.stringify([
        {
          id: "legacy-1",
          name: "学习与记忆",
          taskIds: ["11111111-1111-4111-8111-111111111111"],
        },
        { id: "legacy-2", name: "动物行为研究笔记", taskIds: [] },
      ]),
    )
  })
  await page.goto("/")
  await page.waitForFunction(
    () =>
      localStorage.getItem("lingsight.workspace-projects.migrated.v1:user") ===
      "1",
  )
  releaseInitialList()
  await expect(
    page.getByRole("link", { name: "学习与记忆", exact: true }),
  ).toBeVisible()
  expect(state.imports.length).toBe(1)
  expect(state.imports[0]).toEqual([
    {
      name: "学习与记忆",
      task_ids: ["11111111-1111-4111-8111-111111111111"],
    },
    { name: "动物行为研究笔记", task_ids: [] },
  ])
  expect(
    await page.evaluate(() =>
      localStorage.getItem("lingsight.workspace-projects.v1:user"),
    ),
  ).toBeNull()
  expect(
    await page.evaluate(() =>
      localStorage.getItem("lingsight.workspace-projects.migrated.v1:user"),
    ),
  ).toBe("1")
  await page.getByRole("link", { name: "学习与记忆", exact: true }).click()
  await expect(
    page
      .getByRole("region", { name: "项目对话" })
      .getByRole("link", { name: new RegExp(task.title) }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole("link", { name: "学习与记忆", exact: true }),
  ).toBeVisible()
  expect(state.imports.length).toBe(1)
})

test("项目页查看已发布推理结果的逐帧行摘要", async ({ page }) => {
  const taskId = "77777777-7777-4777-8777-777777777777"
  const frames = (offset: number, count: number, total: number) => ({
    data: Array.from({ length: count }, (_, i) => ({
      frame_idx: offset + i,
      mask_valid: true,
      centroid_x: 101.5 + offset + i,
      centroid_y: 202.25,
      contour_area: 320.5,
      head_x: 90,
      head_y: 80,
      tail_x: 110,
      tail_y: 120,
      heading_angle_deg: 10.25 + offset + i,
      is_proposal: offset + i === 2,
      keypoint_correction: offset + i === 1 ? "head_tail_swapped" : "",
    })),
    count: total,
    offset,
    limit: 50,
  })
  await page.route("**/api/v1/projects/learning-memory/results", (route) =>
    route.fulfill({
      json: {
        data: [
          {
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
          },
        ],
        count: 1,
      },
    }),
  )
  await page.route(
    "**/api/v1/projects/learning-memory/results/*/frames**",
    async (route) => {
      const url = new URL(route.request().url())
      const offset = Number(url.searchParams.get("offset") ?? "0")
      expect(url.pathname.endsWith(`${taskId}/frames`)).toBe(true)
      return route.fulfill({ json: frames(offset, 3, 53) })
    },
  )
  await page.goto("/projects/learning-memory?view=details")
  await page.getByRole("tab", { name: "数据库" }).click()
  await expect(
    page.getByRole("heading", { name: "已发布推理结果" }),
  ).toBeVisible()
  await expect(
    page.getByText("30 fps · 总帧 600 · 有效帧 580 · 带朝向 570（提案 12）"),
  ).toBeVisible()
  await page.getByRole("button", { name: "查看逐帧行" }).click()
  await expect(
    page.getByRole("cell", { name: "10.25", exact: true }),
  ).toBeVisible()
  await expect(page.getByText("头尾已换")).toBeVisible()
  await expect(page.getByText("提案").first()).toBeVisible()
  await expect(page.getByText("第 1–3 行，共 53 行")).toBeVisible()
  await page.getByRole("button", { name: "下一页" }).click()
  await expect(page.getByText("第 51–53 行，共 53 行")).toBeVisible()

  await page.getByRole("tab", { name: "推理可视化视频" }).click()
  const overlayPath = `/api/v1/inference/tasks/${taskId}/artifacts/overlay.mp4`
  await page.route(`**${overlayPath}?*`, (route) =>
    route.fulfill({ status: 404 }),
  )
  const media = page.waitForRequest(
    (request) => new URL(request.url()).pathname === overlayPath,
  )
  await page.getByRole("button", { name: "播放 day01/maze.mp4" }).click()
  expect(new URL((await media).url()).searchParams.has("token")).toBe(true)
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "暂时无法播放",
  )
})

test("项目资料中的分析产物可打开原对话报告", async ({ page }) => {
  stubProjectsApi(page, [
    {
      id: "learning-memory",
      name: "学习与记忆",
      members: [{ kind: "agent_task", id, label: task.title }],
    },
  ])
  await page.goto("/projects/learning-memory?view=details")
  await expect(page.getByRole("tab", { name: "原始视频" })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await expect(page.getByLabel("视频来源", { exact: true })).toHaveCount(0)
  await page.getByRole("tab", { name: "分析产物" }).click()
  await page.getByRole("button", { name: /report.md/ }).click()
  await expect(
    page.getByRole("dialog").getByText("研究报告", { exact: true }),
  ).toBeVisible()
})

for (const status of [
  "queued",
  "running",
  "waiting_for_input",
  "succeeded",
  "cancelled",
  "failed",
  "interrupted",
]) {
  test(`后台运行提示遵循任务状态 ${status} (#61)`, async ({ page }) => {
    await page.route(`**/api/v1/agent/tasks/${id}`, (route) =>
      route.fulfill({ json: { ...task, runs: [{ ...task.runs[0], status }] } }),
    )
    await page.goto(`/tasks/${id}`)
    await expect(page.getByRole("heading", { name: task.title })).toBeVisible()
    const note = page.getByText("离开页面后任务仍会继续运行", { exact: true })
    if (["queued", "running"].includes(status)) await expect(note).toBeVisible()
    else await expect(note).toHaveCount(0)
  })
}

test("不存在任务停止请求并可返回列表打开合法任务 (#60)", async ({ page }) => {
  const missing = "00000000-0000-4000-8000-000000000000"
  let reads = 0
  await page.route(`**/api/v1/agent/tasks/${missing}**`, (route) => {
    reads++
    return route.fulfill({ status: 404, json: { detail: "Task not found" } })
  })
  await page.clock.install()
  await page.goto(`/tasks/${missing}`)
  await expect(
    page.getByText("任务不存在或已被删除", { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole("textbox", { name: "研究问题" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "重试连接" })).toHaveCount(0)
  const initialReads = reads
  await page.clock.runFor(15000)
  expect(reads).toBe(initialReads)
  await page.getByRole("link", { name: "返回任务列表" }).click()
  await expect(page).toHaveURL("/analysis")
  await page
    .getByRole("link", { name: new RegExp(task.title) })
    .last()
    .click()
  await expect(page.getByRole("heading", { name: task.title })).toBeVisible()
  await expect(page.getByRole("textbox", { name: "研究问题" })).toBeVisible()
})

test("报告预览渲染 Markdown 语义并保留源码编辑 (#58)", async ({ page }) => {
  const markdown =
    "# 研究报告\n> **版本说明**\n\n## 目标\n正文 *强调* 与 `代码`。\n\n- 第一项\n- 第二项\n\n1. 步骤一\n2. 步骤二\n\n```python\nprint('example')\n```"
  await page.route(`**/api/v1/agent/artifacts/${artifactId}`, (route) =>
    route.fulfill({ contentType: "text/markdown", body: markdown }),
  )
  await page.goto(`/tasks/${id}`)
  await page.getByRole("button", { name: /report.md/ }).click()
  const dialog = page.getByRole("dialog")
  await expect(
    dialog.getByRole("heading", { name: "研究报告", level: 1 }),
  ).toBeVisible()
  await expect(
    dialog.getByRole("heading", { name: "目标", level: 2 }),
  ).toBeVisible()
  await expect(dialog.locator("blockquote strong")).toHaveText("版本说明")
  await expect(dialog.locator("em")).toHaveText("强调")
  await expect(dialog.locator("ul > li")).toHaveText(["第一项", "第二项"])
  await expect(dialog.locator("ol > li")).toHaveText(["步骤一", "步骤二"])
  await expect(dialog.locator("pre code")).toContainText("print('example')")
  await expect(dialog.locator("p code")).toHaveText("代码")
  await dialog.getByRole("button", { name: "编辑报告" }).click()
  await expect(
    dialog.getByRole("textbox", { name: "报告 Markdown" }),
  ).toHaveValue(markdown)
})

test("临时 503 恢复后继续加载任务和进度 (#60)", async ({ page }) => {
  let unavailable = true
  await page.route(`**/api/v1/agent/tasks/${id}`, (route) =>
    unavailable
      ? route.fulfill({ status: 503, json: { detail: "服务暂不可用" } })
      : route.fulfill({ json: task }),
  )
  await page.clock.install()
  await page.goto(`/tasks/${id}`)
  await expect(page.getByText("服务暂不可用", { exact: true })).toBeVisible()
  unavailable = false
  await page.clock.runFor(3000)
  await expect(page.getByRole("heading", { name: task.title })).toBeVisible()
  await expect(
    page.getByText("已核对视频数据。", { exact: true }),
  ).toBeVisible()
})

test("报告不执行 HTML、危险链接或加载远程图片 (#58)", async ({ page }) => {
  const requests: string[] = []
  page.on("request", (request) => {
    if (request.url().includes("external.example")) requests.push(request.url())
  })
  await page.route(`**/api/v1/agent/artifacts/${artifactId}`, (route) =>
    route.fulfill({
      contentType: "text/markdown",
      body: '<script>window.bad=true</script>\n\n<img src="https://external.example/raw.png">\n\n![远程图片](https://external.example/track.png)\n\n[危险链接](javascript:alert%281%29)\n\n[参考文献](https://example.com/paper)',
    }),
  )
  await page.goto(`/tasks/${id}`)
  await page.getByRole("button", { name: /report.md/ }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("link", { name: "参考文献" })).toHaveAttribute(
    "href",
    "https://example.com/paper",
  )
  await expect(dialog.locator("img, script, iframe")).toHaveCount(0)
  await expect(
    dialog.getByText("危险链接", { exact: true }),
  ).not.toHaveAttribute("href", /javascript:/)
  expect(await page.evaluate(() => Object.hasOwn(window, "bad"))).toBe(false)
  expect(requests).toEqual([])
})
