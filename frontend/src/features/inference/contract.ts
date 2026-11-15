// Field contract for the platform's inference gateway
// (backend/app/api/routes/inference.py, ADR-0019): task/source/directory lists
// are plain arrays and tasks are bound to a project video. The candidate and
// confirmation shapes live in features/agent/videos.ts. Field-shape drift is owned upstream by
// that service's own tests plus the platform e2e smoke; this module only
// pins what the workbench UI consumes.

export type Entry = {
  type: "directory" | "video"
  name: string
  path?: string
  id?: string
}
export type VideoSource = {
  id: string
  label: string
  kind: string
  available: boolean
  error?: { code: string; message: string }
}
export type Task = {
  id: string
  project_id?: string
  video_id: string
  source_kind?: "user_upload" | "filesystem"
  confirmation_id?: string | null
  status: string
  stage: string
  error: string | null
  review: { tracking_ok: boolean; note: string } | null
}
