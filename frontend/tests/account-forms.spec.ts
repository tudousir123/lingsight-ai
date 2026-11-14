import { expect, type Page, test } from "@playwright/test"
import { stubProjectsApi } from "./utils/projectsApi"

test.use({ storageState: { cookies: [], origins: [] } })

async function openAccountForm(page: Page, mode: "signup" | "admin") {
  await page.addInitScript((authenticated) => {
    if (authenticated)
      localStorage.setItem("access_token", "synthetic-account-token")
    localStorage.setItem("lingsight.onboarding-seen.v1", "1")
  }, mode === "admin")
  await page.route("**/api/v1/users/me", (route) =>
    route.fulfill({
      json: {
        id: "account-user",
        email: "account@example.com",
        full_name: "研究者",
        is_active: true,
        is_superuser: true,
      },
    }),
  )
  await page.route("**/api/v1/users/?*", (route) =>
    route.fulfill({ json: { data: [], count: 0 } }),
  )
  await page.route("**/api/v1/agent/tasks", (route) =>
    route.fulfill({ json: [] }),
  )
  stubProjectsApi(page, [])
  await page.goto(mode === "signup" ? "/signup" : "/admin")
  if (mode === "admin")
    await page.getByRole("button", { name: /^(Add User|新增用户)$/ }).click()
}

for (const mode of ["signup", "admin"] as const) {
  test(`超长姓名定位字段并阻止提交 ${mode} (#57)`, async ({ page }) => {
    await openAccountForm(page, mode)
    let writes = 0
    await page.route("**/api/v1/users/**", (route) => {
      if (route.request().method() === "POST") {
        writes++
        return route.fulfill({ json: {} })
      }
      return route.fallback()
    })
    const name = page.locator('input[name="full_name"]')
    await name.fill("长".repeat(256))
    await name.blur()
    await expect(name).toHaveAttribute("aria-invalid", "true")
    await expect(
      page.getByText("姓名最多 255 个字符", { exact: true }),
    ).toBeVisible()
    await page.locator('input[name="email"]').fill("synthetic@example.com")
    await page.locator('input[name="password"]').fill("Synthetic-password-123!")
    await page
      .locator('input[name="confirm_password"]')
      .fill("Synthetic-password-123!")
    await page
      .getByRole("button", { name: /^(Sign Up|Save|注册|保存)$/ })
      .click()
    expect(writes).toBe(0)
    await name.fill("长".repeat(255))
    await name.blur()
    await expect(name).toHaveAttribute("aria-invalid", "false")
    await page
      .getByRole("button", { name: /^(Sign Up|Save|注册|保存)$/ })
      .click()
    await expect.poll(() => writes).toBe(1)
  })
}

for (const mode of ["signup", "admin"] as const) {
  test(`服务端姓名校验错误定位到字段 ${mode} (#57)`, async ({ page }) => {
    await openAccountForm(page, mode)
    await page.route("**/api/v1/users/**", (route) => {
      if (route.request().method() === "POST")
        return route.fulfill({
          status: 422,
          json: {
            detail: [
              {
                loc: ["body", "full_name"],
                type: "value_error",
                msg: "Invalid name",
              },
            ],
          },
        })
      return route.fallback()
    })
    const name = page.locator('input[name="full_name"]')
    await name.fill("合成姓名")
    await page.locator('input[name="email"]').fill("synthetic@example.com")
    await page.locator('input[name="password"]').fill("Synthetic-password-123!")
    await page
      .locator('input[name="confirm_password"]')
      .fill("Synthetic-password-123!")
    await page
      .getByRole("button", { name: /^(Sign Up|Save|注册|保存)$/ })
      .click()
    await expect(name).toHaveAttribute("aria-invalid", "true")
    await expect(
      page.getByText("姓名无效，请检查后重试", { exact: true }),
    ).toBeVisible()
    await expect(name).toHaveValue("合成姓名")
  })
}

for (const entry of [
  {
    path: "/login",
    heading: "登录 LingSight",
    submit: "登录",
    error: "请输入有效的邮箱地址",
  },
  { path: "/signup", heading: "创建账号", submit: "注册", error: "请填写姓名" },
  {
    path: "/recover-password",
    heading: "找回密码",
    submit: "继续",
    error: "请输入有效的邮箱地址",
  },
  {
    path: "/reset-password?token=synthetic",
    heading: "重置密码",
    submit: "重置密码",
    error: "请填写密码",
  },
]) {
  test(`认证页面提供中文操作和校验 ${entry.path} (#62)`, async ({ page }) => {
    await page.goto(entry.path)
    await expect(
      page.getByRole("heading", { name: entry.heading, exact: true }),
    ).toBeVisible()
    await page.getByRole("button", { name: entry.submit, exact: true }).click()
    await expect(page.getByText(entry.error, { exact: true })).toBeVisible()
  })
}

test("账号设置的资料、密码和删除确认使用中文 (#62)", async ({ page }) => {
  await openAccountForm(page, "admin")
  await page.goto("/settings")
  await expect(
    page.getByRole("heading", { name: "账号设置", exact: true }),
  ).toBeVisible()
  await page.getByRole("button", { name: "编辑", exact: true }).click()
  const name = page.getByRole("textbox", { name: "姓名", exact: true })
  await name.fill("长".repeat(31))
  await name.blur()
  await expect(
    page.getByText("姓名最多 30 个字符", { exact: true }),
  ).toBeVisible()
  await page.getByRole("textbox", { name: "邮箱", exact: true }).fill("invalid")
  await page.getByRole("textbox", { name: "邮箱", exact: true }).blur()
  await expect(
    page.getByText("请输入有效的邮箱地址", { exact: true }),
  ).toBeVisible()
  await page.getByRole("button", { name: "取消", exact: true }).click()
  await page.getByRole("tab", { name: "密码", exact: true }).click()
  await page.getByRole("button", { name: "更新密码", exact: true }).click()
  await expect(page.getByText("请填写密码", { exact: true })).toHaveCount(2)
  await page.getByRole("tab", { name: "危险操作", exact: true }).click()
  await page.getByRole("button", { name: "删除账号", exact: true }).click()
  await expect(page.getByRole("dialog")).toContainText("此操作无法撤销")
  await page.getByRole("button", { name: "取消", exact: true }).click()
})

test("用户管理的新增、编辑和删除操作使用中文 (#62)", async ({ page }) => {
  await openAccountForm(page, "admin")
  await expect(page.getByRole("dialog")).toContainText("新增用户")
  await expect(page.getByRole("checkbox", { name: "启用账号" })).toBeVisible()
  await page.getByRole("button", { name: "取消", exact: true }).click()
  await page.route("**/api/v1/users/?*", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: "other-user",
            email: "other@example.com",
            full_name: "合成用户",
            is_active: true,
            is_superuser: false,
          },
        ],
        count: 1,
      },
    }),
  )
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "用户管理", exact: true }),
  ).toBeVisible()
  const row = page.getByRole("row").filter({ hasText: "other@example.com" })
  await expect(row).toContainText("已启用")
  await row.getByRole("button").click()
  await page.getByRole("menuitem", { name: "编辑用户" }).click()
  await expect(page.getByRole("dialog").getByLabel("姓名")).toHaveValue(
    "合成用户",
  )
  await page.getByRole("button", { name: "取消", exact: true }).click()
  await expect(page.getByRole("dialog")).toBeHidden()
  await page.getByRole("menuitem", { name: "删除用户" }).click()
  await expect(page.getByRole("dialog")).toContainText("此操作无法撤销")
  await page.getByRole("button", { name: "取消", exact: true }).click()
})

test("认证服务错误显示中文说明 (#62)", async ({ page }) => {
  await page.route("**/api/v1/login/access-token", (route) =>
    route.fulfill({
      status: 400,
      json: { detail: "Incorrect email or password" },
    }),
  )
  await page.goto("/login")
  await page.getByTestId("email-input").fill("synthetic@example.com")
  await page.getByTestId("password-input").fill("Synthetic-password-123!")
  await page.getByRole("button", { name: "登录", exact: true }).click()
  await expect(page.getByText("邮箱或密码错误", { exact: true })).toBeVisible()
})
