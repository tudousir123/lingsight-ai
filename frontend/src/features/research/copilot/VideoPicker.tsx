import { Check, Cloud, FileVideo, FolderOpen } from "lucide-react"
import { type ChangeEvent, useEffect, useState } from "react"
import type { ResearchTools, ResearchVideo, VideoSource } from "./tools"

const videoExtensions = /\.(mp4|mov|avi|mkv|webm|m4v|mpeg|mpg)$/i

function localVideos(event: ChangeEvent<HTMLInputElement>): ResearchVideo[] {
  return Array.from(event.target.files ?? [])
    .filter(
      (file) =>
        file.type.startsWith("video/") || videoExtensions.test(file.name),
    )
    .map((file) => ({
      id: `local:${file.name}:${file.size}:${file.lastModified}`,
      name: file.name,
      source: "local",
      trainingDay: null,
    }))
}

export function VideoPicker({
  source,
  onSourceChange,
  onConfirm,
  tools,
  busy,
}: {
  source: VideoSource | null
  onSourceChange: (source: VideoSource) => void
  onConfirm: (videos: ResearchVideo[]) => void
  tools: ResearchTools
  busy: boolean
}) {
  const [cloud, setCloud] = useState<ResearchVideo[]>([])
  const [local, setLocal] = useState<ResearchVideo[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (source !== "cloud") return
    let current = true
    setLoading(true)
    setError("")
    void tools
      .list_cloud_videos()
      .then((items) => {
        if (current) setCloud(items)
      })
      .catch(() => {
        if (current) setError("网盘目录读取失败，请切换来源后重试。")
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [source, tools])

  const cloudSelection = cloud.filter(({ id }) => selected.includes(id))
  const videos = source === "cloud" ? cloudSelection : local

  return (
    <section className="copilot-card" aria-labelledby="copilot-video-heading">
      <h2 id="copilot-video-heading">选择本次分析的视频</h2>
      <div className="copilot-controls">
        <button
          type="button"
          className="copilot-button"
          aria-pressed={source === "cloud"}
          onClick={() => onSourceChange("cloud")}
        >
          <Cloud size={16} /> 网盘（示例）
        </button>
        <button
          type="button"
          className="copilot-button"
          aria-pressed={source === "local"}
          onClick={() => onSourceChange("local")}
        >
          <FolderOpen size={16} /> 本地文件
        </button>
      </div>
      {source === "cloud" && (
        <fieldset className="copilot-file-list">
          <legend>水迷宫 / 训练期</legend>
          {loading && <p role="status">正在读取网盘目录…</p>}
          {error && <p role="alert">{error}</p>}
          {cloud.map((video) => (
            <label className="copilot-file" key={video.id}>
              <input
                type="checkbox"
                checked={selected.includes(video.id)}
                onChange={(event) => {
                  const checked = event.target.checked
                  setSelected((current) =>
                    checked
                      ? [...current, video.id]
                      : current.filter((id) => id !== video.id),
                  )
                }}
              />
              <FileVideo size={15} /> <span>{video.name}</span>
              <small>训练第 {video.trainingDay} 天</small>
            </label>
          ))}
        </fieldset>
      )}
      {source === "local" && (
        <div className="copilot-local">
          <label className="copilot-button copilot-local-button">
            <FolderOpen size={16} /> 选择视频文件
            <input
              type="file"
              multiple
              accept="video/*,.mkv,.avi"
              aria-label="选择本地视频"
              onChange={(event) => {
                const files = localVideos(event)
                setLocal(
                  Array.from(
                    new Map(files.map((file) => [file.id, file])).values(),
                  ),
                )
              }}
            />
          </label>
          <p>预览只读取文件名等元数据，文件留在本机。</p>
          {local.map((video) => (
            <div className="copilot-file" key={video.id}>
              <FileVideo size={15} /> <span>{video.name}</span>
              <select
                aria-label={`${video.name} 训练日`}
                value={video.trainingDay ?? ""}
                onChange={(event) => {
                  const day = event.target.value
                  setLocal((items) =>
                    items.map((item) =>
                      item.id === video.id
                        ? { ...item, trainingDay: day ? Number(day) : null }
                        : item,
                    ),
                  )
                }}
              >
                <option value="">训练日未标记</option>
                {[1, 2, 3, 4, 5].map((day) => (
                  <option key={day} value={day}>
                    第 {day} 天
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
      {source && (
        <div className="copilot-card-footer">
          <span>已选 {videos.length} 个视频</span>
          <button
            className="copilot-button copilot-primary"
            type="button"
            disabled={busy || !videos.length}
            onClick={() => onConfirm(videos)}
          >
            <Check size={16} /> 加入项目
          </button>
        </div>
      )}
    </section>
  )
}
