// Field contract for the video inference service (lingsight-inference,
// private repo). True source: that service's FastAPI /v1 interface (videos
// directory listing, tasks lifecycle, pre-annotation candidate, review) and
// its artifact set — the platform gateway forwards at
// backend/app/api/routes/inference.py. Field-shape drift is owned upstream by
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
export type Point = [number, number]
export type Mark = {
  label: string
  polygon: Point[] | null
  confidence?: number
}
export type Candidate = {
  width: number
  height: number
  frame_count: number
  seed: { frame: number; x: number; y: number } | null
  pool: { cx: number; cy: number; radius: number } | null
  marks: Mark[]
  evidence: { review_reasons: string[] }
}
export type Task = {
  id: string
  video_id: string
  status: string
  stage: string
  error: string | null
  candidate: Candidate | null
  confirmed: unknown
  review: { tracking_ok: boolean; note: string } | null
}
