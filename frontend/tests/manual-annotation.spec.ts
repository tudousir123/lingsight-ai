import { readFile } from "node:fs/promises"
import { expect, test } from "@playwright/test"

test.use({ storageState: { cookies: [], origins: [] } })

test("手动标注能逐帧放点、撤销、恢复和导出", async ({ page }) => {
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
  const head = page.getByRole("button", { name: "画面标注：头点" })
  await expect(head).toBeEnabled()
  await head.click({ position: { x: 140, y: 110 } })
  await expect(
    page.getByRole("button", { name: "第 1 帧 1 个点" }),
  ).toBeVisible()
  await page.getByRole("button", { name: /^尾点/ }).click()
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
  await page.getByRole("button", { name: /^质心/ }).click()
  await page.getByRole("button", { name: "画面标注：质心" }).press("Enter")
  await expect(
    page.getByRole("button", { name: "第 2 帧 1 个点" }),
  ).toBeVisible()

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
})
