import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AxiosError } from "axios"
import { useEffect } from "react"
import { z } from "zod"
import { type ProjectPublic, ProjectsService } from "@/client"
import useAuth from "@/hooks/useAuth"

export type WorkspaceProject = ProjectPublic
export type WorkspaceProjectMember = NonNullable<
  ProjectPublic["members"]
>[number]

export const projectsKey = ["workspace-projects"] as const

export function membersOfKind(
  project: WorkspaceProject,
  kind: WorkspaceProjectMember["kind"],
): WorkspaceProjectMember[] {
  return (project.members ?? []).filter((member) => member.kind === kind)
}

function useProjectsKey() {
  const { user } = useAuth()
  return [...projectsKey, user?.id] as const
}

export function projectErrorText(error: unknown, fallback: string): string {
  if (error instanceof AxiosError) {
    const detail = (error.response?.data as { detail?: unknown })?.detail
    if (typeof detail === "string") return detail
  }
  return error instanceof Error && error.message ? error.message : fallback
}

// Projects belong to the platform account now; only task/video references live here.
export function useWorkspaceProjects() {
  const { user } = useAuth()
  return useQuery({
    queryKey: useProjectsKey(),
    enabled: !!user,
    queryFn: async () => {
      const { data } = await ProjectsService.listProjects()
      return data.data
    },
    retry: false,
  })
}

export function useCreateProject() {
  const client = useQueryClient()
  const key = useProjectsKey()
  return useMutation({
    mutationFn: async (name: string) => {
      const { data } = await ProjectsService.createProject({
        body: { name },
      })
      return data
    },
    onSuccess: (project) => {
      client.setQueryData<ProjectPublic[]>(key, (old) =>
        old ? [...old, project] : [project],
      )
    },
  })
}

export function useRenameProject() {
  const client = useQueryClient()
  const key = useProjectsKey()
  return useMutation({
    mutationFn: async ({
      projectId,
      name,
    }: {
      projectId: string
      name: string
    }) => {
      const { data } = await ProjectsService.renameProject({
        path: { project_id: projectId },
        body: { name },
      })
      return data
    },
    onSuccess: (project) => {
      client.setQueryData<ProjectPublic[]>(key, (old) =>
        old
          ? old.map((item) => (item.id === project.id ? project : item))
          : old,
      )
    },
  })
}

export function useDeleteProject() {
  const client = useQueryClient()
  const key = useProjectsKey()
  return useMutation({
    mutationFn: (projectId: string) =>
      ProjectsService.deleteProject({
        path: { project_id: projectId },
      }),
    onSuccess: (_result, projectId) => {
      client.setQueryData<ProjectPublic[]>(key, (old) =>
        old ? old.filter((item) => item.id !== projectId) : old,
      )
    },
  })
}

export function useAddProjectMember() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({
      projectId,
      kind,
      id,
      label,
    }: {
      projectId: string
      kind: WorkspaceProjectMember["kind"]
      id: string
      label?: string | null
    }) => {
      await ProjectsService.addProjectMember({
        path: { project_id: projectId },
        body: { kind, id, label: label ?? null },
      })
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: projectsKey })
    },
  })
}

export function useRemoveProjectMember() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({
      projectId,
      kind,
      id,
    }: {
      projectId: string
      kind: WorkspaceProjectMember["kind"]
      id: string
    }) =>
      ProjectsService.removeProjectMember({
        path: { project_id: projectId, member_kind: kind, member_id: id },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: projectsKey })
    },
  })
}

/** Replace the agent-task membership of one project with `taskIds`. */
export function useSaveProjectTasks() {
  const client = useQueryClient()
  const key = useProjectsKey()
  return useMutation({
    mutationFn: async ({
      projectId,
      taskIds,
    }: {
      projectId: string
      taskIds: string[]
    }) => {
      const project = (client.getQueryData<ProjectPublic[]>(key) ?? []).find(
        (item) => item.id === projectId,
      )
      const current = project ? membersOfKind(project, "agent_task") : []
      const currentIds = new Set(current.map((member) => member.id))
      const nextIds = new Set(taskIds)
      for (const taskId of nextIds) {
        if (!currentIds.has(taskId)) {
          await ProjectsService.addProjectMember({
            path: { project_id: projectId },
            body: { kind: "agent_task", id: taskId, label: null },
          })
        }
      }
      for (const member of current) {
        if (!nextIds.has(member.id)) {
          await ProjectsService.removeProjectMember({
            path: {
              project_id: projectId,
              member_kind: "agent_task",
              member_id: member.id,
            },
          })
        }
      }
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: projectsKey })
    },
  })
}

// Shape of the pre-entity localStorage folders (lingsight.workspace-projects.v1).
const legacyProjectsSchema = z
  .array(
    z.object({
      id: z.string().min(1),
      name: z.string().trim().min(1).max(80),
      taskIds: z.array(z.string()).max(5000),
    }),
  )
  .max(100)

const legacyKey = (userId: string) =>
  `lingsight.workspace-projects.v1:${userId}`
const migratedKey = (userId: string) =>
  `lingsight.workspace-projects.migrated.v1:${userId}`

/**
 * One-time import of the pre-entity browser folders into the account.
 * The server import is idempotent (existing names are skipped untouched), and
 * the per-browser flag keeps deleted projects from being resurrected later.
 */
export function useLegacyProjectImport() {
  const { user } = useAuth()
  const client = useQueryClient()
  useEffect(() => {
    const userId = user?.id
    if (!userId) return
    if (localStorage.getItem(migratedKey(userId)) !== null) return
    const raw = localStorage.getItem(legacyKey(userId))
    if (raw === null) {
      localStorage.setItem(migratedKey(userId), "1")
      return
    }
    let legacy: z.infer<typeof legacyProjectsSchema>
    try {
      legacy = legacyProjectsSchema.parse(JSON.parse(raw))
    } catch {
      // Unreadable local state: never block the workspace on it again.
      localStorage.setItem(migratedKey(userId), "1")
      return
    }
    ProjectsService.importProjects({
      body: {
        projects: legacy.map((project) => ({
          name: project.name,
          task_ids: project.taskIds,
        })),
      },
    })
      .then(() => {
        localStorage.setItem(migratedKey(userId), "1")
        localStorage.removeItem(legacyKey(userId))
        void client.invalidateQueries({ queryKey: projectsKey })
      })
      .catch(() => {
        // Flag stays unset so a transient failure retries on the next load.
      })
  }, [user?.id, client])
}
