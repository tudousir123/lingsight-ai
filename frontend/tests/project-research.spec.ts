import { expect, test } from "@playwright/test"
import {
  emptyWorkspaceMemoryResponse,
  personalAgentFixture,
  personalTaskBinding,
  requestIdPattern,
  researchExecutionCapabilityFixture,
} from "./utils/personalAgentApi"
import { stubProjectsApi } from "./utils/projectsApi"

const projectId = "44444444-4444-4444-8444-444444444444"
const taskId = "11111111-1111-4111-8111-111111111111"
const runId = "22222222-2222-4222-8222-222222222222"

test.use({ storageState: { cookies: [], origins: [] } })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "test-token")
    localStorage.setItem("lingsight.onboarding-seen.v1", "1")
  })
  await page.route("**/api/v1/users/me", (route) =>
    route.fulfill({
      json: {
        id: "user",
        email: "owner@example.com",
        is_active: true,
        is_superuser: false,
      },
    }),
  )
  stubProjectsApi(page, [{ id: projectId, name: "当前研究", members: [] }])
  await page.route("**/api/v1/projects/*/results**", (route) =>
    route.fulfill({ json: { data: [], count: 0 } }),
  )
})

test("project entry carries immutable scope and groups the created task", async ({
  page,
}) => {
  const created = {
    ...personalTaskBinding,
    id: taskId,
    project_id: projectId,
    title: "项目分析",
    goal: "检查朝向",
    created_at: "2026-11-11T00:00:00Z",
    runs: [
      { id: runId, instruction: "检查朝向", status: "succeeded", error: null },
    ],
    artifacts: [],
  }
  const requests: { path: string; body: unknown }[] = []
  let exists = false
  await page.route("**/api/v1/agent/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const memory = emptyWorkspaceMemoryResponse(path, projectId)
    if (request.method() === "GET" && memory)
      return route.fulfill({ json: memory })
    if (path.endsWith("/capabilities"))
      return route.fulfill({ json: researchExecutionCapabilityFixture })
    if (path.endsWith("/personal-agent"))
      return route.fulfill({ json: personalAgentFixture })
    if (request.method() === "POST") {
      requests.push({ path, body: request.postDataJSON() })
      exists = true
      return route.fulfill({
        status: 202,
        json: { task: created, run: created.runs[0] },
      })
    }
    return route.fulfill({
      json: path.endsWith("/events")
        ? []
        : path.endsWith("/tasks")
          ? exists
            ? [created]
            : []
          : created,
    })
  })
  await page.goto(`/projects/${projectId}`)
  await expect(page.getByRole("heading", { name: "当前研究" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "项目对话" })).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "选择视频文件夹" }),
  ).toHaveCount(0)
  await page
    .getByRole("textbox", { name: "研究问题", exact: true })
    .fill("检查朝向")
  await page.getByRole("button", { name: "发送研究问题", exact: true }).click()
  await expect(page).toHaveURL(`/tasks/${taskId}`)
  expect(requests[0].body).toEqual({
    goal: "检查朝向",
    project_id: projectId,
    request_id: expect.stringMatching(requestIdPattern),
  })
  await page.reload()
  await expect(
    page.getByRole("button", { name: "刷新科研记忆", exact: true }),
  ).toBeEnabled()
  await expect(page.getByRole("status")).toContainText(
    "当前项目的已发布推理数据",
  )
  await page
    .getByRole("textbox", { name: "研究问题", exact: true })
    .fill("补充缺失情况")
  await page.getByRole("button", { name: "发送研究问题", exact: true }).click()
  await expect.poll(() => requests.length).toBe(2)
  expect(requests[1].body).toEqual({
    text: "补充缺失情况",
    request_id: expect.stringMatching(requestIdPattern),
  })
  await page
    .getByRole("main")
    .getByRole("link", { name: "当前研究", exact: true })
    .click()
  const conversation = page
    .getByRole("region", { name: "项目对话" })
    .getByRole("link", { name: /项目分析/ })
  await expect(conversation).toBeVisible()
  await conversation.click()
  await expect(page).toHaveURL(`/tasks/${taskId}?project=${projectId}`)
  await expect(page.getByRole("heading", { name: "项目分析" })).toBeVisible()
})

test("unavailable project retains the question without creating an unscoped task", async ({
  page,
}) => {
  let creates = 0
  await page.route("**/api/v1/agent/**", (route) => {
    const memory = emptyWorkspaceMemoryResponse(
      new URL(route.request().url()).pathname,
    )
    if (route.request().method() === "GET" && memory)
      return route.fulfill({ json: memory })
    if (new URL(route.request().url()).pathname.endsWith("/capabilities"))
      return route.fulfill({ json: researchExecutionCapabilityFixture })
    if (new URL(route.request().url()).pathname.endsWith("/personal-agent"))
      return route.fulfill({ json: personalAgentFixture })
    if (route.request().method() === "POST") creates++
    return route.fulfill({ json: [] })
  })
  await page.goto("/project-research/55555555-5555-4555-8555-555555555555")
  await page
    .getByRole("textbox", { name: "研究问题", exact: true })
    .fill("保留这个问题")
  await page.getByRole("button", { name: "发送研究问题", exact: true }).click()
  await expect(page.getByRole("alert")).toContainText("项目不可用")
  await expect(
    page.getByRole("textbox", { name: "研究问题", exact: true }),
  ).toHaveValue("保留这个问题")
  expect(creates).toBe(0)
})

test("unexpected upstream scope stops the new run without grouping or resending", async ({
  page,
}) => {
  const posts: string[] = []
  let groups = 0
  await page.route("**/api/v1/projects/*/members", (route) => {
    groups++
    return route.fulfill({ status: 204 })
  })
  await page.route("**/api/v1/agent/**", (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const memory = emptyWorkspaceMemoryResponse(path, projectId)
    if (request.method() === "GET" && memory)
      return route.fulfill({ json: memory })
    if (path.endsWith("/capabilities"))
      return route.fulfill({ json: researchExecutionCapabilityFixture })
    if (path.endsWith("/personal-agent"))
      return route.fulfill({ json: personalAgentFixture })
    if (request.method() !== "POST") return route.fulfill({ json: [] })
    posts.push(path)
    return route.fulfill({
      status: path.endsWith("/cancel") ? 200 : 202,
      json: path.endsWith("/cancel")
        ? { status: "cancelled" }
        : {
            task: { id: taskId, project_id: null, title: "wrong scope" },
            run: { id: runId },
          },
    })
  })
  await page.goto(`/project-research/${projectId}`)
  await page
    .getByRole("textbox", { name: "研究问题", exact: true })
    .fill("只分析本项目")
  await page.getByRole("button", { name: "发送研究问题", exact: true }).click()
  await expect(page.getByRole("alert")).toContainText(
    "项目范围不一致，任务已停止",
  )
  expect(posts).toEqual([
    "/api/v1/agent/tasks",
    `/api/v1/agent/runs/${runId}/cancel`,
  ])
  expect(groups).toBe(0)
  await expect(page).toHaveURL(`/project-research/${projectId}`)
  await expect(
    page.getByRole("textbox", { name: "研究问题", exact: true }),
  ).toHaveValue("只分析本项目")
})

for (const sourceProject of ["66666666-6666-4666-8666-666666666666", null]) {
  test(`归组旧对话保留其原有数据范围（${sourceProject ? "其他项目" : "未限定项目"}）`, async ({
    page,
  }) => {
    const messages: unknown[] = []
    stubProjectsApi(page, [
      {
        id: projectId,
        name: "当前研究",
        members: [{ kind: "agent_task", id: taskId, label: "旧项目对话" }],
      },
      ...(sourceProject
        ? [{ id: sourceProject, name: "原始研究", members: [] }]
        : []),
    ])
    const task = {
      ...personalTaskBinding,
      id: taskId,
      project_id: sourceProject,
      title: "旧项目对话",
      goal: "检查朝向",
      created_at: "2026-11-11T00:00:00Z",
      runs: [],
      artifacts: [],
    }
    await page.route("**/api/v1/agent/**", (route) => {
      const path = new URL(route.request().url()).pathname
      const memory = emptyWorkspaceMemoryResponse(path, sourceProject)
      if (route.request().method() === "GET" && memory)
        return route.fulfill({ json: memory })
      if (path.endsWith("/capabilities"))
        return route.fulfill({ json: researchExecutionCapabilityFixture })
      if (path.endsWith("/personal-agent"))
        return route.fulfill({ json: personalAgentFixture })
      if (route.request().method() === "POST") {
        messages.push(route.request().postDataJSON())
        return route.fulfill({ status: 202, json: { status: "queued" } })
      }
      return route.fulfill({
        json: path.endsWith("/events")
          ? []
          : path.endsWith("/tasks")
            ? [task]
            : task,
      })
    })
    await page.goto(`/projects/${projectId}`)
    await page
      .getByRole("region", { name: "项目对话" })
      .getByRole("link", { name: /旧项目对话/ })
      .click()
    await expect(page.getByRole("status")).toHaveText(
      sourceProject
        ? "分析范围为原始研究的已发布推理数据"
        : "此对话未限定项目数据范围；归组不会改变分析范围",
    )
    await page
      .getByRole("textbox", { name: "研究问题", exact: true })
      .fill("继续原范围分析")
    await page
      .getByRole("button", { name: "发送研究问题", exact: true })
      .click()
    await expect(
      page.getByRole("textbox", { name: "研究问题", exact: true }),
    ).toHaveValue("")
    expect(messages).toEqual([
      {
        text: "继续原范围分析",
        request_id: expect.stringMatching(requestIdPattern),
      },
    ])
    await page
      .getByRole("main")
      .getByRole("link", { name: "当前研究", exact: true })
      .click()
    await expect(page).toHaveURL(`/projects/${projectId}`)
  })
}
