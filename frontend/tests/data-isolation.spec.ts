import { expect, type Page, test } from "@playwright/test"
import { randomEmail, randomPassword } from "./utils/random"

// 全栈：真实后端、真实授权。每个测试用新注册的账号，互不影响。
test.use({ storageState: { cookies: [], origins: [] } })

async function signUpAndToken(page: Page, email: string, password: string) {
  const signup = await page.request.post("/api/v1/users/signup", {
    data: { email, password, full_name: "隔离测试" },
  })
  expect(signup.ok()).toBeTruthy()
  const login = await page.request.post("/api/v1/login/access-token", {
    form: { username: email, password },
  })
  expect(login.ok()).toBeTruthy()
  return (await login.json()).access_token as string
}

async function signIn(page: Page, token: string) {
  await page.addInitScript((value) => {
    localStorage.setItem("access_token", value)
    localStorage.setItem("lingsight.onboarding-seen.v1", "1")
  }, token)
}

const api = (page: Page, token: string, path: string) =>
  page.request.get(`/api/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

test("新用户登录后进入工作区，但实验、试次目录与视频来源看不到整库", async ({
  page,
}) => {
  const token = await signUpAndToken(page, randomEmail(), randomPassword())
  await signIn(page, token)

  const workspace = await (await api(page, token, "/users/me/workspace")).json()
  expect(workspace).toMatchObject({
    workspace_enabled: true,
    whole_library_access: false,
    allowed_experiment_ids: [],
  })
  const experiments = await api(page, token, "/experiments")
  // 合法但无数据：200 空集合，而不是错误。
  expect(experiments.status()).toBe(200)
  expect((await experiments.json()).data).toEqual([])
  const sources = await (await api(page, token, "/inference/sources"))
    .json()
    .catch(() => [])
  if (Array.isArray(sources))
    expect(
      sources.every((item: { kind: string }) => item.kind === "user_upload"),
    ).toBe(true)

  await page.goto("/annotations?view=directory")
  await expect(page.getByText("暂无可访问的实验")).toBeVisible()
  await expect(page.getByText("新账号默认只能看到自己上传的视频")).toBeVisible()
  // 空库不是加载失败。
  await expect(page.getByText("实验列表加载失败")).toHaveCount(0)

  // 推理页：先要有项目；没有项目也没有整库目录。
  await page.goto("/inference")
  await expect(
    page.getByRole("heading", { name: "视频推理", exact: true }),
  ).toBeVisible()
  await expect(page.getByText("已授权的实验视频目录")).toHaveCount(0)
  await expect(page.getByText(/还没有项目/)).toBeVisible()
  await page.screenshot({
    path: "test-results/new-user-empty-library.png",
    fullPage: true,
  })
})

test("新建项目后项目页只有上传入口，没有目录来源，也不出现整库试次", async ({
  page,
}) => {
  const token = await signUpAndToken(page, randomEmail(), randomPassword())
  await signIn(page, token)
  const created = await page.request.post("/api/v1/projects", {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: "我的上传项目" },
  })
  expect(created.ok()).toBeTruthy()
  const project = await created.json()
  await page.goto(`/projects/${project.id}?view=details`)
  await expect(page.getByText("上传视频（mp4 / avi，最大 2 GB）")).toBeVisible()
  await expect(page.getByText(/^(添加视频|管理视频来源)$/)).toHaveCount(0)
  await expect(page.getByText("暂无原始视频。")).toBeVisible()
  // 真实后端的项目视频列表对新项目是 200 空集合。
  const list = await api(page, token, `/projects/${project.id}/videos`)
  expect(list.status()).toBe(200)
  expect((await list.json()).count).toBe(0)
  await page.screenshot({
    path: "test-results/project-upload.png",
    fullPage: true,
  })
})
