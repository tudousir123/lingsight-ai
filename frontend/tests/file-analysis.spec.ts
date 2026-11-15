import { expect, test } from "@playwright/test"
import { personalAgentFixture } from "./utils/personalAgentApi"
import { stubProjectsApi } from "./utils/projectsApi"

test.use({ storageState: { cookies: [], origins: [] } })
test("workspace uploads small authorized content and sends only opaque server refs", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "synthetic-token")
    localStorage.setItem("lingsight.onboarding-seen.v1", "1")
  })
  stubProjectsApi(page)
  await page.route("**/api/v1/users/me", (route) =>
    route.fulfill({
      json: {
        id: "user",
        email: "synthetic@example.com",
        is_active: true,
        is_superuser: false,
      },
    }),
  )
  let uploaded: unknown
  let created: unknown
  const id = "11111111-1111-4111-8111-111111111111"
  await page.route("**/api/v1/agent/**", async (route) => {
    const path = new URL(route.request().url()).pathname.split("/agent/")[1]
    if (path === "capabilities")
      return route.fulfill({
        json: {
          files: "controlled-files-v1",
          execution: {
            contract: "durable-run-v1",
            engine: "pi-durable",
            version: "1.5.2",
            enabled: true,
          },
        },
      })
    if (path === "personal-agent")
      return route.fulfill({ json: personalAgentFixture })
    if (path === "inputs") {
      uploaded = route.request().postDataJSON()
      return route.fulfill({
        status: 201,
        json: {
          id,
          name: "observations.csv",
          sha256: "a".repeat(64),
          bytes: 8,
        },
      })
    }
    if (path === "tasks" && route.request().method() === "POST") {
      created = route.request().postDataJSON()
      return route.fulfill({
        status: 503,
        json: { detail: "Synthetic stop after capturing intent" },
      })
    }
    return route.fulfill({ json: [] })
  })
  await page.goto("/")
  await page.getByLabel("授权分析文件").setInputFiles({
    name: "observations.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("x\n1\n"),
  })
  await expect(
    page.getByText("observations.csv", { exact: true }),
  ).toBeVisible()
  await expect(page.getByText(`SHA-256：${"a".repeat(64)}`)).toBeVisible()
  await page
    .getByRole("textbox", { name: "研究问题" })
    .fill("Create a synthetic report")
  await page.getByRole("button", { name: "发送研究问题", exact: true }).click()
  await expect
    .poll(() => created)
    .toEqual({ goal: "Create a synthetic report", input_ids: [id] })
  expect(uploaded).toEqual({ name: "observations.csv", content: "x\n1\n" })
  await expect(page.getByRole("textbox", { name: "研究问题" })).toHaveValue(
    "Create a synthetic report",
  )
})
