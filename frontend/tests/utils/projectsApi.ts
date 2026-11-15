import type { Page, Route } from "@playwright/test"

export type MockMember = {
  kind: "agent_task" | "video"
  id: string
  label?: string | null
}

export type MockVideo = {
  video_id: string
  filename: string
  format: "mp4" | "avi"
  bytes: number
  width: number
  height: number
  frame_count: number
  fps: number
}

export type MockProject = {
  id: string
  name: string
  members: MockMember[]
  videos?: MockVideo[]
  video_folder?: { source_id: string; path: string; label: string } | null
}

export const workspaceInfo = (
  overrides: Partial<{
    whole_library_access: boolean
    allowed_experiment_ids: string[]
  }> = {},
) => ({
  user_id: "user",
  workspace_enabled: true,
  whole_library_access: false,
  allowed_experiment_ids: [],
  upload: { max_bytes: 2_000_000_000, extensions: ["mp4", "avi"] },
  ...overrides,
})

export const videoPublic = (projectId: string, video: MockVideo) => ({
  ...video,
  project_id: projectId,
  source_id: "upload-user",
  source_kind: "user_upload",
  sha256: "a".repeat(64),
  created_at: "2026-11-15T00:00:00Z",
  media_url: `/api/v1/projects/${projectId}/videos/${video.video_id}/media`,
  preview_url: `/api/v1/projects/${projectId}/videos/${video.video_id}/preview`,
  inference_ready: true,
})

const DEFAULT_PROJECTS: MockProject[] = [
  { id: "learning-memory", name: "学习与记忆", members: [] },
  { id: "behavior-notes", name: "动物行为研究笔记", members: [] },
]

/**
 * Stateful fixture for the platform project API (`/api/v1/projects`).
 * Mirrors the backend contract: create/rename/delete, idempotent member
 * upsert/remove, and the replay-idempotent local-storage import.
 */
export function stubProjectsApi(
  page: Page,
  initial: MockProject[] = DEFAULT_PROJECTS,
) {
  const state = {
    projects: structuredClone(initial),
    imports: [] as { name: string; task_ids: string[] }[][],
  }
  let seq = 0
  const now = "2026-11-10T00:00:00Z"
  const publicProject = (project: MockProject) => ({
    id: project.id,
    name: project.name,
    created_at: now,
    updated_at: now,
    video_folder: project.video_folder ?? null,
    members: [
      ...project.members,
      ...(project.videos ?? []).map(
        (video): MockMember => ({
          kind: "video",
          id: video.video_id,
          label: video.filename,
        }),
      ),
    ].map((member) => ({ ...member, added_at: now })),
  })

  async function handle(route: Route) {
    const request = route.request()
    const url = new URL(request.url())
    const segments = url.pathname
      .replace(/^.*\/api\/v1\/projects\/?/, "")
      .split("/")
      .filter(Boolean)
    const method = request.method()

    if (segments.length === 0) {
      if (method === "GET") {
        return route.fulfill({
          json: {
            data: state.projects.map(publicProject),
            count: state.projects.length,
          },
        })
      }
      if (method === "POST") {
        const { name } = request.postDataJSON() as { name: string }
        if (state.projects.some((project) => project.name === name))
          return route.fulfill({
            status: 409,
            json: { detail: "同名项目已存在" },
          })
        const project: MockProject = { id: `proj-${++seq}`, name, members: [] }
        state.projects.push(project)
        return route.fulfill({ json: publicProject(project) })
      }
    }

    if (segments[0] === "import" && method === "POST") {
      const body = request.postDataJSON() as {
        projects: { name: string; task_ids: string[] }[]
      }
      state.imports.push(body.projects)
      let created = 0
      let skipped = 0
      for (const item of body.projects) {
        if (state.projects.some((project) => project.name === item.name)) {
          skipped += 1
          continue
        }
        state.projects.push({
          id: `proj-${++seq}`,
          name: item.name,
          members: item.task_ids.map((taskId) => ({
            kind: "agent_task",
            id: taskId,
          })),
        })
        created += 1
      }
      return route.fulfill({ json: { created, skipped } })
    }

    const project = state.projects.find((item) => item.id === segments[0])
    if (!project)
      return route.fulfill({ status: 404, json: { detail: "项目不存在" } })

    // Published-results read surface defaults to empty; per-test routes can
    // override with concrete published rows (registered later = matched first).
    if (
      segments[1] === "results" &&
      segments.length === 2 &&
      method === "GET"
    ) {
      return route.fulfill({ json: { data: [], count: 0 } })
    }
    if (
      segments[1] === "results" &&
      segments[2] &&
      segments[3] === "frames" &&
      method === "GET"
    ) {
      return route.fulfill({
        status: 404,
        json: { detail: "该项目没有该任务的已发布结果" },
      })
    }

    if (segments[1] === "videos" && segments.length === 2) {
      if (method === "GET")
        return route.fulfill({
          json: {
            data: (project.videos ?? []).map((video) =>
              videoPublic(project.id, video),
            ),
            count: (project.videos ?? []).length,
            offset: 0,
            limit: 100,
          },
        })
      if (method === "POST") {
        const headers = request.headers()
        if (!/^[0-9a-f-]{36}$/.test(headers["idempotency-key"] ?? ""))
          return route.fulfill({
            status: 422,
            json: { detail: { code: "invalid_input", message: "key" } },
          })
        const name =
          /filename="([^"]+)"/.exec(request.postData() ?? "")?.[1] ?? "x.mp4"
        const video: MockVideo = {
          video_id: `upl_${(project.videos ?? []).length + 1}`,
          filename: name,
          format: name.toLowerCase().endsWith(".avi") ? "avi" : "mp4",
          bytes: 1024,
          width: 640,
          height: 480,
          frame_count: 300,
          fps: 30,
        }
        project.videos = [...(project.videos ?? []), video]
        return route.fulfill({
          status: 201,
          json: videoPublic(project.id, video),
        })
      }
    }

    if (segments.length === 1 && method === "PATCH") {
      const { name } = request.postDataJSON() as { name: string }
      if (
        state.projects.some(
          (other) => other.name === name && other.id !== project.id,
        )
      )
        return route.fulfill({
          status: 409,
          json: { detail: "同名项目已存在" },
        })
      project.name = name
      return route.fulfill({ json: publicProject(project) })
    }
    if (segments.length === 1 && method === "DELETE") {
      state.projects = state.projects.filter((item) => item.id !== project.id)
      return route.fulfill({ json: { message: "项目已删除" } })
    }
    if (
      segments[1] === "members" &&
      segments.length === 2 &&
      method === "POST"
    ) {
      const body = request.postDataJSON() as MockMember
      const existing = project.members.find(
        (member) => member.kind === body.kind && member.id === body.id,
      )
      if (existing) {
        existing.label = body.label ?? existing.label
        return route.fulfill({ json: { ...existing, added_at: now } })
      }
      const member: MockMember = {
        kind: body.kind,
        id: body.id,
        label: body.label ?? null,
      }
      project.members.push(member)
      return route.fulfill({ status: 201, json: { ...member, added_at: now } })
    }
    if (
      segments[1] === "members" &&
      segments.length === 4 &&
      method === "DELETE"
    ) {
      const kind = segments[2]
      const memberId = decodeURIComponent(segments[3])
      const uploadIndex = (project.videos ?? []).findIndex(
        (video) => kind === "video" && video.video_id === memberId,
      )
      if (uploadIndex !== -1) {
        project.videos?.splice(uploadIndex, 1)
        return route.fulfill({ status: 204, body: "" })
      }
      const index = project.members.findIndex(
        (member) => member.kind === kind && member.id === memberId,
      )
      if (index === -1)
        return route.fulfill({
          status: 404,
          json: { detail: "成员不在项目中" },
        })
      project.members.splice(index, 1)
      return route.fulfill({ status: 204, body: "" })
    }
    return route.fulfill({ status: 405, json: { detail: "not stubbed" } })
  }

  // Workspace capability defaults to an authorized library user so older
  // specs keep their folder UI; specs for new users override this route.
  void page.route("**/api/v1/users/me/workspace", (route) =>
    route.fulfill({ json: workspaceInfo({ whole_library_access: true }) }),
  )
  void page.route("**/api/v1/projects", handle)
  void page.route("**/api/v1/projects/", handle)
  void page.route("**/api/v1/projects/**", handle)
  return state
}
