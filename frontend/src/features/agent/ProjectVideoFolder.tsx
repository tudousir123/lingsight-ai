import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { FolderOpen } from "lucide-react"
import { useState } from "react"
import { ProjectsService } from "@/client"
import type { Entry, VideoSource } from "@/features/inference/contract"
import useAuth from "@/hooks/useAuth"
import {
  ApiRequestError,
  apiProblem,
  problemFromResponse,
} from "@/lib/apiError"
import { authHeaders } from "@/lib/credentials"
import { inferenceGatewayBase, inferenceRoutes } from "@/lib/upstreamRoutes.gen"
import {
  projectErrorText,
  projectsKey,
  useAddProjectMember,
  type WorkspaceProject,
} from "./projects"

async function json<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...authHeaders() },
  })
  if (!response.ok)
    throw new ApiRequestError(await problemFromResponse(response))
  const body = await response.json().catch(() => ({}))
  return body as T
}

export function ProjectVideoFolder({ project }: { project: WorkspaceProject }) {
  const { user } = useAuth()
  // A new account or saved folder replaces the previous browsing and selection state.
  return (
    <FolderBrowser
      key={JSON.stringify([
        user?.id,
        project.id,
        project.video_folder?.source_id,
        project.video_folder?.path,
      ])}
      project={project}
      userId={user?.id}
    />
  )
}

function FolderBrowser({
  project,
  userId,
}: {
  project: WorkspaceProject
  userId?: string
}) {
  const client = useQueryClient()
  const saved = project.video_folder
  const [editing, setEditing] = useState(!saved)
  const [sourceId, setSourceId] = useState(saved?.source_id ?? "")
  const [directory, setDirectory] = useState(saved?.path ?? "")
  const [selected, setSelected] = useState<string[]>([])
  const addMember = useAddProjectMember()
  const sources = useQuery({
    queryKey: ["video-sources", userId],
    enabled: !!userId,
    queryFn: ({ signal }) =>
      json<VideoSource[]>(
        `${inferenceGatewayBase}/${inferenceRoutes.sources()}`,
        { signal },
      ),
    // 用户上传走项目视频列表，不经目录接口；这里只列既有目录来源。
    select: (items) => items.filter((item) => item.kind !== "user_upload"),
    retry: false,
  })
  const source =
    sources.data?.find((item) => item.id === sourceId) ??
    (!sourceId ? sources.data?.[0] : undefined)
  const currentSource = source?.id ?? sourceId
  const listing = useQuery({
    // The listing is scoped by the project's saved folder, so it is per project.
    queryKey: ["video-folder", userId, project.id, currentSource, directory],
    enabled: !!userId && !!source?.available,
    queryFn: ({ signal }) =>
      json<Entry[]>(
        `${inferenceGatewayBase}/${inferenceRoutes.videos()}?${new URLSearchParams({ source_id: currentSource, path: directory, project_id: project.id })}`,
        { signal },
      ),
    retry: false,
  })
  // The listing only serves the saved project folder (404 outside it, 403 when
  // unauthorized). An authorized scope outside it can still be saved: the PUT
  // checks authorization itself and only then opens the new scope.
  const outsideSaved =
    apiProblem(listing.error).status === 404 &&
    !(saved?.source_id === currentSource && (saved.path ?? "") === directory)
  const save = useMutation({
    mutationFn: async () =>
      (
        await ProjectsService.selectProjectVideoFolder({
          path: { project_id: project.id },
          body: { source_id: currentSource, path: directory },
        })
      ).data,
    onSuccess: (updated) => {
      client.setQueryData<WorkspaceProject[]>([...projectsKey, userId], (old) =>
        old?.map((item) => (item.id === updated.id ? updated : item)),
      )
      setEditing(false)
    },
  })
  const videos = (listing.data ?? []).filter(
    (item) => item.type === "video" && item.id,
  )
  const existing = new Set(
    (project.members ?? [])
      .filter((item) => item.kind === "video")
      .map((item) => item.id),
  )
  const importVideos = useMutation({
    mutationFn: async () => {
      const failed: string[] = []
      for (const id of selected) {
        if (existing.has(id)) continue
        try {
          await addMember.mutateAsync({
            projectId: project.id,
            kind: "video",
            id,
            label: videos.find((item) => item.id === id)?.name,
          })
        } catch {
          failed.push(id)
        }
      }
      return failed
    },
    onSuccess: (failed) => setSelected(failed),
  })
  return (
    <section
      aria-labelledby="video-folder-title"
      className="my-6 space-y-4 rounded-lg border border-border p-5"
    >
      <h2
        id="video-folder-title"
        className="flex items-center gap-2 text-lg font-medium"
      >
        <FolderOpen size={20} />
        {saved ? "项目视频文件夹" : "选择视频文件夹"}
      </h2>
      <p className="text-sm text-muted-foreground">
        选择视频来源和文件夹，再将需要的视频归入项目。
      </p>
      {saved && <p className="break-all">{saved.label}</p>}
      {saved && !editing && (
        <Link
          className="project-action"
          to="/inference"
          search={{
            project_id: project.id,
            source_id: saved.source_id,
            path: saved.path ?? "",
          }}
        >
          前往视频推理
        </Link>
      )}
      {saved && !editing && (
        <button
          type="button"
          className="project-action"
          disabled={importVideos.isPending}
          onClick={() => {
            setEditing(true)
            setSelected([])
            importVideos.reset()
          }}
        >
          更换文件夹
        </button>
      )}
      {editing && (
        <>
          <label className="block space-y-2">
            <span>视频来源</span>
            <select
              aria-label="视频来源"
              className="block w-full rounded border border-border bg-background p-2"
              value={currentSource}
              disabled={sources.isPending || save.isPending}
              onChange={(event) => {
                setSourceId(event.target.value)
                setDirectory("")
                save.reset()
              }}
            >
              {!sources.data?.length && <option value="">暂无可用来源</option>}
              {sources.data?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                  {item.available ? "" : "（不可用）"}
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm text-muted-foreground">
            阿里云盘、百度网盘将在后续接入。
          </p>
          <p className="break-all text-sm">
            当前文件夹：{directory || "根目录"}
          </p>
          {directory && (
            <button
              type="button"
              className="project-action"
              disabled={save.isPending}
              onClick={() =>
                setDirectory(directory.split("/").slice(0, -1).join("/"))
              }
            >
              上一级
            </button>
          )}
          <ul className="space-y-2">
            {(listing.data ?? [])
              .filter((item) => item.type === "directory")
              .map((item) => (
                <li key={item.path}>
                  <button
                    type="button"
                    className="project-action"
                    aria-label={`打开文件夹 ${item.name}`}
                    disabled={save.isPending || !item.path}
                    onClick={() => setDirectory(item.path ?? "")}
                  >
                    <FolderOpen size={16} />
                    {item.name}
                  </button>
                </li>
              ))}
          </ul>
          <button
            type="button"
            className="project-action"
            disabled={
              !source?.available ||
              !(listing.isSuccess || outsideSaved) ||
              save.isPending
            }
            onClick={() => save.mutate()}
          >
            {save.isPending ? "正在保存…" : "使用此文件夹"}
          </button>
          {saved && outsideSaved && (
            <p className="text-sm text-muted-foreground">
              该文件夹不在当前已保存的项目文件夹内，保存后才能浏览其中的视频；保存时会校验你对它的访问权限。
            </p>
          )}
          {saved && (
            <button
              type="button"
              className="project-action"
              disabled={save.isPending}
              onClick={() => {
                setSourceId(saved.source_id)
                setDirectory(saved.path ?? "")
                setEditing(false)
                save.reset()
              }}
            >
              取消更换
            </button>
          )}
        </>
      )}
      {sources.isPending && <p>正在加载视频来源…</p>}
      {sources.error && (
        <p role="alert">
          {sources.error.message}
          <button
            type="button"
            className="project-action"
            onClick={() => void sources.refetch()}
          >
            重试加载来源
          </button>
        </p>
      )}
      {!sources.isPending && !sources.error && !sources.data?.length && (
        <p>还没有配置视频来源。</p>
      )}
      {source && !source.available && (
        <p role="alert">{source.error?.message ?? "此视频来源暂时不可用。"}</p>
      )}
      {sources.isSuccess && sourceId && !source && (
        <p role="alert">已保存的视频来源当前不可用，请选择其他来源。</p>
      )}
      {source?.available && listing.isPending && <p>正在读取文件夹…</p>}
      {listing.error && !outsideSaved && (
        <p role="alert">
          {listing.error.message}
          <button
            type="button"
            className="project-action"
            onClick={() => void listing.refetch()}
          >
            重试读取文件夹
          </button>
        </p>
      )}
      {save.error && (
        <p role="alert">
          {projectErrorText(save.error, "无法保存视频文件夹，请重试。")}
        </p>
      )}
      {listing.isSuccess && !listing.data.length && <p>此文件夹为空。</p>}
      {saved &&
        !editing &&
        videos.map((video) => (
          <label className="flex items-center gap-2" key={video.id}>
            <input
              type="checkbox"
              aria-label={`选择视频 ${video.name}`}
              checked={
                existing.has(video.id ?? "") ||
                selected.includes(video.id ?? "")
              }
              disabled={
                existing.has(video.id ?? "") ||
                importVideos.isPending ||
                !listing.isSuccess
              }
              onChange={(event) => {
                const id = video.id
                if (!id) return
                setSelected((old) =>
                  event.target.checked
                    ? [...old, id]
                    : old.filter((item) => item !== id),
                )
                importVideos.reset()
              }}
            />
            {video.name}
            {existing.has(video.id ?? "") && (
              <small className="text-muted-foreground">已归入</small>
            )}
          </label>
        ))}
      {saved && !editing && videos.length > 0 && (
        <button
          type="button"
          className="project-action"
          disabled={
            !selected.length ||
            importVideos.isPending ||
            !listing.isSuccess ||
            !source?.available
          }
          onClick={() => importVideos.mutate()}
        >
          {importVideos.isPending ? "正在归入…" : "将所选视频归入项目"}
        </button>
      )}
      {importVideos.data && importVideos.data.length > 0 && (
        <p role="alert">
          {importVideos.data.length} 个视频未归入，请重试。已成功的视频已保留。
        </p>
      )}
      {importVideos.isSuccess && importVideos.data.length === 0 && (
        <p role="status">所选视频已归入项目。</p>
      )}
    </section>
  )
}
