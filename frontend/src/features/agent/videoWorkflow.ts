import { useSyncExternalStore } from "react"
import type { RunStatus, Task } from "./api"

export const videoWorkflowEnabled =
  import.meta.env.VITE_MOCK_VIDEO_WORKFLOW === "true"
export const videoWorkflowSampleUrl = import.meta.env
  .VITE_MOCK_VIDEO_OVERLAY_URL

export const videoStages = [
  "上传视频",
  "预标注",
  "人工核对",
  "正式推理",
  "核对入库",
  "导入 MySQL",
  "分析数据库",
] as const
export type WorkflowVideo = {
  id: string
  name: string
  source: "local" | "drive"
}
export type InferenceRow = {
  video: string
  frames: number
  latency: number
  coverage: number
}
export type WorkflowAnalysis = { question: string; answer: string }
export type VideoWorkflow = {
  id: string
  projectId?: string
  createdAt: string
  videos: WorkflowVideo[]
  goal: string
  stage: number
  nextAt: number | null
  annotationVersion: number
  inferenceVersion: number
  feedback: { stage: number; note: string }[]
  rows: InferenceRow[]
  mysqlRows: InferenceRow[]
  analyses: WorkflowAnalysis[]
}

export const driveVideos: WorkflowVideo[] = [
  { id: "day-1", name: "训练第 1 天 · 试次 01.mp4", source: "drive" },
  { id: "day-3", name: "训练第 3 天 · 试次 01.mp4", source: "drive" },
  { id: "day-5", name: "训练第 5 天 · 试次 01.mp4", source: "drive" },
]
export const defaultAnalysisQuestion = "汇总逐帧数据和各视频的逃逸潜伏期"

function scheduled(stage: number) {
  return { stage, nextAt: Date.now() + 850 }
}

// Each operation takes the approved output of the preceding operation.
// The browser mock stores file names and simulated rows only.
const mockVideoTools = {
  preAnnotate: (flow: VideoWorkflow) => flow.annotationVersion + 1,
  infer: (flow: VideoWorkflow): InferenceRow[] =>
    flow.videos.map((video, index) => ({
      video: video.name,
      frames: 900 + index * 120,
      latency: Math.round(Math.max(12.4, 29.8 - index * 6.2) * 10) / 10,
      coverage: Math.max(91, 98 - index),
    })),
  importMysql: (flow: VideoWorkflow) => flow.rows.map((row) => ({ ...row })),
  analyzeMysql: (rows: InferenceRow[], question: string): WorkflowAnalysis => {
    const frames = rows.reduce((total, row) => total + row.frames, 0)
    const mean = (key: "latency" | "coverage") =>
      (rows.reduce((total, row) => total + row[key], 0) / rows.length).toFixed(
        1,
      )
    const latency = `平均逃逸潜伏期 ${mean("latency")} 秒`
    const coverage = `平均有效轨迹覆盖率 ${mean("coverage")}%`
    const metrics =
      /覆盖率|有效轨迹/.test(question) && !/潜伏期/.test(question)
        ? coverage
        : /潜伏期/.test(question) && !/覆盖率|轨迹/.test(question)
          ? latency
          : `${latency}，${coverage}`
    const summary = `读取 ${rows.length} 段视频的模拟记录，共 ${frames.toLocaleString("zh-CN")} 帧。${metrics}（按视频等权）。`
    const comparison = /显著|组间|训练日|按天|分组/.test(question)
      ? "示例记录缺少已核对的动物身份和分组，只能做视频级描述统计。"
      : ""
    return { question, answer: [summary, comparison].filter(Boolean).join(" ") }
  },
}

export function createVideoWorkflow(
  videos: WorkflowVideo[],
  goal: string,
  projectId?: string,
): VideoWorkflow {
  return {
    id: `video-workflow-${crypto.randomUUID()}`,
    projectId,
    createdAt: new Date().toISOString(),
    videos,
    goal,
    ...scheduled(0),
    annotationVersion: 0,
    inferenceVersion: 0,
    feedback: [],
    rows: [],
    mysqlRows: [],
    analyses: [],
  }
}

export function finishVideoTool(flow: VideoWorkflow): VideoWorkflow {
  switch (flow.stage) {
    case 0:
      return { ...flow, ...scheduled(1) }
    case 1:
      return {
        ...flow,
        stage: 2,
        nextAt: null,
        annotationVersion: mockVideoTools.preAnnotate(flow),
      }
    case 3:
      return {
        ...flow,
        stage: 4,
        nextAt: null,
        inferenceVersion: flow.inferenceVersion + 1,
        rows: mockVideoTools.infer(flow),
      }
    case 5:
      return {
        ...flow,
        stage: 6,
        nextAt: null,
        mysqlRows: mockVideoTools.importMysql(flow),
      }
    default:
      return flow
  }
}

export function reviewVideoTool(flow: VideoWorkflow, note?: string) {
  if (flow.stage !== 2 && flow.stage !== 4) return flow
  if (!note) return { ...flow, ...scheduled(flow.stage + 1) }
  return {
    ...flow,
    ...scheduled(flow.stage - 1),
    feedback: [...flow.feedback, { stage: flow.stage, note }],
  }
}

export function analyzeVideoWorkflow(flow: VideoWorkflow, question: string) {
  if (flow.stage < 6 || !flow.mysqlRows.length) return flow
  return {
    ...flow,
    stage: 7,
    analyses: [
      ...flow.analyses,
      mockVideoTools.analyzeMysql(flow.mysqlRows, question),
    ],
  }
}

const storageKey = "lingsight.mock-video-workflows.v1"
const empty: VideoWorkflow[] = []
const listeners = new Set<() => void>()
let serialized: string | null = null
let snapshot = empty

function readWorkflows() {
  if (!videoWorkflowEnabled) return empty
  try {
    const stored = localStorage.getItem(storageKey)
    if (stored !== serialized) {
      serialized = stored
      const parsed = stored ? JSON.parse(stored) : empty
      snapshot = Array.isArray(parsed) ? parsed : empty
    }
  } catch {
    // An unavailable store still allows the active preview to run in memory.
  }
  return snapshot
}

function notifyWorkflows() {
  for (const listener of listeners) listener()
}

function subscribeWorkflows(listener: () => void) {
  listeners.add(listener)
  window.addEventListener("storage", listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

export function useVideoWorkflows() {
  return useSyncExternalStore(subscribeWorkflows, readWorkflows)
}

export function saveVideoWorkflow(flow: VideoWorkflow) {
  snapshot = [flow, ...readWorkflows().filter((item) => item.id !== flow.id)]
  const next = JSON.stringify(snapshot)
  try {
    localStorage.setItem(storageKey, next)
    serialized = next
  } catch {
    // Continue the active preview in memory when storage is unavailable.
  }
  notifyWorkflows()
}

export function videoWorkflowTask(flow: VideoWorkflow): Task {
  const status: RunStatus =
    flow.stage === 7
      ? "succeeded"
      : flow.nextAt
        ? "running"
        : "waiting_for_input"
  return {
    id: flow.id,
    project_id: flow.projectId,
    title:
      flow.goal ||
      (flow.videos.length === 1 ? flow.videos[0].name : "视频行为分析"),
    goal: flow.goal,
    created_at: flow.createdAt,
    runs: [{ id: flow.id, instruction: flow.goal, status, error: null }],
  }
}
