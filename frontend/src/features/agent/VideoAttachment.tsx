import { Cloud, FileVideo, Paperclip, Upload, X } from "lucide-react"
import { useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { driveVideos, type WorkflowVideo } from "./videoWorkflow"
import "./video-workflow.css"

export function VideoAttachment({
  open,
  onOpenChange,
  source,
  onSourceChange,
  videos,
  onChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  source: WorkflowVideo["source"]
  onSourceChange: (source: WorkflowVideo["source"]) => void
  videos: WorkflowVideo[]
  onChange: (videos: WorkflowVideo[]) => void
}) {
  const localInput = useRef<HTMLInputElement>(null)
  const [checked, setChecked] = useState<string[]>([])
  const [error, setError] = useState("")
  const close = (next: boolean) => {
    onOpenChange(next)
    if (!next) {
      setError("")
      setChecked([])
    }
  }
  const add = (items: WorkflowVideo[]) => {
    const next = new Map(videos.map((video) => [video.id, video]))
    for (const item of items) next.set(item.id, item)
    onChange([...next.values()])
    close(false)
  }

  return (
    <>
      <button
        type="button"
        className="video-attach-button"
        onClick={() => onOpenChange(true)}
      >
        <Paperclip size={16} />
        上传视频
      </button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="video-source-dialog">
          <DialogHeader>
            <DialogTitle>上传视频</DialogTitle>
            <DialogDescription>
              选择要分析的视频，可添加多段。
            </DialogDescription>
          </DialogHeader>
          <fieldset className="video-source-options" aria-label="视频来源">
            <button
              type="button"
              aria-pressed={source === "local"}
              onClick={() => onSourceChange("local")}
            >
              <Upload size={16} /> 本地文件
            </button>
            <button
              type="button"
              aria-pressed={source === "drive"}
              onClick={() => onSourceChange("drive")}
            >
              <Cloud size={17} /> 网盘
            </button>
          </fieldset>
          {source === "local" ? (
            <>
              <input
                ref={localInput}
                type="file"
                accept="video/*,.mp4,.mov,.avi,.mkv,.webm,.m4v,.mts"
                multiple
                aria-label="选择本地视频文件"
                hidden
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? [])
                  event.currentTarget.value = ""
                  if (!files.length) return
                  if (
                    files.some(
                      (file) =>
                        !file.type.startsWith("video/") &&
                        !/\.(mp4|mov|avi|mkv|webm|m4v|mts)$/i.test(file.name),
                    )
                  ) {
                    setError("请选择视频文件。")
                    return
                  }
                  add(
                    files.map((file) => ({
                      id: `local-${file.name}-${file.size}-${file.lastModified}`,
                      name: file.name,
                      source: "local",
                    })),
                  )
                }}
              />
              <button
                type="button"
                className="video-source-select"
                onClick={() => localInput.current?.click()}
              >
                <Upload size={18} /> 选择本地视频
              </button>
              <p className="video-workflow-muted">
                模拟模式只读取文件名，视频文件留在本地。
              </p>
              {error && (
                <p className="agent-error" role="alert">
                  {error}
                </p>
              )}
            </>
          ) : (
            <>
              <fieldset className="video-source-files">
                <legend>示例网盘 / 水迷宫</legend>
                {driveVideos.map((video) => (
                  <label key={video.id}>
                    <input
                      type="checkbox"
                      checked={checked.includes(video.id)}
                      onChange={(event) =>
                        setChecked((current) =>
                          event.target.checked
                            ? [...current, video.id]
                            : current.filter((id) => id !== video.id),
                        )
                      }
                    />
                    <FileVideo size={16} />
                    {video.name}
                  </label>
                ))}
              </fieldset>
              <button
                type="button"
                className="video-workflow-primary"
                disabled={!checked.length}
                onClick={() =>
                  add(driveVideos.filter((video) => checked.includes(video.id)))
                }
              >
                添加所选视频
              </button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

export function VideoAttachmentList({
  videos,
  onRemove,
}: {
  videos: WorkflowVideo[]
  onRemove?: (id: string) => void
}) {
  return (
    <ul className="video-attachments" aria-label="已选视频">
      {videos.map((video) => (
        <li key={video.id}>
          <FileVideo size={14} />
          <span title={video.name}>{video.name}</span>
          <small>{video.source === "drive" ? "网盘" : "本地"}</small>
          {onRemove && (
            <button
              type="button"
              aria-label={`移除 ${video.name}`}
              onClick={() => onRemove(video.id)}
            >
              <X size={14} />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
