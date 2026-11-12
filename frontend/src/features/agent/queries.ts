import { useQuery } from "@tanstack/react-query"
import { agentRoutes } from "@/lib/upstreamRoutes.gen"
import { agentJson, type Task, tasksKey } from "./api"
import { useVideoWorkflows, videoWorkflowTask } from "./videoWorkflow"

export function useTasks() {
  const mockTasks = useVideoWorkflows()
  const query = useQuery({
    queryKey: tasksKey,
    queryFn: ({ signal }) =>
      agentJson<Task[]>(agentRoutes.tasks(), undefined, "GET", signal),
    refetchInterval: 5000,
    retry: false,
  })
  return mockTasks.length
    ? {
        ...query,
        data: [...mockTasks.map(videoWorkflowTask), ...(query.data ?? [])],
      }
    : query
}
