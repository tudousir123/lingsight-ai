import { expect, test } from "@playwright/test"
import { stubProjectsApi } from "./utils/projectsApi"

test.use({ storageState: { cookies: [], origins: [] } })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "settings-validation-test")
    localStorage.setItem("lingsight.onboarding-seen.v1", "1")
  })
  await page.route("**/api/v1/users/me", (route) =>
    route.fulfill({
      json: {
        id: "settings-user",
        email: "settings@example.com",
        full_name: "Settings Researcher",
        is_active: true,
        is_superuser: false,
      },
    }),
  )
  stubProjectsApi(page, [])
  await page.route("**/api/v1/agent/tasks", (route) =>
    route.fulfill({ json: [] }),
  )
})

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
]) {
  for (const invalidEmail of ["", "not-an-email"]) {
    test(`profile email validates on blur and clears the error after correction (${viewport.width}px, ${invalidEmail || "empty"})`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await page.goto("/settings")
      await page.getByRole("button", { name: "Edit", exact: true }).click()
      const email = page.getByRole("textbox", { name: "Email", exact: true })
      await email.fill(invalidEmail)
      await expect(email).toBeFocused()
      await email.press("Tab")
      await expect(email).not.toBeFocused()
      const error = page.getByText("Invalid email address", { exact: true })
      await expect(error).toBeVisible()
      await expect(email).toHaveAttribute("aria-invalid", "true")
      await email.fill("corrected@example.com")
      await email.press("Tab")
      await expect(email).not.toBeFocused()
      await expect(error).toBeHidden()
      await expect(email).toHaveAttribute("aria-invalid", "false")
    })
  }
}
