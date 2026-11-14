import { readFile } from "node:fs/promises"
import { expect, type Page, test } from "@playwright/test"

test.use({ storageState: { cookies: [], origins: [] } })

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) => route.abort())
  await page.emulateMedia({ reducedMotion: "reduce" })
})

async function reachQuestion(page: Page) {
  for (let step = 2; step <= 4; step++) {
    await page.getByRole("button", { name: "下一步" }).click()
    await expect(page.locator(".research-progress")).toContainText(
      `0${step} / 04`,
    )
  }
}

async function addScope(page: Page, scope: string) {
  const field = page.getByLabel("数据范围", { exact: true })
  if (!(await field.isVisible())) await page.locator("summary").click()
  await field.fill(scope)
}

test("the final desktop screen offers examples and optional scope", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/onboarding")
  await reachQuestion(page)
  await expect(
    page.getByRole("heading", { name: "你想探索什么？" }),
  ).toBeInViewport()
  await expect(page.getByLabel("研究问题", { exact: true })).toBeInViewport()
  await expect(page.getByLabel("研究问题", { exact: true })).toBeEmpty()
  await expect(
    page.getByRole("button", { name: "进入工作台", exact: true }),
  ).toBeInViewport()
  await expect(
    page.getByRole("link", { name: "直接进入工作台" }),
  ).toBeInViewport()
  await expect(
    page.getByRole("group", { name: "示例问题" }).getByRole("button"),
  ).toHaveCount(3)
  await expect(page.getByLabel("数据范围", { exact: true })).toBeHidden()
})

for (const [goal, expected] of [
  ["探索轨迹与朝向", "探索性图表"],
  ["比较训练日", "比较同批次内各训练日间的行为差异"],
  ["起草研究报告", "可编辑报告"],
]) {
  test(`${goal}: saves and restores the question and optional scope`, async ({
    page,
  }) => {
    await page.goto("/onboarding")
    await reachQuestion(page)
    await page.getByRole("button", { name: goal, exact: true }).click()
    await expect(page.getByLabel("研究问题", { exact: true })).toHaveValue(
      new RegExp(expected),
    )
    await addScope(page, "同一批次第 1–5 天")
    await page.getByRole("button", { name: "进入工作台", exact: true }).click()
    await expect(page).not.toHaveURL(/\/onboarding$/)
    await page.goto("/onboarding")
    await reachQuestion(page)
    await expect(page.getByLabel("研究问题", { exact: true })).toHaveValue(
      new RegExp(expected),
    )
    await expect(page.getByLabel("数据范围", { exact: true })).toHaveValue(
      "同一批次第 1–5 天",
    )
  })
}

test("a custom question needs no example or scope", async ({ page }) => {
  await page.goto("/onboarding")
  await reachQuestion(page)
  await page
    .getByLabel("研究问题", { exact: true })
    .fill("先核对轨迹缺失的情况。")
  await page.getByRole("button", { name: "进入工作台", exact: true }).click()
  await expect(page).not.toHaveURL(/\/onboarding$/)
  await page.goto("/onboarding")
  await reachQuestion(page)
  await expect(page.getByLabel("研究问题", { exact: true })).toHaveValue(
    "先核对轨迹缺失的情况。",
  )
  await expect(page.getByLabel("数据范围", { exact: true })).toBeHidden()
})

test("switching examples keeps the scope and does not submit a task", async ({
  page,
}) => {
  const requests: string[] = []
  page.on("request", (request) => {
    if (request.url().includes("/api/")) requests.push(request.url())
  })
  await page.goto("/onboarding")
  await reachQuestion(page)
  await page
    .getByRole("button", {
      name: "探索轨迹与朝向",
      exact: true,
    })
    .click()
  await addScope(page, "第二批训练视频")
  await page.getByRole("button", { name: "起草研究报告", exact: true }).click()
  await expect(page.getByLabel("研究问题", { exact: true })).toHaveValue(
    /可编辑报告/,
  )
  await expect(page.getByLabel("数据范围", { exact: true })).toHaveValue(
    "第二批训练视频",
  )
  await expect(
    page.getByRole("button", { name: "起草研究报告", exact: true }),
  ).toHaveAttribute("aria-pressed", "true")
  expect(requests).toEqual([])
})

test("empty input and blocked storage preserve the recovery download", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (this === window.sessionStorage)
        throw new DOMException("blocked", "SecurityError")
      return original.call(this, key, value)
    }
  })
  await page.goto("/onboarding")
  await reachQuestion(page)
  const question = page.getByLabel("研究问题", { exact: true })
  await question.fill("   ")
  await expect(
    page.getByRole("button", { name: "进入工作台", exact: true }),
  ).toBeDisabled()
  await question.fill("先检查轨迹缺失情况。")
  await addScope(page, "同一批训练视频")
  await page.getByRole("button", { name: "进入工作台", exact: true }).click()
  await expect(page.getByRole("alert")).toContainText("浏览器未能保存你的问题")
  await expect(question).toHaveValue("先检查轨迹缺失情况。")
  await expect(page).toHaveURL(/\/onboarding$/)
  const downloaded = page.waitForEvent("download")
  await page.getByRole("button", { name: "下载研究简报" }).click()
  const download = await downloaded
  const content = await readFile((await download.path())!, "utf8")
  expect(content).toContain("同一批训练视频")
  expect(content).toContain("先检查轨迹缺失情况")
  expect(content).toContain("缺少空间标定不报告厘米单位")
})

test("keyboard selection works with invalid saved data", async ({ page }) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("lingsight.research-brief.v1", '{"version":999}'),
  )
  await page.goto("/onboarding")
  await reachQuestion(page)
  await expect(page.getByLabel("研究问题", { exact: true })).toBeEmpty()
  await page.getByRole("button", { name: "比较训练日", exact: true }).focus()
  await page.keyboard.press("Enter")
  await expect(page.getByLabel("研究问题", { exact: true })).toHaveValue(
    /同批次/,
  )
})

test("entering without a question marks onboarding seen without saving a brief", async ({
  page,
}) => {
  await page.goto("/onboarding")
  await page.getByRole("link", { name: "直接进入工作台", exact: true }).click()
  await expect(page).not.toHaveURL(/\/onboarding$/)
  expect(
    await page.evaluate(() =>
      localStorage.getItem("lingsight.onboarding-seen.v1"),
    ),
  ).toBe("1")
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("lingsight.research-brief.v1"),
    ),
  ).toBeNull()
})

test("a long question scrolls inside its editor", async ({ page }) => {
  await page.goto("/onboarding")
  await reachQuestion(page)
  const question = page.getByLabel("研究问题", { exact: true })
  await question.fill("逐视频核对轨迹与缺失值。\n".repeat(80))
  await question.evaluate((element) => {
    element.scrollTop = 0
  })
  await question.hover()
  await page.mouse.wheel(0, 500)
  await expect
    .poll(() => question.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0)
  await expect(
    page.getByRole("button", { name: "进入工作台", exact: true }),
  ).toBeInViewport()
})

test("the guide types its introduction and shows completed text when revisiting", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.goto("/onboarding")
  const intro = page
    .locator(".research-guide-scene")
    .first()
    .locator(".research-typewriter-ink")
  await expect(intro).toHaveAttribute("data-typing", "true")
  await expect
    .poll(() => intro.locator('[data-visible="true"]').count())
    .toBeGreaterThan(0)
  await page.getByRole("button", { name: "下一步" }).click()
  await expect(page.locator(".research-progress")).toContainText("02 / 04")
  await page.getByRole("button", { name: "上一步" }).click()
  await expect(page.locator(".research-progress")).toContainText("01 / 04")
  await expect(intro).toHaveAttribute("data-typing", "false")
})

test("the mouse wheel advances one scene at a time and can go back", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/onboarding")
  // Wait for the rendered guide before dispatching a native wheel event;
  // goto alone can finish before Vite has mounted React and its listeners.
  await expect(page.locator(".research-progress")).toContainText("01 / 04")
  await page
    .locator(".research-guide-main")
    .hover({ position: { x: 20, y: 20 } })
  await page.clock.install()
  for (const next of [2, 3, 4]) {
    await page.mouse.wheel(0, 120)
    await expect(page.locator(".research-progress")).toContainText(
      `0${next} / 04`,
    )
    // Advance the real gesture cooldown deterministically, without sleeping.
    await page.clock.fastForward(900)
  }
  await page.mouse.wheel(0, -120)
  await expect(page.locator(".research-progress")).toContainText("03 / 04")
})

test("every introduction scene is Chinese and fits a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/onboarding")
  await expect(page.locator(".research-onboarding")).toHaveAttribute(
    "lang",
    "zh",
  )
  for (let step = 1; step <= 4; step++) {
    await expect(page.locator(".research-progress")).toContainText(
      `0${step} / 04`,
    )
    const scene = page.locator(".research-guide-scene").nth(step - 1)
    await expect(scene.locator(".research-scene-content")).toHaveClass(
      /is-ready/,
    )
    expect(await scene.textContent()).toMatch(/\p{Script=Han}/u)
    expect(
      await scene.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true)
    if (step < 4) await page.getByRole("button", { name: "下一步" }).click()
  }
  await expect(page.getByRole("button", { name: "进入工作台" })).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})

test("typing leaves time to read and reduced motion reveals the full text immediately", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.clock.install({ time: new Date("2026-11-11T00:00:00Z") })
  await page.clock.pauseAt(new Date("2026-11-11T00:00:01Z"))
  await page.goto("/onboarding")
  const scene = page.locator(".research-guide-scene").first()
  const ink = scene.locator(".research-typewriter-ink")
  await expect(ink).toHaveAttribute("data-typing", "true")
  await page.clock.runFor(2000)
  await expect(ink).toHaveAttribute("data-typing", "true")
  expect(await ink.locator('[data-visible="true"]').count()).toBeGreaterThan(0)
  await expect(scene.locator(".research-scene-support")).toBeHidden()
  await page.emulateMedia({ reducedMotion: "reduce" })
  await expect(ink).toHaveAttribute("data-typing", "false")
  await expect(scene.locator(".research-scene-support")).toBeVisible()
  await expect(ink).toHaveText("你好，\n我是你的科研助手。")
})

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`characters fade in without shifting while typing at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: "no-preference" })
    await page.goto("/onboarding")
    const ink = page
      .locator(".research-guide-scene")
      .first()
      .locator(".research-typewriter-ink")
    await expect(ink).toHaveAttribute("data-typing", "true")
    const samples = await ink.evaluate(
      (element) =>
        new Promise<{ opacity: number; x: number; y: number }[]>((resolve) => {
          const character = Array.from(
            element.querySelectorAll<HTMLElement>(".research-typewriter-glyph"),
          ).find((glyph) => glyph.textContent === "你")!
          const started = performance.now()
          const frames: { opacity: number; x: number; y: number }[] = []
          function sample(now: number) {
            if (character.dataset.visible === "true") {
              const bounds = character.getBoundingClientRect()
              frames.push({
                opacity: Number(getComputedStyle(character).opacity),
                x: bounds.x,
                y: bounds.y,
              })
            }
            if (now - started >= 2600) resolve(frames)
            else requestAnimationFrame(sample)
          }
          requestAnimationFrame(sample)
        }),
    )
    expect(samples.length).toBeGreaterThan(10)
    expect(
      samples.some((frame) => frame.opacity > 0 && frame.opacity < 1),
    ).toBe(true)
    expect(
      Math.max(...samples.map((frame) => frame.x)) -
        Math.min(...samples.map((frame) => frame.x)),
    ).toBeLessThan(0.5)
    expect(
      Math.max(...samples.map((frame) => frame.y)) -
        Math.min(...samples.map((frame) => frame.y)),
    ).toBeLessThan(0.5)
    await expect(ink).toHaveAttribute("data-typing", "false")
  })
}
