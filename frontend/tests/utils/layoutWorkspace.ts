import type { Page } from "@playwright/test"
import { type MockProject, stubProjectsApi } from "./projectsApi"

const experiment = { id: "fixture-e1", name: "示例实验一", trial_count: 12 }
const phases = ["training_day", "probe_platform_present"]
const trials = Array.from({ length: 12 }, (_, index) => ({
  id: `trial-${index + 1}`,
  experiment_id: "fixture-e1",
  video_name: `sample-${index + 1}.mp4`,
  group_name: index % 2 ? "c1" : "A2",
  mouse_id: String((index % 4) + 1),
  phase: phases[index % 2],
  date_dir: index % 2 ? "0809" : "0804",
  training_day: index % 2 ? null : 1,
  session_no: (index % 3) + 1,
  session_label: `第${(index % 3) + 1}次`,
  trial_no: String(index + 1),
  media_available: index % 3 !== 0,
  result_available: index % 4 === 0,
}))
const runs = (status: string) => [
  { id: "run", instruction: "分析", status, error: null },
]
const agentTasks = [
  ["水迷宫逃避潜伏期", "succeeded"],
  ["空间探索热图", "running"],
  ["旷场实验轨迹", "failed"],
].map(([title, status], index) => ({
  id: `task-${index + 1}`,
  project_id: null,
  title,
  goal: title,
  created_at: "2026-11-10T08:00:00Z",
  runs: runs(status),
  artifacts: [],
}))

export const layoutProjects: MockProject[] = [
  { id: "p1", name: "学习与记忆", members: [] },
  { id: "p2", name: "动物行为研究笔记", members: [] },
  { id: "p3", name: "水迷宫第三批", members: [] },
]

/** Fully stubbed signed-in workspace: no backend, agent or inference service. */
export async function mockLayoutWorkspace(
  page: Page,
  options: { admin?: boolean; projects?: MockProject[] } = {},
) {
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "layout-test")
    localStorage.setItem("lingsight.onboarding-seen.v1", "1")
  })
  await page.route("**/api/v1/users/me", (route) =>
    route.fulfill({
      json: {
        id: "layout-user",
        email: "layout@example.com",
        full_name: "布局测试",
        is_active: true,
        is_superuser: options.admin ?? false,
      },
    }),
  )
  await page.route("**/api/v1/agent/tasks", (route) =>
    route.fulfill({ json: agentTasks }),
  )
  await page.route("**/api/v1/experiments", (route) =>
    route.fulfill({ json: { data: [experiment], count: 1 } }),
  )
  await page.route("**/api/v1/experiments/fixture-e1/trials?*", (route) =>
    route.fulfill({ json: { data: trials, count: trials.length } }),
  )
  await page.route("**/api/v1/inference/**", (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith("/videos"))
      return route.fulfill({
        json: {
          items: [
            { type: "directory", name: "0804", path: "0804" },
            { type: "video", name: "test.mp4", id: "one" },
          ],
        },
      })
    return route.fulfill({ json: { items: [] } })
  })
  return stubProjectsApi(page, options.projects ?? layoutProjects)
}

/** A short synthetic 4:3 WebM, as bytes that can be fed to the file input. */
export async function recordTestVideo(page: Page): Promise<number[]> {
  return page.evaluate(async () => {
    const canvas = document.createElement("canvas")
    canvas.width = 640
    canvas.height = 480
    const context = canvas.getContext("2d")
    if (!context) throw new Error("Missing canvas context")
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
      context.fillRect(x, 220, 40, 20)
      x += 4
    }
    paint()
    const clock = window.setInterval(paint, 100)
    await new Promise((resolve) => window.setTimeout(resolve, 1200))
    window.clearInterval(clock)
    recorder.stop()
    await stopped
    for (const track of stream.getTracks()) track.stop()
    return Array.from(
      new Uint8Array(
        await new Blob(chunks, { type: "video/webm" }).arrayBuffer(),
      ),
    )
  })
}

export async function openTestVideo(page: Page, bytes: number[]) {
  await page.getByLabel("选择本地标注视频").evaluate((input, data) => {
    const files = new DataTransfer()
    files.items.add(
      new File([new Uint8Array(data)], "trial.webm", {
        type: "video/webm",
        lastModified: 1234,
      }),
    )
    if (!(input instanceof HTMLInputElement))
      throw new Error("Missing video input")
    input.files = files.files
    input.dispatchEvent(new Event("change", { bubbles: true }))
  }, bytes)
}
