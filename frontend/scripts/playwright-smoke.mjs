import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { chromium } from "@playwright/test"

// Use the runner's default executable, just like the Chromium E2E project.
// Do not install a browser here: a drifting base image must fail this check.
const require = createRequire(import.meta.url)
const runnerVersion = require("@playwright/test/package.json").version
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.setContent(
    '<button type="button" onclick="this.textContent=\'Ready\'">Start</button>',
  )
  await page.getByRole("button", { name: "Start", exact: true }).click()
  assert.equal(
    await page.getByRole("button", { name: "Ready", exact: true }).count(),
    1,
  )
  const image = process.env.PLAYWRIGHT_DOCKER_IMAGE
  assert.ok(image, "Run this smoke check inside the official Playwright image")
  assert.equal(
    image.match(/:v(\d+\.\d+\.\d+)-/)?.[1],
    runnerVersion,
    `The image ${image} must match the installed Playwright runner`,
  )
  console.log(
    `Playwright ${runnerVersion}: Chromium ${browser.version()} launched and interacted successfully (Node ${process.version}, image ${image}).`,
  )
} finally {
  await browser.close()
}
