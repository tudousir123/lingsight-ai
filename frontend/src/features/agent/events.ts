import { useEffect, useState } from "react"
import { agentJson, type TaskEvent } from "./api"

// Durable cursor polling uses the same event log as SSE. Disconnecting never
// cancels a task; switching tasks aborts only this browser's pending requests.
export function useTaskEvents(taskId: string) {
  const [state, setState] = useState<{
    id: string
    events: TaskEvent[]
    error: string
  }>({ id: taskId, events: [], error: "" })
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let cursor = 0
    let events: TaskEvent[] = []
    setState({ id: taskId, events: [], error: "" })
    if (!taskId) return
    const poll = async () => {
      try {
        const batch = await agentJson<TaskEvent[]>(
          `tasks/${taskId}/events?after=${cursor}`,
          undefined,
          "GET",
          controller.signal,
        )
        if (controller.signal.aborted) return
        const next = batch
          .filter((e) => e.id > cursor)
          .sort((a, b) => a.id - b.id)
        if (next.length) {
          cursor = next[next.length - 1].id
          events = [...events, ...next]
        }
        setState({ id: taskId, events, error: "" })
        timer = setTimeout(poll, batch.length >= 500 ? 0 : 1500)
      } catch (e) {
        if (controller.signal.aborted) return
        setState({
          id: taskId,
          events,
          error:
            e instanceof Error ? e.message : "Progress connection interrupted",
        })
        timer = setTimeout(poll, 4000)
      }
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [taskId])
  return state.id === taskId ? state : { id: taskId, events: [], error: "" }
}
