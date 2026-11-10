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

test("the public homepage is English on desktop and mobile", async ({
  page,
}) => {
  await page.goto("/welcome")
  await expect(page.locator("html")).toHaveAttribute("lang", "en")
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Decode animal behavior, frame by frame.",
  )
  expect(await page.locator("body").innerText()).not.toMatch(/\p{Script=Han}/u)
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
