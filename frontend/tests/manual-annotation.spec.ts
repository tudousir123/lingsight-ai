import { readFile } from "node:fs/promises"
import { expect, test } from "@playwright/test"

test.use({ storageState: { cookies: [], origins: [] } })

test("同一工作台能绘制、编辑、恢复和导出本帧与整段标注", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "annotation-test")
  })
  await page.route("**/api/v1/users/me", (route) =>
    route.fulfill({
      json: {
        id: "annotator",
        email: "annotator@example.com",
        is_active: true,
      },
    }),
  )
  await page.route("**/api/v1/agent/tasks", (route) =>
    route.fulfill({ json: [] }),
  )
  await page.route("**/api/v1/projects", (route) =>
    route.fulfill({ json: { data: [], count: 0 } }),
  )
  await page.route("**/api/v1/experiments", (route) =>
    route.fulfill({ json: { data: [], count: 0 } }),
  )
  await page.goto("/annotations")
  await expect(page.getByRole("tab", { name: "手动标注" })).toHaveAttribute(
    "aria-selected",
    "true",
  )

  const webm = await page.evaluate(async () => {
    const canvas = document.createElement("canvas")
    canvas.width = 80
    canvas.height = 48
    const context = canvas.getContext("2d")!
    const stream = canvas.captureStream(10)
    const recorder = new MediaRecorder(stream, {
      mimeType: "video/webm;codecs=vp8",
    })
    const chunks: Blob[] = []
    recorder.ondataavailable = (event) => chunks.push(event.data)
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
    })
    recorder.start()
    let x = 1
    const paint = () => {
      context.fillStyle = "#18212b"
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = "#fff"
      context.fillRect(x++, 20, 8, 4)
    }
    paint()
    const clock = window.setInterval(paint, 100)
    await new Promise((resolve) => window.setTimeout(resolve, 520))
    window.clearInterval(clock)
    recorder.stop()
    await stopped
    for (const track of stream.getTracks()) track.stop()
    const blob = new Blob(chunks, { type: "video/webm" })
    return Array.from(new Uint8Array(await blob.arrayBuffer()))
  })

  async function openVideo() {
    await page.getByLabel("选择本地标注视频").evaluate((input, bytes) => {
      const data = new DataTransfer()
      data.items.add(
        new File([new Uint8Array(bytes)], "trial.webm", {
          type: "video/webm",
          lastModified: 1234,
        }),
      )
      if (!(input instanceof HTMLInputElement))
        throw new Error("Missing video input")
      input.files = data.files
      input.dispatchEvent(new Event("change", { bubbles: true }))
    }, webm)
  }

  await openVideo()
  const fps = page.getByRole("spinbutton", { name: "帧率（FPS）" })
  await fps.fill("10")
  await fps.press("Enter")
  const target = page.getByLabel("标注对象")
  const list = page.getByRole("list", { name: "标注列表" })
  const head = page.getByRole("button", { name: "画面标注：头点" })
  await expect(head).toBeEnabled()
  await head.click({ position: { x: 140, y: 110 } })
  await expect(
    page.getByRole("button", { name: "第 1 帧 1 个点" }),
  ).toBeVisible()
  await target.selectOption("tail")
  await page.getByRole("button", { name: "画面标注：尾点" }).press("Enter")
  await expect(
    page.getByRole("button", { name: "第 1 帧 2 个点" }),
  ).toBeVisible()
  await page.getByRole("button", { name: "撤销" }).click()
  await expect(
    page.getByRole("button", { name: "第 1 帧 1 个点" }),
  ).toBeVisible()
  await page.getByRole("button", { name: "下一帧" }).click()
  await expect(page.locator(".annotation-time")).toContainText("第 2 帧")
  await target.selectOption("center")
  await page.getByRole("button", { name: "画面标注：质心" }).press("Enter")
  await expect(
    page.getByRole("button", { name: "第 2 帧 1 个点" }),
  ).toBeVisible()

  await target.selectOption("pentacle")
  const drawMark = page.getByRole("button", { name: "绘制Mark", exact: true })
  await drawMark.click({ position: { x: 42, y: 40 } })
  await drawMark.click({ position: { x: 95, y: 40 } })
  await drawMark.press("Escape")
  await expect(page.getByRole("button", { name: "取消绘制" })).toHaveCount(0)
  await drawMark.click({ position: { x: 45, y: 48 } })
  await drawMark.hover({ position: { x: 95, y: 48 } })
  await expect(page.locator(".scene-preview polyline")).toHaveAttribute(
    "points",
    /^\d+,\d+ \d+,\d+$/,
  )
  await drawMark.click({ position: { x: 95, y: 48 } })
  await drawMark.click({ position: { x: 70, y: 100 } })
  await drawMark.hover({ position: { x: 49, y: 50 } })
  await expect(page.locator(".scene-vertex[data-snap]")).toBeVisible()
  await drawMark.click({ position: { x: 49, y: 50 } })
  await expect(
    page.getByRole("button", { name: "Mark · 五角星", exact: true }),
  ).toBeVisible()
  const vertex = page.locator(".scene-handle").first()
  const box = await vertex.boundingBox()
  if (!box) throw new Error("Missing edit vertex")
  const originalX = await vertex.getAttribute("cx")
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    box.x + box.width / 2 + 56,
    box.y + box.height / 2 + 10,
    { steps: 4 },
  )
  await page.mouse.up()
  expect(await vertex.getAttribute("cx")).not.toBe(originalX)
  await page.getByRole("button", { name: "隐藏Mark · 五角星" }).click()
  await expect(page.locator(".scene-overlay [data-kind=mark]")).toHaveCount(0)
  await page.getByRole("button", { name: "显示Mark · 五角星" }).click()
  await expect(page.locator(".scene-overlay [data-kind=mark]")).toHaveCount(1)
  await page.getByRole("button", { name: "放大画布" }).click()
  await expect(page.getByLabel("画布缩放")).toHaveText("135%")
  await page.getByRole("button", { name: "平移画布" }).click()
  const stage = page.locator(".annotation-stage")
  const stageBox = await stage.boundingBox()
  if (!stageBox) throw new Error("Missing canvas viewport")
  const frame = page.locator(".annotation-frame")
  const oldView = await frame.getAttribute("style")
  await page.mouse.move(
    stageBox.x + stageBox.width / 2,
    stageBox.y + stageBox.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    stageBox.x + stageBox.width / 2 + 65,
    stageBox.y + stageBox.height / 2 + 25,
    { steps: 4 },
  )
  await page.mouse.up()
  expect(await frame.getAttribute("style")).not.toBe(oldView)
  await page.getByRole("button", { name: "适应画面" }).click()
  await expect(page.getByLabel("画布缩放")).toHaveText("100%")
  await target.selectOption("platform")
  const drawPlatform = page.getByRole("button", {
    name: "绘制平台",
    exact: true,
  })
  await drawPlatform.click({ position: { x: 179, y: 127 } })
  await drawPlatform.click({ position: { x: 199, y: 127 } })
  await expect(page.getByRole("button", { name: "删除标注" })).toBeEnabled()
  await page.getByRole("button", { name: "删除标注" }).click()
  await expect(page.locator(".scene-overlay [data-kind=platform]")).toHaveCount(
    0,
  )
  await page.getByRole("button", { name: "撤销" }).click()
  await expect(page.locator(".scene-overlay [data-kind=platform]")).toHaveCount(
    1,
  )
  await target.selectOption("pool")
  const drawPool = page.getByRole("button", {
    name: "绘制水池边缘",
    exact: true,
  })
  await expect(page.getByLabel("定圆方式")).toHaveValue("rim")
  await drawPool.click({ position: { x: 220, y: 178 } })
  await drawPool.click({ position: { x: 300, y: 178 } })
  await drawPool.click({ position: { x: 380, y: 178 } })
  await expect(
    page.getByRole("alert").filter({ hasText: "不能在一条直线上" }),
  ).toBeVisible()
  await drawPool.hover({ position: { x: 300, y: 249 } })
  await expect(
    page.locator(".scene-preview circle:not(.scene-vertex)"),
  ).toBeVisible()
  await drawPool.click({ position: { x: 300, y: 249 } })
  await expect(list.getByRole("listitem")).toHaveCount(4)
  const centerItem = list.getByRole("button", { name: "质心", exact: true })
  await expect(centerItem).toContainText("本帧")
  await expect(
    list.getByRole("button", { name: "水池边缘", exact: true }),
  ).toContainText("整段")
  const centerPoint = page.locator(
    ".scene-overlay [data-label=center] .annotation-point",
  )
  await expect(centerPoint).toBeVisible()
  await centerItem.click()
  await expect(
    page.getByRole("button", { name: "选择", exact: true }),
  ).toHaveAttribute("aria-pressed", "true")
  const pointBox = await centerPoint.boundingBox()
  if (!pointBox) throw new Error("Missing point on canvas")
  const oldX = await centerPoint.getAttribute("cx")
  await page.mouse.move(
    pointBox.x + pointBox.width / 2,
    pointBox.y + pointBox.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    pointBox.x + pointBox.width / 2 + 28,
    pointBox.y + pointBox.height / 2 + 6,
  )
  await page.mouse.up()
  expect(await centerPoint.getAttribute("cx")).not.toBe(oldX)
  await page.getByRole("button", { name: "撤销" }).click()
  await expect(centerPoint).toHaveAttribute("cx", oldX!)
  await page.getByRole("button", { name: "删除标注" }).click()
  await expect(centerItem).toHaveCount(0)
  await page.getByRole("button", { name: "撤销" }).click()
  await expect(centerItem).toBeVisible()
  await page.getByRole("button", { name: "上一帧" }).click()
  await expect(page.locator(".annotation-time")).toContainText("第 1 帧")
  await expect(centerItem).toHaveCount(0)
  await expect(
    list.getByRole("button", { name: "头点", exact: true }),
  ).toBeVisible()
  await expect(list.getByRole("listitem")).toHaveCount(4)

  await page.getByRole("tab", { name: "试次目录" }).click()
  await expect(
    page.getByText("暂无可访问的实验。请联系管理员确认实验权限。"),
  ).toBeVisible()
  await page.getByRole("tab", { name: "手动标注" }).click()
  await expect(
    page.getByRole("button", { name: "第 2 帧 1 个点" }),
  ).toBeVisible()
  await page.reload()
  await openVideo()
  await expect(
    page.getByRole("button", { name: "第 2 帧 1 个点" }),
  ).toBeVisible()
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出 JSON" }).click(),
  ])
  expect(download.suggestedFilename()).toBe("trial.annotations.json")
  const exported = JSON.parse(await readFile(await download.path(), "utf8"))
  expect(exported.video).toMatchObject({ width: 80, height: 48, fps: 10 })
  expect(exported.frames).toMatchObject([
    {
      frameIndex: 0,
      timeMs: 0,
      points: { head: { x: expect.any(Number), y: expect.any(Number) } },
    },
    { frameIndex: 1, timeMs: 100, points: { center: { x: 40, y: 24 } } },
  ])
  expect(exported.frames[0].points.tail).toBeUndefined()
  const sceneShapes: Array<{
    kind: string
    label: string
    shape_type: string
    frameIndex: number | null
    points: number[][]
  }> = exported.sceneShapes
  const [center, edge] = sceneShapes.find(
    (shape) => shape.kind === "pool",
  )!.points
  expect(center[0]).toBeGreaterThan(10)
  expect(center[0]).toBeLessThan(50)
  expect(edge[1]).toBeGreaterThan(center[1])
  expect(
    sceneShapes.map(({ kind, label, shape_type, frameIndex, points }) => [
      kind,
      label,
      shape_type,
      frameIndex,
      points.length,
    ]),
  ).toEqual([
    ["mark", "pentacle", "polygon", 1, 3],
    ["platform", "platform", "circle", 1, 2],
    ["pool", "pool", "circle", 1, 2],
  ])
})
