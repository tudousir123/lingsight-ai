import { agentGatewayBase } from "@/lib/upstreamRoutes.gen"

export type RunStatus =
  | "queued"
  | "running"
  | "waiting_for_input"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted"
export type Question = { id: string; question: string; answer: string | null }
export type Run = {
  id: string
  instruction: string
  status: RunStatus
  error: string | null
  clarifications?: Question[]
}
export type Artifact = {
  id: string
  run_id: string
  name: string
  kind: string
  bytes: number
  sha256: string
}
export type Task = {
  id: string
  title: string
  goal: string
  created_at: string
  runs: Run[]
  artifacts?: Artifact[]
}
export type TaskEvent = {
  id: number
  run_id: string
  type: string
  data: Record<string, unknown>
}
export const statusLabels: Record<RunStatus, string> = {
  queued: "排队中",
  running: "运行中",
  waiting_for_input: "等待确认",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
}

export class AgentError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}
export async function agentFetch(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem("access_token")
  const response = await fetch(`${agentGatewayBase}/${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const message = body.detail ?? body.error
    throw new AgentError(
      typeof message === "string" ? message : `请求失败（${response.status}）`,
      response.status,
    )
  }
  return response
}
export async function agentJson<T>(
  path: string,
  body?: unknown,
  method = "POST",
  signal?: AbortSignal,
): Promise<T> {
  return (
    await agentFetch(
      path,
      body === undefined
        ? { signal }
        : { method, body: JSON.stringify(body), signal },
    )
  ).json()
}
export const tasksKey = ["agent-tasks"] as const
export const taskKey = (id: string) => ["agent-task", id] as const
export function isActive(status?: RunStatus) {
  return (
    status === "queued" ||
    status === "running" ||
    status === "waiting_for_input"
  )
}
export async function download(path: string, filename: string) {
  const blob = await (await agentFetch(path)).blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
