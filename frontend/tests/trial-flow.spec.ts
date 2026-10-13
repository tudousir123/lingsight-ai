import { expect, test } from "@playwright/test"

// Full-stack trial-flow spec (#18): the compose stack serves the synthetic
// fixture (TRIALS_FIXTURE_DIR), so these run against the real backend —
// persistence, gates and honest-missing states included. Each test owns a
// distinct fixture trial so parallel shards cannot collide on review state.

const experiment = "fixture-e1"
const trialA = "fixture-trial-a" // full materials, 90 frames @ 30 fps
const trialB = "fixture-trial-b" // no offline track, no metrics
const trialC = "fixture-trial-c" // no media, no platform calibration
const trialD = "fixture-trial-d" // no markers (experiment e2)

const _checkHints = [
  "试次起止画面正确，水池边界几何与画面对齐",
  "场景标注与画面中的四个标志物位置一致",
  "元数据平台圈（E1 共识坐标）落在画面中预期区域",
  "中心点与头尾关键点跟得住动物，miss/coord 帧合理",
]

function prepareUrl(trial: string) {
  return `/experiments/${experiment}/trials/${trial}`
}

function resultUrl(trial: string) {
  return `/experiments/${experiment}/trials/${trial}/result`
}

test("select trial, review four checks, confirm, and open the same trial's results", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await expect(
    page.getByRole("heading", { name: "实验与视频管理" }),
  ).toBeVisible()
  await page.getByRole("link", { name: `打开分析准备 合成试次A.mp4` }).click()

  // Preparation page: materials all present with provenance, overlay video first.
  await expect(page).toHaveURL(new RegExp(`${prepareUrl(trialA)}$`))
  await expect(
    page.getByRole("heading", { name: "分析准备 · 合成试次A.mp4" }),
  ).toBeVisible()
  await expect(page.getByText("推理叠加视频（优先）")).toBeVisible()
  const video = page.locator("video")
  await expect(video).toBeVisible()
  await expect(video).toHaveAttribute("src", /media\/overlay\?token=/)
  for (const name of [
    "试次视频",
    "水池边界几何",
    "标志物标注",
    "基准平台标定",
    "离线追踪结果",
  ]) {
    await expect(page.locator("dt").filter({ hasText: name })).toBeVisible()
  }
  await expect(page.locator("dd").filter({ hasText: "缺失" })).toHaveCount(0)
  await expect(
    page.getByText(/84\/90 有效帧 · miss 4 帧 · coord 2 帧/),
  ).toBeVisible()

  // The final-confirm gate stays closed until all four checks pass.
  await expect(page.getByRole("button", { name: "最终确认" })).toBeDisabled()

  for (const label of [
    "确认试次边界",
    "确认朝向标志物",
    "确认基准平台",
    "确认追踪质量",
  ]) {
    await page
      .locator(`button[role="checkbox"][aria-label="${label}"]`)
      .dispatchEvent("click")
    await expect(
      page.locator(`button[role="checkbox"][aria-label="${label}"]`),
    ).toHaveAttribute("aria-checked", "true")
  }
  await expect(page.getByRole("button", { name: "最终确认" })).toBeEnabled()

  // Draft round-trip: save, reload, and the persisted draft restores.
  await page.getByRole("button", { name: "保存草稿" }).click()
  await expect(page.getByText("草稿已保存")).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "分析准备 · 合成试次A.mp4" }),
  ).toBeVisible()
  const checked = page.locator('button[role="checkbox"][aria-label^="确认"]')
  await expect(checked).toHaveCount(4)
  for (let i = 0; i < 4; i++) {
    await expect(checked.nth(i)).toHaveAttribute("aria-checked", "true")
  }

  // Final confirmation persists reviewer identity and binds the material version.
  await page.getByRole("button", { name: "最终确认" }).click()
  await expect(page.getByText("已最终确认", { exact: true })).toBeVisible()
  await expect(page.getByText(/绑定素材版本 [0-9a-f]{16}/)).toBeVisible()

  // Same-trial results page, reached from the confirmation state.
  await page.getByRole("link", { name: "查看离线结果 →" }).click()
  await expect(page).toHaveURL(new RegExp(`${resultUrl(trialA)}$`))
  await expect(
    page.getByRole("heading", { name: "单次分析结果 · 合成试次A.mp4" }),
  ).toBeVisible()
  await expect(page.getByText("已确认", { exact: true })).toBeVisible()

  // Trustworthy metrics with unit, algorithm version and honest gaps.
  await expect(page.getByText("可信指标")).toBeVisible({ timeout: 30_000 })
  await expect(page.locator("dt").filter({ hasText: "轨迹长度" })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText("v1-polyline-ok-frames").first()).toBeVisible()
  await expect(
    page.getByText("v1-platformzone-46px-maskcontact-mount500ms").first(),
  ).toBeVisible()
  await expect(
    page.getByText("轨迹长度（cm）不可用：缺少有效的空间标定"),
  ).toBeVisible()

  // The platform-entry candidate is labeled as a geometric candidate only.
  await expect(
    page.getByRole("button", { name: /定位平台圈进入 · t=/ }),
  ).toBeVisible()
  await expect(page.getByText("仅几何候选，不构成有效上台判定")).toBeVisible()

  // Seeking the video moves the frame readout (30 fps fixture).
  await page.locator("video").evaluate((v) => {
    v.currentTime = 2
  })
  await expect(page.getByText("第 60 帧")).toBeVisible()
})

test("missing materials are reported item by item, never silently dropped", async ({
  page,
}) => {
  await page.goto(prepareUrl(trialB))
  await expect(
    page.getByRole("heading", { name: "分析准备 · 合成试次B.mp4" }),
  ).toBeVisible()
  await expect(
    page.getByText("该试次尚无离线推理结果（未接入模型推理，不代填示例轨迹）"),
  ).toBeVisible()
  await expect(
    page.getByText(/缺失素材：离线追踪结果。最终确认需要素材齐备/),
  ).toBeVisible()

  await page.goto(prepareUrl(trialC))
  await expect(
    page.getByRole("heading", { name: "分析准备 · 合成试次C.mp4" }),
  ).toBeVisible()
  await expect(
    page.getByText("视频文件不可用（合成夹具未提供该试次的媒体文件）").first(),
  ).toBeVisible()
  await expect(page.getByText("实验日期 0810 没有平台标定记录")).toBeVisible()
})

test("unconfirmed trial's results page says so instead of hiding data", async ({
  page,
}) => {
  await page.goto(resultUrl(trialB))
  await expect(
    page.getByRole("heading", { name: "单次分析结果 · 合成试次B.mp4" }),
  ).toBeVisible()
  await expect(
    page.getByText("该试次尚未开始人工准备核对，以下结果在确认前仅供参考。"),
  ).toBeVisible()
  await expect(page.getByText("未开始").first()).toBeVisible()
  await expect(
    page.getByText("该试次尚无离线推理结果（未接入模型推理，不代填示例轨迹）"),
  ).toBeVisible()
  await expect(page.getByText("该试次没有已计算的指标。")).toBeVisible()
})

test("a failed review save keeps the reviewer's selections", async ({
  page,
}) => {
  await page.route(
    "**/api/v1/experiments/fixture-e2/trials/*/review",
    (route) => route.abort(),
  )
  await page.goto(`/experiments/fixture-e2/trials/${trialD}`)
  await expect(
    page.getByRole("heading", { name: "分析准备 · 合成试次D.mp4" }),
  ).toBeVisible()

  await page
    .locator('button[role="checkbox"][aria-label="确认试次边界"]')
    .dispatchEvent("click")
  await page
    .locator('button[role="checkbox"][aria-label="确认追踪质量"]')
    .dispatchEvent("click")
  await page.getByRole("button", { name: "保存草稿" }).click()
  await expect(page.getByText("保存失败，请重试")).toBeVisible()

  // The two selections survive the failed save.
  await expect(
    page.locator('button[role="checkbox"][aria-label="确认试次边界"]'),
  ).toHaveAttribute("aria-checked", "true")
  await expect(
    page.locator('button[role="checkbox"][aria-label="确认追踪质量"]'),
  ).toHaveAttribute("aria-checked", "true")

  // After the network recovers the same selections save as a draft.
  await page.unrouteAll()
  await page.getByRole("button", { name: "保存草稿" }).click()
  await expect(page.getByText("草稿已保存")).toBeVisible()
})

test("failed trial keeps its no-mount event rows with reasons", async ({
  page,
}) => {
  await page.goto(`/experiments/fixture-e2/trials/${trialD}/result`)
  await expect(
    page.getByRole("heading", { name: "单次分析结果 · 合成试次D.mp4" }),
  ).toBeVisible()
  await expect(page.getByText("首次平台接触")).toBeVisible()
  await expect(page.getByText("未发生平台接触")).toBeVisible()
  await expect(page.getByText("未完成上台").first()).toBeVisible()
})
