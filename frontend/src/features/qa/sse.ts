import type { QaResult, StageEvent, StreamEvent } from "./types"

/** SSE 端点返回了非 200（401 未登录等），携带 HTTP 状态码。 */
export class StreamHttpError extends Error {
  status: number

  constructor(status: number) {
    super(`stream endpoint returned HTTP ${status}`)
    this.status = status
    this.name = "StreamHttpError"
  }
}

type StreamHandlers = {
  onStage: (event: StageEvent) => void
  signal?: AbortSignal
}

/**
 * POST /api/v1/research/query/stream 并逐事件解析 SSE。
 *
 * 返回终结 result 事件；流在未送达 result 时结束（连接中断）返回 null，
 * 由调用方按失败呈现——不猜测、不编造结果。
 */
export async function streamResearchQuery(
  question: string,
  handlers: StreamHandlers,
): Promise<QaResult | null> {
  const token = localStorage.getItem("access_token")
  const response = await fetch("/api/v1/research/query/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ question }),
    signal: handlers.signal,
  })
  if (!response.ok) {
    throw new StreamHttpError(response.status)
  }
  if (!response.body) {
    return null
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let result: QaResult | null = null
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split("\n\n")
    buffer = chunks.pop() ?? ""
    for (const chunk of chunks) {
      const line = chunk
        .split("\n")
        .find((candidate) => candidate.startsWith("data: "))
      if (!line) continue
      const event = JSON.parse(line.slice("data: ".length)) as StreamEvent
      if (event.type === "stage") {
        handlers.onStage(event)
      } else {
        result = event
      }
    }
  }
  return result
}
