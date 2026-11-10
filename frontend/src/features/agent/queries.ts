import { useQuery } from "@tanstack/react-query"
import { agentJson, type Task, tasksKey } from "./api"
export function useTasks() {
  return useQuery({
    queryKey: tasksKey,
    queryFn: ({ signal }) =>
      agentJson<Task[]>("tasks", undefined, "GET", signal),
    refetchInterval: 5000,
    retry: false,
  })
}
