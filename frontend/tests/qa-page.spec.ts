import { expect, type Route, test } from "@playwright/test"

const STREAM_URL = "**/api/v1/research/query/stream"

type StreamBody = Record<string, unknown>

function sse(...events: StreamBody[]) {
  return `${events.map((event) => `data: ${JSON.stringify(event)}`).join("\n\n")}\n\n`
}

function stage(attempt: number, name: string): StreamBody {
  return { type: "stage", attempt, stage: name }
}

const countQuestion = "库里一共有多少只动物？"
const speedQuestion = "训练期内各组每鼠每日的平均游泳速度是多少？"

function okAnswer(
  question: string,
  rows: number[][],
  columns: string[],
): StreamBody {
  return {
    type: "result",
    status: "ok",
    question,
    sql: `SELECT ${columns.join(", ")} FROM videos LIMIT 200`,
    columns,
    rows,
    row_count: rows.length,
    caliber_note:
      "动物口径：动物 = (group_name, mouse_id)（标准表达 COUNT(DISTINCT CONCAT(group_name, '|', mouse_id))；animal_code 是组-鼠-试次编码，不能当动物数）\n聚合口径：组间统计的推荐聚合口径是逐鼠-逐日。",
    data_source: {
      database: "water_maze",
      tables: ["videos", "trial_metrics"],
      queried_at: "2026-10-14T08:00:00.000000+00:00",
      row_limit: 200,
      truncated: false,
    },
    attempts: 1,
    trace: [],
    empty: rows.length === 0,
    suggestion:
      rows.length === 0 ? "检查 WHERE 过滤条件是否过窄后重新提问。" : null,
  }
}

function rejected(
  reasonCode: string,
  message: string,
  attempts = 1,
): StreamBody {
  return {
    type: "result",
    status: "rejected",
    reason_code: reasonCode,
    message,
    sql: null,
    attempts,
    trace:
      attempts > 1
        ? [
            {
              attempt: 1,
              stage: "validation",
              reason_code: reasonCode,
              message,
            },
          ]
        : [],
  }
}

function fulfillSse(route: Route, body: string) {
  return route.fulfill({ contentType: "text/event-stream", body })
}

test.beforeEach(async ({ page }) => {
  // 默认兜底：未显式打桩的流请求一律 401，避免误打真后端
  await page.route(STREAM_URL, (route) =>
    route.fulfill({ status: 401, json: { detail: "Not authenticated" } }),
  )
})

test("example question streams stages, answer, caliber note and SQL details", async ({
  page,
}) => {
  await page.route(STREAM_URL, (route) =>
    fulfillSse(
      route,
      sse(
        stage(1, "generation"),
        stage(1, "validation"),
        stage(1, "execution"),
        okAnswer(countQuestion, [[6]], ["animal_count"]),
      ),
    ),
  )

  await page.goto("/qa")
  await expect(page.getByRole("heading", { name: "科研问答" })).toBeVisible()
  await expect(page.getByRole("link", { name: "科研问答" })).toBeVisible()
  await expect(page.getByRole("button", { name: countQuestion })).toBeVisible()

  await page.getByRole("button", { name: countQuestion }).click()
  await expect(
    page.getByRole("heading", { name: countQuestion, level: 2 }),
  ).toBeVisible()
  await expect(page.getByLabel("查询阶段进度")).toContainText("生成 SQL")
  await expect(page.getByLabel("查询阶段进度")).toContainText("校验 SQL")
  await expect(page.getByLabel("查询阶段进度")).toContainText("执行查询")
  await expect(
    page.getByText("动物口径：动物 = (group_name, mouse_id)"),
  ).toBeVisible()
  await expect(page.getByRole("cell", { name: "6", exact: true })).toBeVisible()
  await expect(
    page.getByText(
      "数据来源：water_maze · 表 videos、trial_metrics · 1 行（上限 200）",
    ),
  ).toBeVisible()

  await page.getByText("查看 SQL 与技术细节（1 次生成）").click()
  await expect(page.getByLabel("复制 SQL")).toBeVisible()
  await expect(page.getByText(/animal_count FROM videos/)).toBeVisible()
})

test("empty result is a success channel with suggestion, never a table", async ({
  page,
}) => {
  await page.route(STREAM_URL, (route) =>
    fulfillSse(
      route,
      sse(
        stage(1, "generation"),
        stage(1, "validation"),
        stage(1, "execution"),
        okAnswer(countQuestion, [], []),
      ),
    ),
  )
  await page.goto("/qa")
  await page
    .getByRole("textbox", { name: "研究问题" })
    .fill("不存在的组 z9 的动物数")
  await page.getByRole("button", { name: "提问" }).click()
  await expect(page.getByText("查询结果为空")).toBeVisible()
  await expect(page.getByText(/检查 WHERE 过滤条件/)).toBeVisible()
  await expect(page.getByRole("table")).toHaveCount(0)
})

test("typed rejection shows reason without a table and without a retry for 403 class", async ({
  page,
}) => {
  await page.route(STREAM_URL, (route) =>
    fulfillSse(
      route,
      sse(
        stage(1, "generation"),
        stage(1, "validation"),
        // 修复循环：第二次尝试重新走 generation，时间线应显示第 2 次尝试徽章
        stage(2, "generation"),
        stage(2, "validation"),
        rejected("whitelist_violation", "列 secret_col 不在白名单", 2),
      ),
    ),
  )
  await page.goto("/qa")
  await page.getByRole("textbox", { name: "研究问题" }).fill("读一下内部列")
  await page.getByRole("button", { name: "提问" }).click()
  // 断言收窄到 alert：拒绝标签文案也会出现在历史条目里，直接 getByText 会撞 strict mode
  const rejectionAlert = page.getByRole("alert")
  await expect(rejectionAlert).toContainText("表或列不在白名单")
  await expect(rejectionAlert).toContainText("列 secret_col 不在白名单")
  // 修复循环的两个第 2 次阶段（generation/validation）各带一枚尝试徽章
  await expect(
    page.getByLabel("查询阶段进度").getByText("第 2 次尝试"),
  ).toHaveCount(2)
  await expect(page.getByText(/共尝试 2 次生成/)).toBeVisible()
  await expect(page.getByRole("table")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "重试" })).toHaveCount(0)
})

test("provider failure offers one-click retry of the same question", async ({
  page,
}) => {
  let calls = 0
  await page.route(STREAM_URL, (route) => {
    calls += 1
    if (calls === 1) {
      return fulfillSse(
        route,
        sse(
          stage(1, "generation"),
          rejected("provider_error", "LLM endpoint returned HTTP 429"),
        ),
      )
    }
    return fulfillSse(
      route,
      sse(
        stage(1, "generation"),
        stage(1, "validation"),
        stage(1, "execution"),
        okAnswer(countQuestion, [[6]], ["animal_count"]),
      ),
    )
  })
  await page.goto("/qa")
  await page.getByRole("textbox", { name: "研究问题" }).fill(countQuestion)
  await page.getByRole("button", { name: "提问" }).click()
  await expect(page.getByRole("alert")).toContainText("模型服务异常")
  await page.getByRole("button", { name: "重试" }).click()
  await expect(page.getByRole("cell", { name: "6", exact: true })).toBeVisible()
  expect(calls).toBe(2)
})

test("in-session history replays cached answers without re-sending", async ({
  page,
}) => {
  let calls = 0
  await page.route(STREAM_URL, (route) => {
    calls += 1
    const question = JSON.parse(route.request().postData() ?? "{}").question
    const answer =
      question === countQuestion
        ? okAnswer(countQuestion, [[6]], ["animal_count"])
        : okAnswer(speedQuestion, [[79.69]], ["speed_px"])
    return fulfillSse(
      route,
      sse(
        stage(1, "generation"),
        stage(1, "validation"),
        stage(1, "execution"),
        answer,
      ),
    )
  })
  await page.goto("/qa")
  await page.getByRole("button", { name: countQuestion }).click()
  await expect(page.getByRole("cell", { name: "6", exact: true })).toBeVisible()
  await page.getByRole("textbox", { name: "研究问题" }).fill(speedQuestion)
  await page.getByRole("button", { name: "提问" }).click()
  await expect(
    page.getByRole("cell", { name: "79.69", exact: true }),
  ).toBeVisible()

  await expect(
    page.getByRole("button", { name: new RegExp(speedQuestion) }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: new RegExp(countQuestion) }),
  ).toBeVisible()
  await page.getByRole("button", { name: new RegExp(countQuestion) }).click()
  await expect(
    page.getByRole("heading", { name: countQuestion, level: 2 }),
  ).toBeVisible()
  await expect(page.getByRole("cell", { name: "6", exact: true })).toBeVisible()
  expect(calls).toBe(2)
})

test("loading state shows elapsed seconds and no fake progress", async ({
  page,
}) => {
  await page.route(STREAM_URL, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    return fulfillSse(
      route,
      sse(
        stage(1, "generation"),
        stage(1, "validation"),
        stage(1, "execution"),
        okAnswer(countQuestion, [[6]], ["animal_count"]),
      ),
    )
  })
  await page.goto("/qa")
  await page.getByRole("button", { name: countQuestion }).click()
  await expect(page.getByRole("button", { name: /提问中/ })).toBeDisabled()
  await expect(
    page.getByText(
      "正在生成并校验 SQL，模型思考可能需要数十秒，请勿重复提交。",
    ),
  ).toBeVisible()
  await expect(page.getByRole("cell", { name: "6", exact: true })).toBeVisible()
})
