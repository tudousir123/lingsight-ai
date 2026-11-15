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
export function useTaskEvents(taskId: string, owner: string) {
  const cacheKey = `lingsight.agent.events.v1:${owner}:${taskId}`
  const [state, setState] = useState<{
    id: string
    events: TaskEvent[]
    error: string
  }>({ id: cacheKey, events: [], error: "" })
  useEffect(() => {
    if (!taskId || !owner) return
    const controller = new AbortController()
    const { signal } = controller
    let ignore = false
    let events: TaskEvent[] = []
    try {
      const saved = JSON.parse(sessionStorage.getItem(cacheKey) ?? "[]")
      if (
        Array.isArray(saved) &&
        saved.every(
          (e) =>
            Number.isSafeInteger(e.id) &&
            e.id > 0 &&
            typeof e.run_id === "string" &&
            e.data &&
            typeof e.type === "string",
        )
      )
        events = saved
    } catch {
      /* A missing cache never cancels server work: replay from zero. */
    }
    let cursor = events[events.length - 1]?.id ?? 0
    setState({ id: cacheKey, events, error: "" })
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
            try {
              sessionStorage.setItem(
                cacheKey,
                JSON.stringify(events.slice(-500)),
              )
            } catch {
              /* Replay from zero after a cache quota failure. */
            }
          }
          setState({ id: cacheKey, events, error: "" })
          delay = batch.length >= 500 ? 0 : 1500
        } catch (e) {
          if (ignore) return
          setState({
            id: cacheKey,
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
  }, [taskId, owner, cacheKey])
  return state.id === cacheKey ? state : { id: cacheKey, events: [], error: "" }
}
