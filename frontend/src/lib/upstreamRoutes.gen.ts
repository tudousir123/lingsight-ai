// AUTO-GENERATED FILE — DO NOT EDIT.
// Regenerate with: cd backend && uv run python scripts/export_frontend_routes.py
// Source of truth: the operation tables in backend/app/api/routes/*.py;
// backend/tests/scripts/test_export_frontend_routes.py fails on drift.

export const agentGatewayBase = "/api/v1/agent"
export const inferenceGatewayBase = "/api/v1/inference"

export const agentRoutes = {
  artifactsByArtifactId: (artifactId: string) => `artifacts/${artifactId}`,
  runsByRunId: (runId: string) => `runs/${runId}`,
  runsByRunIdCancel: (runId: string) => `runs/${runId}/cancel`,
  runsByRunIdClarificationsByClarificationIdAnswer: (runId: string, clarificationId: string) => `runs/${runId}/clarifications/${clarificationId}/answer`,
  runsByRunIdResume: (runId: string) => `runs/${runId}/resume`,
  tasks: () => `tasks`,
  tasksByTaskId: (taskId: string) => `tasks/${taskId}`,
  tasksByTaskIdBundle: (taskId: string) => `tasks/${taskId}/bundle`,
  tasksByTaskIdEvents: (taskId: string) => `tasks/${taskId}/events`,
  tasksByTaskIdMessages: (taskId: string) => `tasks/${taskId}/messages`,
} as const

export type InferenceArtifactName = "candidate.jpg" | "overlay.mp4" | "tracking.json" | "keypoints.json" | "provenance.json"

export const inferenceRoutes = {
  tasks: () => `tasks`,
  tasksByTaskId: (taskId: string) => `tasks/${taskId}`,
  tasksByTaskIdArtifactsByArtifactName: (taskId: string, artifactName: InferenceArtifactName) => `tasks/${taskId}/artifacts/${artifactName}`,
  tasksByTaskIdCancel: (taskId: string) => `tasks/${taskId}/cancel`,
  tasksByTaskIdConfirm: (taskId: string) => `tasks/${taskId}/confirm`,
  tasksByTaskIdRetry: (taskId: string) => `tasks/${taskId}/retry`,
  tasksByTaskIdReview: (taskId: string) => `tasks/${taskId}/review`,
  videos: () => `videos`,
} as const
