import { Link } from "@tanstack/react-router"
import { FileVideo, Upload } from "lucide-react"
import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { apiProblem, problemText } from "@/lib/apiError"
import { newUuid } from "@/lib/uuid"
import type { WorkspaceProject } from "./projects"
import {
  formatBytes,
  mediaSrc,
  type ProjectVideo,
  uploadPrecheck,
  useProjectVideos,
  useUploadVideo,
} from "./videos"

export function ProjectVideos({
  project,
  onRemove,
  removing,
}: {
  project: WorkspaceProject
  onRemove: (video: ProjectVideo) => void
  removing: boolean
}) {
  const videos = useProjectVideos(project.id)
  const [previewing, setPreviewing] = useState<ProjectVideo | null>(null)
  return (
    <>
      <VideoUpload projectId={project.id} />
      {videos.isPending && <p className="materials-note">正在读取项目视频…</p>}
      {videos.error && (
        <p role="alert">
          {problemText(videos.error, "无法读取项目视频，请稍后重试。")}
          <button
            type="button"
            className="materials-secondary-action"
            onClick={() => void videos.refetch()}
          >
            重试
          </button>
        </p>
      )}
      {videos.isSuccess && videos.data.length > 0 && (
        <ul className="materials-list" aria-label="项目上传视频">
          {videos.data.map((video) => (
            <li key={video.video_id}>
              <FileVideo size={19} aria-hidden="true" />
              <strong>
                {video.filename}
                <small className="block font-normal text-muted-foreground">
                  上传 · {video.format.toUpperCase()} ·{" "}
                  {formatBytes(video.bytes)} · {video.width}×{video.height} ·{" "}
                  {video.frame_count} 帧
                </small>
              </strong>
              <button
                type="button"
                className="materials-secondary-action"
                aria-label={`预览视频 ${video.filename}`}
                onClick={() => setPreviewing(video)}
              >
                预览
              </button>
              <Link
                className="materials-secondary-action"
                to="/inference"
                search={{ project_id: project.id }}
                aria-label={`用 ${video.filename} 做视频推理`}
              >
                视频推理
              </Link>
              <button
                type="button"
                className="materials-secondary-action"
                disabled={removing}
                aria-label={`移出视频 ${video.filename}`}
                onClick={() => onRemove(video)}
              >
                移出
              </button>
            </li>
          ))}
        </ul>
      )}
      {previewing && (
        <Dialog open onOpenChange={(open) => !open && setPreviewing(null)}>
          <DialogContent className="project-dialog sm:max-w-3xl">
            <DialogTitle>{previewing.filename}</DialogTitle>
            <DialogDescription>
              {previewing.format === "avi"
                ? "AVI 使用平台生成的兼容 MP4 预览播放。"
                : "原视频预览。"}
            </DialogDescription>
            <PreviewPlayer video={previewing} />
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

function PreviewPlayer({ video }: { video: ProjectVideo }) {
  const [failed, setFailed] = useState(false)
  // Browsers usually cannot decode AVI; the server provides a MP4 copy.
  const url =
    video.format === "avi" && video.preview_url
      ? video.preview_url
      : video.media_url
  if (failed)
    return <p role="alert">暂时无法播放该视频，请稍后重试或直接开始推理。</p>
  return (
    // biome-ignore lint/a11y/useMediaCaption: 用户上传的科研视频没有字幕轨。
    <video
      className="materials-player"
      src={mediaSrc(url)}
      controls
      playsInline
      preload="metadata"
      aria-label={`播放 ${video.filename}`}
      onError={() => setFailed(true)}
    />
  )
}

const fileIdentity = (file: File) =>
  `${file.name}:${file.size}:${file.lastModified}`

function VideoUpload({ projectId }: { projectId: string }) {
  const upload = useUploadVideo(projectId)
  const [file, setFile] = useState<File | null>(null)
  const [precheck, setPrecheck] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [done, setDone] = useState<ProjectVideo | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const abort = useRef<AbortController | null>(null)
  // The same file keeps its key across retries so a lost response replays
  // instead of creating a second copy; a conflict or success rotates it.
  const key = useRef<{ identity: string; value: string } | null>(null)

  function start() {
    if (!file) return
    const identity = fileIdentity(file)
    if (key.current?.identity !== identity)
      key.current = { identity, value: newUuid() }
    const controller = new AbortController()
    abort.current = controller
    setProgress(0)
    setDone(null)
    upload.mutate(
      {
        file,
        idempotencyKey: key.current.value,
        onProgress: setProgress,
        signal: controller.signal,
      },
      {
        onSuccess: (video) => {
          key.current = null
          setDone(video)
          setFile(null)
          if (input.current) input.current.value = ""
        },
        onError: (error) => {
          if (apiProblem(error).code === "idempotency_conflict")
            key.current = null
        },
      },
    )
  }

  return (
    <div className="space-y-2" data-testid="video-upload">
      <label className="block space-y-1">
        <span className="text-sm">上传视频（mp4 / avi，最大 2 GB）</span>
        <input
          ref={input}
          type="file"
          aria-label="选择视频文件"
          accept=".mp4,.avi,video/mp4,video/x-msvideo"
          disabled={upload.isPending}
          onChange={(event) => {
            const chosen = event.target.files?.[0] ?? null
            setFile(chosen)
            setPrecheck(chosen ? uploadPrecheck(chosen) : null)
            setDone(null)
            upload.reset()
          }}
        />
      </label>
      {precheck && (
        <p role="alert" className="text-sm text-red-700">
          {precheck}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={!file || !!precheck || upload.isPending}
          onClick={start}
        >
          <Upload /> {upload.isPending ? "正在上传…" : "上传到项目"}
        </Button>
        {upload.isPending && (
          <>
            <progress
              aria-label="上传进度"
              value={Math.round(progress * 100)}
              max={100}
            />
            <span className="text-sm">{Math.round(progress * 100)}%</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => abort.current?.abort()}
            >
              取消
            </Button>
          </>
        )}
      </div>
      {upload.error && (
        <p role="alert" className="text-sm text-red-700">
          {apiProblem(upload.error).status === null
            ? "上传中断，可重试；同一文件重试不会产生重复视频。"
            : problemText(upload.error, "上传失败，请重试。")}
        </p>
      )}
      {done && (
        <p role="status" className="text-sm">
          已上传“{done.filename}”，现在可以预览或开始推理。
        </p>
      )}
    </div>
  )
}
