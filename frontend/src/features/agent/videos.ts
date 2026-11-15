// Project-scoped video surface (ADR-0019). The generated SDK leaves the
// upload/list/workspace/preannotation bodies untyped, so the response shapes
// this UI consumes are pinned here from the #69 contract.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { PreannotationsService, UsersService, VideosService } from "@/client"
import useAuth from "@/hooks/useAuth"
import { withTokenQuery } from "@/lib/credentials"

export {
  formatBytes,
  MAX_UPLOAD_BYTES,
  UPLOAD_EXTENSIONS,
  uploadPrecheck,
} from "./uploadRules"

export type WorkspaceInfo = {
  user_id: string
  workspace_enabled: boolean
  whole_library_access: boolean
  allowed_experiment_ids: string[]
  upload: { max_bytes: number; extensions: string[] }
}

export type ProjectVideo = {
  video_id: string
  project_id: string
  source_id: string
  source_kind: "user_upload"
  filename: string
  format: "mp4" | "avi"
  bytes: number
  sha256: string
  width: number
  height: number
  frame_count: number
  fps: number
  created_at: string
  media_url: string
  preview_url?: string
  inference_ready: boolean
}

export type Seed = { frame: number; x: number; y: number }
export type Pool = { cx: number; cy: number; radius: number }
export type Polygon = [number, number][]
export type CandidateMark = {
  label: string
  polygon: Polygon | null
  confidence?: number
}
export type ConfirmedMark = { label: string; polygon: Polygon }

export type Preannotation = {
  project_id: string
  video_id: string
  task_id: string
  candidate_version: string
  video_sha256: string
  frame_index: number
  width: number
  height: number
  frame_count: number
  image_url: string
  seed: Seed | null
  pool: Pool | null
  marks: CandidateMark[]
  evidence: { review_reasons: string[] }
}

export type TrackingDispatch = {
  status: "pending" | "accepted" | "failed"
  error_code: string | null
}

export type Confirmation = {
  id: string
  project_id: string
  video_id: string
  task_id: string
  candidate_version: string
  video_sha256: string
  width: number
  height: number
  frame_count: number
  seed: Seed
  pool: Pool
  marks: ConfirmedMark[]
  confirmed_by: string
  confirmed_at: string
  tracking_dispatch: TrackingDispatch
}

export type ConfirmationInput = {
  task_id: string
  candidate_version: string
  expected_confirmation_id: string | null
  seed: Seed
  pool: Pool
  marks: ConfirmedMark[]
}

// Media elements cannot send Authorization; the server accepts ?token=.
export const mediaSrc = (path: string) => withTokenQuery(path)

export const workspaceKey = (userId?: string) =>
  ["workspace-info", userId] as const
export const projectVideosKey = (projectId: string) =>
  ["project-videos", projectId] as const
export const confirmationKey = (projectId: string, videoId: string) =>
  ["preannotation-confirmation", projectId, videoId] as const

export function hasLibraryScope(workspace?: WorkspaceInfo): boolean {
  return (
    !!workspace &&
    (workspace.whole_library_access ||
      workspace.allowed_experiment_ids.length > 0)
  )
}

export function useWorkspaceInfo() {
  const { user } = useAuth()
  return useQuery({
    queryKey: workspaceKey(user?.id),
    enabled: !!user,
    queryFn: async () =>
      (await UsersService.readWorkspace()).data as unknown as WorkspaceInfo,
    retry: false,
  })
}

export function useProjectVideos(projectId: string | undefined) {
  return useQuery({
    queryKey: projectVideosKey(projectId ?? ""),
    enabled: !!projectId,
    queryFn: async () => {
      // Pagination is capped by the server at 100; follow it so the list is complete.
      const videos: ProjectVideo[] = []
      for (let offset = 0; ; offset += 100) {
        const page = (
          await VideosService.listVideos({
            path: { project_id: projectId as string },
            query: { offset, limit: 100 },
          })
        ).data as unknown as { data: ProjectVideo[]; count: number }
        videos.push(...page.data)
        if (!page.data.length || videos.length >= page.count) return videos
      }
    },
    retry: false,
  })
}

export function useUploadVideo(projectId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({
      file,
      idempotencyKey,
      onProgress,
      signal,
    }: {
      file: File
      idempotencyKey: string
      onProgress?: (fraction: number) => void
      signal?: AbortSignal
    }) => {
      const body = new FormData()
      body.append("file", file)
      const response = await VideosService.uploadVideo({
        path: { project_id: projectId },
        body: body as never,
        headers: { "Idempotency-Key": idempotencyKey },
        signal,
        onUploadProgress: (event) => {
          if (event.total) onProgress?.(event.loaded / event.total)
        },
      })
      return response.data as unknown as ProjectVideo
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: projectVideosKey(projectId) }),
  })
}

export async function fetchPreannotation(
  projectId: string,
  videoId: string,
  taskId: string,
  signal?: AbortSignal,
) {
  return (
    await PreannotationsService.getPreannotation({
      path: { project_id: projectId, video_id: videoId },
      query: { task_id: taskId },
      signal,
    })
  ).data as unknown as Preannotation
}

export async function fetchConfirmation(
  projectId: string,
  videoId: string,
  signal?: AbortSignal,
) {
  return (
    await PreannotationsService.getConfirmation({
      path: { project_id: projectId, video_id: videoId },
      signal,
    })
  ).data as unknown as Confirmation
}

export function useConfirmPreannotation(projectId: string, videoId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({
      input,
      idempotencyKey,
    }: {
      input: ConfirmationInput
      idempotencyKey: string
    }) =>
      (
        await PreannotationsService.confirmPreannotation({
          path: { project_id: projectId, video_id: videoId },
          body: input as never,
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
        })
      ).data as unknown as Confirmation,
    onSuccess: (confirmation) => {
      client.setQueryData(confirmationKey(projectId, videoId), confirmation)
      void client.invalidateQueries({ queryKey: ["inference", "tasks"] })
    },
  })
}
