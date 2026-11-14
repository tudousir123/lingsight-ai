import { useEffect, useState } from "react"
import { agentRoutes } from "@/lib/upstreamRoutes.gen"
import { agentJson, isTaskNotFound, type TaskEvent } from "./api"

// Resolves after `ms`, or immediately when `signal` aborts; the timer is
// always cleared so nothing outlives the effect that owns the signal.
function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener("abort", done)
  })
}

// Durable cursor polling uses the same event log as SSE. Disconnecting never
// cancels a task; switching tasks aborts only this browser's pending requests.
export function useTaskEvents(taskId: string) {
  const [state, setState] = useState<{
    id: string
    events: TaskEvent[]
    error: string
  }>({ id: taskId, events: [], error: "" })
  useEffect(() => {
    if (!taskId) return
    const controller = new AbortController()
    const { signal } = controller
    let ignore = false
    let cursor = 0
    let events: TaskEvent[] = []
    const poll = async () => {
      while (!ignore) {
        let delay: number
        try {
          const batch = await agentJson<TaskEvent[]>(
            `${agentRoutes.tasksByTaskIdEvents(taskId)}?after=${cursor}`,
            undefined,
            "GET",
            signal,
          )
          if (ignore) return
          const next = batch
            .filter((e) => e.id > cursor)
            .sort((a, b) => a.id - b.id)
          if (next.length) {
            cursor = next[next.length - 1].id
            events = [...events, ...next]
          }
          setState({ id: taskId, events, error: "" })
          delay = batch.length >= 500 ? 0 : 1500
        } catch (e) {
          if (ignore) return
          setState({
            id: taskId,
            events,
            error:
              e instanceof Error
                ? e.message
                : "Progress connection interrupted",
          })
          if (isTaskNotFound(e)) return
          delay = 4000
        }
        await sleep(delay, signal)
      }
    }
    void poll()
    return () => {
      ignore = true
      controller.abort()
    }
  }, [taskId])
  return state.id === taskId ? state : { id: taskId, events: [], error: "" }
}
