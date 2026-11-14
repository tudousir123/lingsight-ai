export type VideoSource = "cloud" | "local"
export type AnalysisMode = "video" | "day"

export type ResearchVideo = {
  id: string
  name: string
  source: VideoSource
  trainingDay: number | null
}

export type ResearchProject = { id: string; name: string }
export type InferenceRun = { id: string; videoCount: number }
type VideoMetrics = {
  video: ResearchVideo
  latency: number
  pathLength: number
}

export type ResearchReport = {
  mode: AnalysisMode
  rows: { label: string; count: number; latency: number; pathLength: number }[]
}

// Tool inputs are serializable. Progress is delivered separately so the
// conversation does not need to pass video payloads or frame-level results.
export interface ResearchTools {
  create_project(input: { name: string }): Promise<ResearchProject>
  list_cloud_videos(): Promise<ResearchVideo[]>
  add_project_videos(input: {
    projectId: string
    videos: ResearchVideo[]
  }): Promise<ResearchVideo[]>
  run_video_inference(
    input: { projectId: string },
    onProgress: (processed: number) => void,
  ): Promise<InferenceRun>
  analyze_results(input: {
    projectId: string
    inferenceId: string
    mode: AnalysisMode
  }): Promise<ResearchReport>
}

const cloudVideos: ResearchVideo[] = [
  {
    id: "d1-t1",
    name: "Day 1 · Trial 01.mp4",
    source: "cloud",
    trainingDay: 1,
  },
  {
    id: "d1-t2",
    name: "Day 1 · Trial 02.mp4",
    source: "cloud",
    trainingDay: 1,
  },
  {
    id: "d5-t1",
    name: "Day 5 · Trial 01.mp4",
    source: "cloud",
    trainingDay: 5,
  },
  {
    id: "d5-t2",
    name: "Day 5 · Trial 02.mp4",
    source: "cloud",
    trainingDay: 5,
  },
]

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms))
}

export function hasComparableDays(videos: ResearchVideo[]) {
  const days = videos.map((video) => video.trainingDay)
  return !days.includes(null) && new Set(days).size >= 2
}

export function createMockResearchTools(): ResearchTools {
  const projectVideos = new Map<string, ResearchVideo[]>()
  const inferences = new Map<
    string,
    { projectId: string; results: VideoMetrics[] }
  >()

  return {
    async create_project({ name }) {
      await delay(220)
      const project = { id: crypto.randomUUID(), name }
      projectVideos.set(project.id, [])
      return project
    },

    async list_cloud_videos() {
      return cloudVideos
    },

    async add_project_videos({ projectId, videos }) {
      if (!projectVideos.has(projectId)) throw new Error("项目不存在。")
      await delay(180)
      projectVideos.set(projectId, videos)
      return videos
    },

    async run_video_inference({ projectId }, onProgress) {
      const videos = projectVideos.get(projectId)
      if (!videos?.length) throw new Error("请先将视频加入当前项目。")
      const results: VideoMetrics[] = []
      for (const [index, video] of videos.entries()) {
        await delay(420)
        // Fixed demonstration values. The tool never reads the video payload.
        const laterDay = video.trainingDay === 5
        results.push({
          video,
          latency: (laterDay ? 24 : 46) + (index % 3) * 3,
          pathLength: (laterDay ? 315 : 580) + (index % 3) * 20,
        })
        onProgress(results.length)
      }
      const run = { id: crypto.randomUUID(), videoCount: results.length }
      inferences.set(run.id, { projectId, results })
      return run
    },

    async analyze_results({ projectId, inferenceId, mode }) {
      const inference = inferences.get(inferenceId)
      if (inference?.projectId !== projectId) {
        throw new Error("请先完成当前项目的视频推理。")
      }
      const results = inference.results
      if (
        mode === "day" &&
        !hasComparableDays(results.map(({ video }) => video))
      ) {
        throw new Error(
          "按训练日对比需要为全部视频标记训练日，且至少有两个训练日。",
        )
      }

      await delay(350)
      const groups = new Map<string, VideoMetrics[]>()
      const ordered =
        mode === "day"
          ? [...results].sort(
              (a, b) => (a.video.trainingDay ?? 0) - (b.video.trainingDay ?? 0),
            )
          : results

      for (const result of ordered) {
        const { video } = result
        const key = mode === "day" ? String(video.trainingDay) : video.id
        const group = groups.get(key)
        if (group) group.push(result)
        else groups.set(key, [result])
      }

      return {
        mode,
        rows: Array.from(groups.values(), (group) => ({
          label:
            mode === "day"
              ? `第 ${group[0].video.trainingDay} 天`
              : group[0].video.name,
          count: group.length,
          latency:
            group.reduce((sum, row) => sum + row.latency, 0) / group.length,
          pathLength:
            group.reduce((sum, row) => sum + row.pathLength, 0) / group.length,
        })),
      }
    },
  }
}
