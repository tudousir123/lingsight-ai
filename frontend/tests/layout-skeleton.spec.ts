import { expect, type Page, test } from "@playwright/test"
import {
  mockLayoutWorkspace,
  openTestVideo,
  recordTestVideo,
} from "./utils/layoutWorkspace"

test.use({ storageState: { cookies: [], origins: [] } })

const manyProjects = Array.from({ length: 14 }, (_, index) => ({
  id: `p${index + 1}`,
  name: `水迷宫第 ${index + 1} 批`,
  members: [],
}))

async function inViewport(page: Page, locator: ReturnType<Page["locator"]>) {
  await expect(locator).toBeVisible()
  await expect(locator).toBeInViewport({ ratio: 1 })
  const box = await locator.boundingBox()
  const viewport = page.viewportSize()
  if (!box || !viewport) throw new Error("Missing geometry")
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
}

for (const height of [720, 800]) {
  test(`1280×${height}：侧栏「项目」区与新建入口始终可见，列表在内部滚动`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height })
    await mockLayoutWorkspace(page, { projects: manyProjects })
    await page.goto("/experiments")
    const sidebar = page.locator('[data-sidebar="sidebar"]')
    await inViewport(page, sidebar.getByRole("heading", { name: "项目" }))
    await inViewport(page, sidebar.getByRole("button", { name: "新建项目" }))
    await expect(
      sidebar.getByRole("link", { name: "水迷宫第 1 批" }),
    ).toBeVisible()
    // 最近任务可压缩，但不能把「项目」挤没；多出的项目在自己的列表里滚动。
    const list = sidebar.locator(".research-project-list")
    expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
      true,
    )
    await sidebar.getByRole("button", { name: "新建项目" }).click()
    await expect(page.getByRole("dialog", { name: "新建项目" })).toBeVisible()
  })
}

test("768×1024：侧栏默认折叠为抽屉，可打开；实验表格可横向滚动并有提示", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await mockLayoutWorkspace(page)
  await page.goto("/experiments")
  await expect(
    page.getByRole("heading", { name: "实验与视频管理" }),
  ).toBeVisible()
  await expect(page.locator('[data-sidebar="sidebar"]')).toHaveCount(0)
  await expect(page.getByRole("link", { name: "视频推理" })).toHaveCount(0)
  const main = await page.locator('[data-slot="sidebar-inset"]').boundingBox()
  expect(main?.x).toBeLessThanOrEqual(1)
  expect(main?.width).toBeGreaterThanOrEqual(767)

  const scroller = page.locator('[data-slot="table-container"]')
  await expect(page.locator('[data-slot="table-scroll-hint"]')).toBeVisible()
  expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true,
  )
  await scroller.evaluate((el) => {
    el.scrollLeft = el.scrollWidth
  })
  await expect(page.locator('[data-slot="table-scroll-shadow"]')).toHaveCount(0)

  await page.locator("[data-sidebar=trigger]").click()
  await expect(page.getByRole("link", { name: "视频推理" })).toBeVisible()
  await page.getByRole("link", { name: "视频推理" }).click()
  await expect(page).toHaveURL(/\/inference/)
  await expect(page.locator('[data-sidebar="sidebar"]')).toHaveCount(0)
})

for (const [width, height] of [
  [1280, 800],
  [1280, 720],
  [1440, 900],
] as const) {
  test(`${width}×${height}：标注页播放控件与时间轴在首屏内，紧贴画布下方`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height })
    await mockLayoutWorkspace(page)
    await page.goto("/annotations")
    await expect(page.getByLabel("选择本地标注视频")).toBeAttached()
    await openTestVideo(page, await recordTestVideo(page))
    await expect(page.getByLabel("标注视频", { exact: true })).toBeVisible()
    await expect(page.locator(".annotation-hit")).toBeVisible()

    const play = page.getByRole("button", { name: "播放" })
    const slider = page.locator(".annotation-transport input[type=range]")
    await inViewport(page, play)
    await inViewport(page, slider)
    await inViewport(page, page.locator(".annotation-time"))
    const stage = await page.locator(".annotation-stage").boundingBox()
    const bar = await page.locator(".annotation-transport").boundingBox()
    if (!stage || !bar) throw new Error("Missing geometry")
    expect(bar.y - (stage.y + stage.height)).toBeLessThanOrEqual(1)
    expect(stage.height).toBeGreaterThanOrEqual(240)
  })
}

test("侧栏「视频推理」入口紧随「视频与标注」并导航到推理页", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockLayoutWorkspace(page)
  await page.goto("/")
  const nav = page.getByRole("navigation", { name: "科研工作区导航" })
  await expect(nav.getByRole("link", { name: "视频与标注" })).toBeVisible()
  const labels = (await nav.getByRole("link").allInnerTexts()).map((text) =>
    text.trim(),
  )
  expect(labels.indexOf("视频推理")).toBe(labels.indexOf("视频与标注") + 1)
  await nav.getByRole("link", { name: "视频推理" }).click()
  await expect(page).toHaveURL(/\/inference$/)
  await expect(
    page.getByRole("heading", { level: 1, name: "视频推理" }),
  ).toBeVisible()
  await expect(nav.getByRole("link", { name: "视频推理" })).toHaveAttribute(
    "aria-current",
    "page",
  )
})

test("各页共用同一页面骨架：h1 字号字重、内容左边界、主区最小字号", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockLayoutWorkspace(page)
  const measured: Record<
    string,
    { size: string; weight: string; left: number }
  > = {}
  for (const path of [
    "/experiments",
    "/annotations",
    "/analysis",
    "/inference",
    "/settings",
    "/projects/p1?view=details",
  ]) {
    await page.goto(path)
    const h1 = page.locator("h1:visible").first()
    await expect(h1).toBeVisible({ timeout: 15_000 })
    measured[path] = await h1.evaluate((el) => {
      const style = getComputedStyle(el)
      return {
        size: style.fontSize,
        weight: style.fontWeight,
        left: Math.round(el.getBoundingClientRect().left),
      }
    })
    const smallest = await page.evaluate(() => {
      const inset = document.querySelector('[data-slot="sidebar-inset"]')
      if (!inset) return 99
      const walker = document.createTreeWalker(inset, NodeFilter.SHOW_TEXT)
      let min = 99
      while (walker.nextNode()) {
        const parent = walker.currentNode.parentElement
        if (!parent || !walker.currentNode.textContent?.trim()) continue
        if (parent.closest("svg, script, style")) continue
        const rect = parent.getBoundingClientRect()
        if (!rect.width || !rect.height) continue
        min = Math.min(
          min,
          Number.parseFloat(getComputedStyle(parent).fontSize),
        )
      }
      return min
    })
    expect(smallest, `${path} 主区最小字号`).toBeGreaterThanOrEqual(12)
  }
  const values = Object.values(measured)
  expect(new Set(values.map((value) => value.size))).toEqual(new Set(["24px"]))
  expect(new Set(values.map((value) => value.weight))).toEqual(new Set(["600"]))
  expect(new Set(values.map((value) => value.left)).size).toBe(1)
})
