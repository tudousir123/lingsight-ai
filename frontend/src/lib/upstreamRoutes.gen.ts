// AUTO-GENERATED FILE — DO NOT EDIT.
// Regenerate with: cd backend && uv run python scripts/export_frontend_routes.py
// Sources: backend/app/api/routes/*.py tables and backend/app/contracts.py versions;
// backend/tests/scripts/test_export_frontend_routes.py fails on drift.

export const agentMemoryManagementContract = "memory-management-v1" as const
export const agentResearchMemoryContract = "project-research-memory-v1" as const

export const agentBrowserContract = {
  contract: "controlled-browser-v1",
  profile: "owner-storage-state-v1",
} as const

export const agentGatewayBase = "/api/v1/agent"
export const inferenceGatewayBase = "/api/v1/inference"

export const agentRoutes = {
  artifactsByArtifactId: (artifactId: string) => `artifacts/${artifactId}`,
  capabilities: () => `capabilities`,
  inputs: () => `inputs`,
  memories: () => `memories`,
  memoriesRebuild: () => `memories/rebuild`,
  memoriesByMemoryIdHistory: (memoryId: string) => `memories/${memoryId}/history`,
  memoriesByMemoryIdMutation: (memoryId: string) => `memories/${memoryId}/mutation`,
  personalAgent: () => `personal-agent`,
  runsByRunId: (runId: string) => `runs/${runId}`,
  runsByRunIdBrowserGrants: (runId: string) => `runs/${runId}/browser-grants`,
  runsByRunIdCancel: (runId: string) => `runs/${runId}/cancel`,
  runsByRunIdClarificationsByClarificationIdAnswer: (runId: string, clarificationId: string) => `runs/${runId}/clarifications/${clarificationId}/answer`,
  runsByRunIdOperations: (runId: string) => `runs/${runId}/operations`,
  runsByRunIdOperationsByOperationIdResolve: (runId: string, operationId: string) => `runs/${runId}/operations/${operationId}/resolve`,
  runsByRunIdOperationsByOperationIdVerify: (runId: string, operationId: string) => `runs/${runId}/operations/${operationId}/verify`,
  runsByRunIdResume: (runId: string) => `runs/${runId}/resume`,
  tasks: () => `tasks`,
  tasksByTaskId: (taskId: string) => `tasks/${taskId}`,
  tasksByTaskIdBundle: (taskId: string) => `tasks/${taskId}/bundle`,
  tasksByTaskIdEvents: (taskId: string) => `tasks/${taskId}/events`,
  tasksByTaskIdMemories: (taskId: string) => `tasks/${taskId}/memories`,
  tasksByTaskIdMessages: (taskId: string) => `tasks/${taskId}/messages`,
  tasksByTaskIdResearchMemories: (taskId: string) => `tasks/${taskId}/research-memories`,
  tasksByTaskIdResearchMemoriesRebuild: (taskId: string) => `tasks/${taskId}/research-memories/rebuild`,
  tasksByTaskIdResearchMemoriesByMemoryIdDecision: (taskId: string, memoryId: string) => `tasks/${taskId}/research-memories/${memoryId}/decision`,
  tasksByTaskIdResearchMemoriesByMemoryIdHistory: (taskId: string, memoryId: string) => `tasks/${taskId}/research-memories/${memoryId}/history`,
  tasksByTaskIdResearchMemoriesByMemoryIdMutation: (taskId: string, memoryId: string) => `tasks/${taskId}/research-memories/${memoryId}/mutation`,
} as const

export type InferenceArtifactName = "candidate.jpg" | "overlay.mp4" | "tracking.json" | "keypoints.json" | "provenance.json"

export const inferenceRoutes = {
  sources: () => `sources`,
  tasks: () => `tasks`,
  tasksByTaskId: (taskId: string) => `tasks/${taskId}`,
  tasksByTaskIdArtifactsByArtifactName: (taskId: string, artifactName: InferenceArtifactName) => `tasks/${taskId}/artifacts/${artifactName}`,
  tasksByTaskIdCancel: (taskId: string) => `tasks/${taskId}/cancel`,
  tasksByTaskIdConfirm: (taskId: string) => `tasks/${taskId}/confirm`,
  tasksByTaskIdRetry: (taskId: string) => `tasks/${taskId}/retry`,
  tasksByTaskIdReview: (taskId: string) => `tasks/${taskId}/review`,
  videos: () => `videos`,
} as const
