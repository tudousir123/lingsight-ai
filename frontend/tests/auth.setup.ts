import { test as setup } from "@playwright/test"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"

const authFile = "playwright/.auth/user.json"

setup("authenticate", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("lingsight.onboarding-seen.v1", "1"),
  )
  await page.goto("/login")
  await page.getByTestId("email-input").fill(firstSuperuser)
  await page.getByTestId("password-input").fill(firstSuperuserPassword)
  await page.getByRole("button", { name: "登录" }).click()
  await page.waitForURL(
    (url) => url.pathname === "/" || url.pathname === "/onboarding",
  )
  await page.context().storageState({ path: authFile })
})
