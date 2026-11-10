import { useQuery, useQueryClient } from "@tanstack/react-query"
import { z } from "zod"
import useAuth from "@/hooks/useAuth"

const projectsSchema = z
  .array(
    z.object({
      id: z.string().min(1),
      name: z.string().trim().min(1).max(80),
      taskIds: z.array(z.string()).max(5000),
    }),
  )
  .max(100)
export type WorkspaceProject = z.infer<typeof projectsSchema>[number]
const defaultProjects: WorkspaceProject[] = [
  { id: "learning-memory", name: "学习与记忆", taskIds: [] },
  { id: "behavior-notes", name: "动物行为研究笔记", taskIds: [] },
]

// Only folder names and task IDs are stored here; tasks remain owned by the Agent.
export function useWorkspaceProjects() {
  const { user } = useAuth()
  const client = useQueryClient()
  const key = ["workspace-projects", user?.id]
  const storageKey = `lingsight.workspace-projects.v1:${user?.id}`
  const query = useQuery({
    queryKey: key,
    enabled: !!user?.id,
    queryFn: () => {
      const raw = localStorage.getItem(storageKey)
      return raw ? projectsSchema.parse(JSON.parse(raw)) : defaultProjects
    },
    retry: false,
    staleTime: Infinity,
  })
  function save(projects: WorkspaceProject[]) {
    if (!user?.id || query.isPending || query.error)
      throw new Error("项目暂不可用，请刷新后重试。")
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify(projectsSchema.parse(projects)),
      )
    } catch {
      throw new Error("当前浏览器无法保存项目，已保留你的修改，请重试。")
    }
    client.setQueryData(key, projects)
  }
  return { ...query, projects: query.data ?? [], save }
}
