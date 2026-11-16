// Field contract + transport for the research Agent service (lingsight-agent,
// private repo tudousir123/lingsight-agent). True source: that service's /v1
// API (tasks/runs/artifacts/events, forwarded at
// backend/app/api/routes/agent.py). Field-shape drift is owned upstream by
// that service's own tests plus the platform e2e smoke; this module only
// pins what the workbench UI consumes.

import { authHeaders } from "@/lib/credentials"
import {
  type agentEnvironmentContract,
  type agentExecutionContract,
  agentGatewayBase,
} from "@/lib/upstreamRoutes.gen"

export type PersonalAgent = {
  id: string
  owner_user_id: string
  created_at: string
  environment: {
    id: string
    status: "ready" | "unavailable"
    contract: typeof agentEnvironmentContract
    reason?: string
  }
}
export type RunStatus =
  | "queued"
  | "running"
  | "waiting_for_input"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "result_unknown"
  | "cancel_unconfirmed"
export type Question = { id: string; question: string; answer: string | null }
export type Run = {
  recovery_blocked?: string | null
  cancellation?: {
    requested_at: string
    confirmed_at: string | null
    reason: string
  } | null
  execution?: {
    id: string
    engine: typeof agentExecutionContract.engine
    version: typeof agentExecutionContract.version
    conversation_id: number
    submission_id: number | null
  } | null
  id: string
  instruction: string
  status: RunStatus
  error: string | null
  answer?: { text: string; limitations?: string[] } | null
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
  personal_agent_id?: string | null
  environment_id?: string | null
  id: string
  project_id?: string | null
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
  cancelled: "已确认停止",
  result_unknown: "结果未知",
  cancel_unconfirmed: "停止未确认",
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
export function isTaskNotFound(error: unknown): boolean {
  return error instanceof AgentError && error.status === 404
}

export async function agentFetch(path: string, options: RequestInit = {}) {
  const response = await fetch(`${agentGatewayBase}/${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.headers,
      // Session auth always wins over caller-supplied Authorization.
      ...authHeaders(),
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
