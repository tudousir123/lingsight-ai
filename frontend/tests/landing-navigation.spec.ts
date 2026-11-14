import { expect, test } from "@playwright/test"

test.use({ storageState: { cookies: [], origins: [] } })

test("refreshing the model section returns to the homepage hero", async ({
  page,
}) => {
  await page.goto("/welcome?source=preview#ethos")
  await expect(
    page.getByRole("heading", { name: "ETHOS", exact: true }),
  ).toBeInViewport()

  await page.reload()

  await expect(page).toHaveURL(/\/welcome\?source=preview$/)
  await expect(page.getByRole("heading", { level: 1 })).toBeInViewport()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)

  await page.getByRole("link", { name: /MEET ETHOS/ }).click()
  await expect(
    page.getByRole("heading", { name: "ETHOS", exact: true }),
  ).toBeInViewport()
  await expect(page).toHaveURL(/#ethos$/)
})

test("refreshing after manual scrolling returns to the homepage hero", async ({
  page,
}) => {
  await page.goto("/welcome")
  await page.locator("#ethos").scrollIntoViewIfNeeded()
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(0)

  await page.reload()

  await expect(page.getByRole("heading", { level: 1 })).toBeInViewport()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
})

test("the public homepage switches languages on desktop and mobile", async ({
  page,
}) => {
  await page.goto("/welcome")
  await expect(page.locator("html")).toHaveAttribute("lang", "en")
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(
    "Decode animal behavior, frame by frame.",
  )
  await expect(page.locator(".landing")).toHaveAttribute("lang", "en")
  expect(await page.locator("main").textContent()).not.toMatch(
    /\p{Script=Han}/u,
  )
  await page
    .getByRole("button", {
      name: "切换到中文 / Switch to Chinese",
      exact: true,
    })
    .click()
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN")
  await expect(page.locator(".landing")).toHaveAttribute("lang", "zh")
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(
    "逐帧解码动物行为。",
  )
  await page.reload()
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN")
  await expect(page.locator(".landing")).toHaveAttribute("lang", "zh")
  await page.locator(".lang-toggle").click()
  await expect(page.locator("html")).toHaveAttribute("lang", "en")
  await expect(page.locator(".landing")).toHaveAttribute("lang", "en")
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(
    page
      .locator(".hero-buttons")
      .getByRole("link", { name: "Get started", exact: true }),
  ).toBeInViewport()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})

test("the public homepage remains usable when browser storage is blocked", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("storage blocked")
    }
    Storage.prototype.setItem = () => {
      throw new Error("storage blocked")
    }
  })
  await page.goto("/welcome")
  await expect(page.locator("html")).toHaveAttribute("lang", "en")
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(
    "Decode animal behavior, frame by frame.",
  )
  await expect(page.locator("#assistant .example-caption")).toHaveText(
    "Illustrative examples · synthetic data",
  )
  await page.locator(".lang-toggle").click()
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN")
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(
    "逐帧解码动物行为。",
  )
  await expect(page.locator("#assistant .example-caption")).toHaveText(
    "功能演示 · 合成示例数据",
  )
})

test("auth routes loaded directly inherit the document language zh-CN", async ({
  page,
}) => {
  for (const path of ["/login", "/signup", "/recover-password"]) {
    await page.goto(path)
    await expect(page.getByRole("heading").first()).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN")
  }
})
