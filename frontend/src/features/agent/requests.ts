import { newUuid } from "@/lib/uuid"
import { AgentError, agentJson } from "./api"

type PendingRequest = { request_id: string; body: Record<string, unknown> }
const key = (owner: string, path: string) =>
  `lingsight.agent.pending.v1:${owner}:${path}`
export function pendingRequest(
  owner: string,
  path: string,
): PendingRequest | null {
  const raw = localStorage.getItem(key(owner, path))
  if (!raw) return null
  const value = JSON.parse(raw)
  if (!value.request_id || !value.body || typeof value.body !== "object")
    throw new Error("未确认请求记录不可用，请先核对任务列表，勿重复提交。")
  return value
}
// Persist BEFORE fetch; clear only after a received acceptance or definitive
// rejection. A disconnect is not evidence that the Agent rejected the request.
export async function agentRequest<T = unknown>(
  owner: string,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  if (!owner) throw new Error("请先连接个人 Agent。")
  const previous = pendingRequest(owner, path)
  if (previous && JSON.stringify(previous.body) !== JSON.stringify(body))
    throw new Error(
      "上次请求接收状态未确认。请恢复原文或刷新工作区后重试；不要重复创建任务。",
    )
  const request = previous ?? { request_id: newUuid(), body }
  // If local persistence fails, do not issue an untraceable write.
  localStorage.setItem(key(owner, path), JSON.stringify(request))
  try {
    const result = await agentJson<T>(path, {
      ...request.body,
      request_id: request.request_id,
    })
    localStorage.removeItem(key(owner, path))
    return result
  } catch (error) {
    if (
      error instanceof AgentError &&
      error.status >= 400 &&
      error.status < 500 &&
      ![408, 409, 429].includes(error.status)
    )
      localStorage.removeItem(key(owner, path))
    throw error
  }
}

// Only for an explicit user decision to abandon a local retry. This never
// changes Agent state or authorizes a tool operation.
export function discardPendingRequest(owner: string, path: string) {
  localStorage.removeItem(key(owner, path))
}
