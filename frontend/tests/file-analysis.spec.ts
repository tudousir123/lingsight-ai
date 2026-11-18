import { expect, test } from "@playwright/test"
import {
  agentExecutionContract,
  agentFilesContract,
} from "../src/lib/upstreamRoutes.gen"
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
  const intents: unknown[] = []
  const id = "11111111-1111-4111-8111-111111111111"
  await page.route("**/api/v1/agent/**", async (route) => {
    const path = new URL(route.request().url()).pathname.split("/agent/")[1]
    if (path === "capabilities")
      return route.fulfill({
        json: {
          files: agentFilesContract,
          execution: {
            contract: agentExecutionContract.contract,
            engine: agentExecutionContract.engine,
            version: agentExecutionContract.version,
            requests: agentExecutionContract.requests,
            recovery: agentExecutionContract.recovery,
            operations: agentExecutionContract.operations,
            cancellation: agentExecutionContract.cancellation,
            enabled: true,
          },
        },
      })
    if (path === "personal-agent")
      return route.fulfill({ json: personalAgentFixture })
    if (path === "inputs" && route.request().method() === "GET")
      return route.fulfill({
        json: [
          { id, name: "observations.csv", sha256: "a".repeat(64), bytes: 8 },
        ],
      })
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
      intents.push(created)
      return route.fulfill({
        status: 503,
        json: { detail: "Synthetic stop after capturing intent" },
      })
    }
    return route.fulfill({ json: [] })
  })
  await page.goto("/")
  const fileInput = page.getByLabel("授权分析文件")
  await expect(fileInput).toBeEnabled()
  await fileInput.setInputFiles({
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
    .toMatchObject({ goal: "Create a synthetic report", input_ids: [id] })
  const first = created
  await page.reload()
  await expect(
    page.getByText("observations.csv", { exact: true }),
  ).toBeVisible()
  await page.getByRole("button", { name: "发送研究问题", exact: true }).click()
  await expect.poll(() => intents.length).toBe(2)
  expect(intents[1]).toEqual(first)
  expect(uploaded).toEqual({ name: "observations.csv", content: "x\n1\n" })
  await expect(page.getByRole("textbox", { name: "研究问题" })).toHaveValue(
    "Create a synthetic report",
  )
})

test("legacy file capability blocks file-task continuation and recovery but preserves material preview", async ({
  page,
}) => {
  const id = "11111111-1111-4111-8111-111111111111"
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
  const task = {
    id,
    title: "Synthetic file task",
    goal: "Synthetic file task",
    personal_agent_id: personalAgentFixture.id,
    environment_id: personalAgentFixture.environment.id,
    runs: [
      {
        id,
        instruction: "Create synthetic report",
        status: "failed",
        error: "Synthetic failure",
      },
    ],
    artifacts: [
      {
        id,
        run_id: id,
        name: "material.csv",
        kind: "input",
        sha256: "a".repeat(64),
        bytes: 4,
      },
    ],
  }
  await page.route("**/api/v1/agent/**", (route) => {
    const path = new URL(route.request().url()).pathname.split("/agent/")[1]
    if (path === "capabilities")
      return route.fulfill({
        json: {
          execution: {
            contract: agentExecutionContract.contract,
            engine: agentExecutionContract.engine,
            version: agentExecutionContract.version,
            requests: agentExecutionContract.requests,
            recovery: agentExecutionContract.recovery,
            operations: agentExecutionContract.operations,
            cancellation: agentExecutionContract.cancellation,
            enabled: true,
          },
        },
      })
    if (path === "personal-agent")
      return route.fulfill({ json: personalAgentFixture })
    if (path === `tasks/${id}`) return route.fulfill({ json: task })
    if (path === `artifacts/${id}`)
      return route.fulfill({ body: "x\n1\n", contentType: "text/csv" })
    return route.fulfill({ json: [] })
  })
  await page.goto(`/tasks/${id}`)
  await page
    .getByRole("textbox", { name: "研究问题" })
    .fill("Revise synthetic report")
  await expect(
    page.getByRole("button", { name: "发送研究问题", exact: true }),
  ).toBeDisabled()
  await expect(
    page.getByRole("button", { name: "从已保存的材料恢复" }),
  ).toBeDisabled()
  await page.getByRole("button", { name: /material.csv/ }).click()
  await expect(page.getByRole("dialog")).toContainText("材料仅供核查")
  await expect(page.getByRole("dialog").locator("pre")).toHaveText("x\n1\n")
})
