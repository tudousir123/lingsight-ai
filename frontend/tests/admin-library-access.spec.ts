import { expect, test } from "@playwright/test"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"
import { randomEmail, randomPassword } from "./utils/random"

// 全栈：管理员（默认登录态）授予、撤销另一个账号的整库只读访问。
test("管理员授予并撤销整库访问：理由必填，目标账号的可见范围随之变化", async ({
  page,
  browser,
}) => {
  const email = randomEmail()
  const password = randomPassword()
  const signup = await page.request.post("/api/v1/users/signup", {
    data: { email, password, full_name: "待授权账号" },
  })
  expect(signup.ok()).toBeTruthy()
  const login = await page.request.post("/api/v1/login/access-token", {
    form: { username: email, password },
  })
  const token = (await login.json()).access_token as string
  const me = await page.request.get("/api/v1/users/me", {
    headers: { Authorization: `Bearer ${token}` },
  })
  const targetId = (await me.json()).id as string
  const experiments = async () =>
    (
      await (
        await page.request.get("/api/v1/experiments", {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).json()
    ).data as unknown[]

  // 非管理员既不能读也不能写授权接口（按 HTTP 状态判断，不看文案）。
  const forbidden = await page.request.get(
    `/api/v1/users/${targetId}/whole-library-access`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  expect(forbidden.status()).toBe(403)
  expect(await experiments()).toEqual([])

  const target = await (
    await browser.newContext({ baseURL: test.info().project.use.baseURL })
  ).newPage()
  await target.addInitScript((value) => {
    localStorage.setItem("access_token", value)
    localStorage.setItem("lingsight.onboarding-seen.v1", "1")
  }, token)
  await target.goto("/annotations?view=directory")
  await expect(target.getByText("暂无可访问的实验")).toBeVisible()
  // 非管理员看不到用户管理入口：访问 /admin 会被带回首页。
  await target.goto("/admin")
  await expect(target).not.toHaveURL(/\/admin/)

  await page.goto("/admin")
  const row = page.getByRole("row").filter({ hasText: email })
  await row.getByRole("button", { name: `管理用户 ${email}` }).click()
  await page.getByRole("menuitem", { name: "整库访问" }).click()
  const dialog = page.getByRole("dialog", { name: "整库只读访问" })
  const state = dialog.getByTestId("library-access-state")
  await expect(state).toContainText("未授予")
  await expect(state).toContainText("不生效")

  const grant = dialog.getByRole("button", { name: "授予整库只读访问" })
  const revoke = dialog.getByRole("button", { name: "撤销整库访问" })
  await expect(grant).toBeDisabled()
  await expect(revoke).toBeDisabled()
  // 只有空白也不算理由。
  await dialog.getByLabel("授权理由").fill("   ")
  await expect(grant).toBeDisabled()
  await dialog.getByLabel("授权理由").fill("x".repeat(1001))
  await expect(dialog.getByRole("alert")).toContainText("最多 1000")
  await expect(grant).toBeDisabled()

  await dialog.getByLabel("授权理由").fill("  课题组审批：只读浏览水迷宫整库  ")
  await grant.click()
  await expect(state).toContainText("已授予")
  await expect(state).toContainText("生效")
  await expect(state).toContainText("课题组审批：只读浏览水迷宫整库")
  await page.screenshot({
    path: "test-results/admin-library-access-granted.png",
  })
  const adminLogin = await page.request.post("/api/v1/login/access-token", {
    form: { username: firstSuperuser, password: firstSuperuserPassword },
  })
  const adminToken = (await adminLogin.json()).access_token as string
  const granted = await page.request.get(
    `/api/v1/users/${targetId}/whole-library-access`,
    { headers: { Authorization: `Bearer ${adminToken}` } },
  )
  expect(await granted.json()).toMatchObject({
    granted: true,
    effective: true,
    reason: "课题组审批：只读浏览水迷宫整库",
  })

  // 授权在下一次请求即生效，目标账号看到被授权范围内的库。
  await expect.poll(async () => (await experiments()).length).toBeGreaterThan(0)
  await target.goto("/annotations?view=directory")
  await expect(target.getByText("当前实验")).toBeVisible()
  await expect(target.getByText("暂无可访问的实验")).toHaveCount(0)
  await target.screenshot({
    path: "test-results/granted-account-sees-library.png",
    fullPage: true,
  })

  // 撤销同样要理由，撤销后目标账号不再看到。
  await dialog.getByLabel("授权理由").fill("项目结束，收回访问")
  await revoke.click()
  await expect(state).toContainText("未授予")
  await expect(state).toContainText("不生效")
  await expect(state).toContainText("项目结束，收回访问")
  expect(await experiments()).toEqual([])
  await target.goto("/annotations?view=directory")
  await expect(target.getByText("暂无可访问的实验")).toBeVisible()
})
