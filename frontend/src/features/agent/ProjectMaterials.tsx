import { useQueries } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Clapperboard, Database, Files, FileVideo, Play } from "lucide-react"
import { useState } from "react"
import type { PublishedResultPublic } from "@/client"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { inferenceArtifactUrl } from "@/features/inference/artifacts"
import { agentRoutes } from "@/lib/upstreamRoutes.gen"
import { ArtifactCards, ArtifactViewer } from "./Artifacts"
import { type Artifact, agentJson, type Task, taskKey } from "./api"
import { ProjectVideoFolder } from "./ProjectVideoFolder"
import {
  membersOfKind,
  useProjectResults,
  useRemoveProjectMember,
  useResultFrames,
  type WorkspaceProject,
} from "./projects"
import "./project-materials.css"

const FRAMES_PAGE_SIZE = 50

const correctionLabels: Record<string, string> = {
  head_tail_swapped: "头尾已换",
  flip_kept_by_trajectory: "轨迹保向",
  flip_unresolved: "极性未决",
}

function ResultFrames({
  projectId,
  taskId,
}: {
  projectId: string
  taskId: string
}) {
  const [offset, setOffset] = useState(0)
  const frames = useResultFrames(
    projectId,
    taskId,
    offset,
    FRAMES_PAGE_SIZE,
    true,
  )
  const payload = frames.data
  return (
    <div className="mt-2 space-y-2">
      {frames.isPending && <p>正在加载逐帧行…</p>}
      {frames.error && (
        <p role="alert">无法加载逐帧行：{frames.error.message}</p>
      )}
      {payload && (
        <>
          <div className="max-h-72 overflow-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background">
                <tr>
                  <th className="px-2 py-1 text-left">帧</th>
                  <th className="px-2 py-1 text-left">朝向 (°)</th>
                  <th className="px-2 py-1 text-left">提案</th>
                  <th className="px-2 py-1 text-left">质心 (x, y)</th>
                  <th className="px-2 py-1 text-left">极性标记</th>
                </tr>
              </thead>
              <tbody>
                {payload.data.map((row) => (
                  <tr key={row.frame_idx} className="border-t border-border">
                    <td className="px-2 py-1">{row.frame_idx}</td>
                    <td className="px-2 py-1">
                      {row.heading_angle_deg.toFixed(2)}
                    </td>
                    <td className="px-2 py-1">
                      {row.is_proposal ? "提案" : "实测"}
                    </td>
                    <td className="px-2 py-1">
                      {row.centroid_x != null && row.centroid_y != null
                        ? `${row.centroid_x.toFixed(1)}, ${row.centroid_y.toFixed(1)}`
                        : "—"}
                    </td>
                    <td className="px-2 py-1">
                      {row.keypoint_correction
                        ? (correctionLabels[row.keypoint_correction] ??
                          row.keypoint_correction)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="flex items-center gap-3 text-sm">
            <span>
              第 {offset + 1}–{offset + payload.data.length} 行，共{" "}
              {payload.count} 行
            </span>
            <button
              type="button"
              className="project-action"
              disabled={offset === 0 || frames.isPending}
              onClick={() => setOffset(Math.max(0, offset - FRAMES_PAGE_SIZE))}
            >
              上一页
            </button>
            <button
              type="button"
              className="project-action"
              disabled={
                offset + payload.data.length >= payload.count ||
                frames.isPending
              }
              onClick={() => setOffset(offset + FRAMES_PAGE_SIZE)}
            >
              下一页
            </button>
          </p>
        </>
      )}
    </div>
  )
}

function ProjectDatabase({
  projectId,
  results,
}: {
  projectId: string
  results: ReturnType<typeof useProjectResults>
}) {
  const [openTask, setOpenTask] = useState<string | null>(null)
  return (
    <section aria-labelledby="project-results-title" className="space-y-2">
      <h2 id="project-results-title">已发布推理结果</h2>
      <p className="materials-note">只读查看项目已发布的帧级数据。</p>
      {results.isPending && <p>正在加载已发布结果…</p>}
      {results.error && <p role="alert">无法加载已发布结果，请稍后重试。</p>}
      {results.data?.length === 0 && (
        <p className="research-history-note">
          还没有已发布结果。在“视频推理”页对通过复核的任务点“发布到项目”。
        </p>
      )}
      {(results.data ?? []).map((result) => (
        <div key={result.task_id} className="materials-record">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 text-left"
            aria-expanded={openTask === result.task_id}
            onClick={() =>
              setOpenTask(openTask === result.task_id ? null : result.task_id)
            }
          >
            <span className="break-all">
              <strong>{result.video_id}</strong>
              <small className="block text-muted-foreground">
                任务 {result.task_id}
              </small>
            </span>
            <span className="shrink-0 text-sm text-muted-foreground">
              {openTask === result.task_id ? "收起" : "查看逐帧行"}
            </span>
          </button>
          <p className="mt-2 text-sm text-muted-foreground">
            {result.fps} fps · 总帧 {result.total_frames} · 有效帧{" "}
            {result.valid_frames} · 带朝向 {result.frames_with_heading}（提案{" "}
            {result.proposal_frames}）·{" "}
            {result.published_at
              ? new Date(result.published_at).toLocaleString()
              : ""}
          </p>
          {openTask === result.task_id && (
            <div className="space-y-2">
              <p className="materials-note mt-2">
                朝向算法 {result.heading_algorithm} · 关键点协议{" "}
                {result.keypoint_protocol}
              </p>
              {result.review_note && (
                <p className="materials-note">复核备注：{result.review_note}</p>
              )}
              <ResultFrames projectId={projectId} taskId={result.task_id} />
            </div>
          )}
        </div>
      ))}
    </section>
  )
}

function OriginalVideos({ project }: { project: WorkspaceProject }) {
  const removeMember = useRemoveProjectMember()
  const [folderOpen, setFolderOpen] = useState(false)
  const members = membersOfKind(project, "video")
  const folder = project.video_folder
  return (
    <section className="materials-panel" aria-labelledby="project-videos-title">
      <div className="materials-panel-heading">
        <h2 id="project-videos-title">原始视频</h2>
        <Link
          className="materials-secondary-action"
          to="/inference"
          search={
            folder
              ? { source_id: folder.source_id, path: folder.path ?? "" }
              : {}
          }
        >
          打开视频目录
        </Link>
      </div>
      {folder && <p className="materials-note">来源：{folder.label}</p>}
      {members.length === 0 && (
        <p className="materials-empty">暂无原始视频。</p>
      )}
      {members.length > 0 && (
        <ul className="materials-list">
          {members.map((member) => (
            <li key={member.id}>
              <FileVideo size={19} aria-hidden="true" />
              <strong>{member.label ?? member.id}</strong>
              <button
                type="button"
                className="materials-secondary-action"
                disabled={removeMember.isPending}
                aria-label={`移出视频 ${member.label ?? member.id}`}
                onClick={() =>
                  removeMember.mutate({
                    projectId: project.id,
                    kind: "video",
                    id: member.id,
                  })
                }
              >
                移出
              </button>
            </li>
          ))}
        </ul>
      )}
      {removeMember.error && <p role="alert">移出失败，请重试。</p>}
      <details
        className="materials-folder"
        onToggle={(event) => setFolderOpen(event.currentTarget.open)}
      >
        <summary>{members.length ? "管理视频来源" : "添加视频"}</summary>
        {folderOpen && <ProjectVideoFolder project={project} />}
      </details>
    </section>
  )
}

function OverlayPlayer({
  result,
  name,
  onClose,
}: {
  result: PublishedResultPublic
  name: string
  onClose: () => void
}) {
  const [failed, setFailed] = useState(false)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="project-dialog sm:max-w-3xl">
        <DialogTitle>推理可视化 · {name}</DialogTitle>
        <DialogDescription>
          轨迹、质心和头尾标注叠加在实验视频上。
        </DialogDescription>
        {failed ? (
          <p role="alert">暂时无法播放该视频，请到视频推理页检查原任务。</p>
        ) : (
          // biome-ignore lint/a11y/useMediaCaption: 现有推理叠加视频不含音轨。
          <video
            className="materials-player"
            src={inferenceArtifactUrl(result.task_id, "overlay.mp4")}
            controls
            playsInline
            preload="metadata"
            aria-label={`播放 ${name} 的推理可视化视频`}
            onError={() => setFailed(true)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function InferenceVideos({
  results,
  videoNames,
}: {
  results: ReturnType<typeof useProjectResults>
  videoNames: Map<string, string | null | undefined>
}) {
  const [playing, setPlaying] = useState<PublishedResultPublic | null>(null)
  return (
    <section
      className="materials-panel"
      aria-labelledby="project-overlay-title"
    >
      <h2 id="project-overlay-title">推理可视化视频</h2>
      {results.isPending && (
        <p className="materials-note">正在加载可视化视频…</p>
      )}
      {results.error && <p role="alert">无法加载可视化视频，请稍后重试。</p>}
      {results.data?.length === 0 && (
        <p className="materials-empty">
          暂无可视化视频。推理结果发布到项目后可在这里播放。
        </p>
      )}
      <ul className="materials-list">
        {(results.data ?? []).map((result) => {
          const name = videoNames.get(result.video_id) ?? result.video_id
          return (
            <li key={result.task_id}>
              <Clapperboard size={19} aria-hidden="true" />
              <span>
                <strong>{name}</strong>
                <small>推理叠加视频 · {result.fps} fps</small>
              </span>
              <button
                className="materials-secondary-action"
                type="button"
                onClick={() => setPlaying(result)}
                aria-label={`播放 ${name}`}
              >
                <Play size={14} /> 播放
              </button>
            </li>
          )
        })}
      </ul>
      {playing && (
        <OverlayPlayer
          key={playing.task_id}
          result={playing}
          name={videoNames.get(playing.video_id) ?? playing.video_id}
          onClose={() => setPlaying(null)}
        />
      )}
    </section>
  )
}

function AnalysisFiles({
  project,
  tasks,
}: {
  project: WorkspaceProject
  tasks: Task[]
}) {
  const [preview, setPreview] = useState<{
    taskId: string
    artifact: Artifact
  } | null>(null)
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const members = membersOfKind(project, "agent_task")
  const queries = useQueries({
    queries: members.map((member) => ({
      queryKey: taskKey(member.id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        agentJson<Task>(
          agentRoutes.tasksByTaskId(member.id),
          undefined,
          "GET",
          signal,
        ),
      retry: false,
      enabled: byId.get(member.id)?.artifacts === undefined,
    })),
  })
  const records = members.flatMap((member, index) => {
    const summary = byId.get(member.id)
    const task =
      summary?.artifacts !== undefined ? summary : queries[index]?.data
    return task?.artifacts?.length ? [task] : []
  })
  const loading = queries.some((query) => query.isFetching)
  const failed = queries.some((query) => query.isError)
  return (
    <section className="materials-panel" aria-labelledby="project-files-title">
      <h2 id="project-files-title">分析产物</h2>
      {loading && <p className="materials-note">正在加载对话产物…</p>}
      {failed && <p role="alert">有些对话的产物暂时无法加载。</p>}
      {!loading && !failed && !records.length && (
        <p className="materials-empty">
          暂无分析产物。项目对话生成的图表、数据表和报告会出现在这里。
        </p>
      )}
      {records.map((task) => (
        <div className="materials-file-group" key={task.id}>
          <Link
            to="/tasks/$taskId"
            params={{ taskId: task.id }}
            search={{ project: project.id }}
          >
            {task.title}
          </Link>
          <ArtifactCards
            artifacts={task.artifacts ?? []}
            onSelect={(artifact) => setPreview({ taskId: task.id, artifact })}
          />
        </div>
      ))}
      {preview && (
        <ArtifactViewer
          key={preview.artifact.id}
          artifact={preview.artifact}
          taskId={preview.taskId}
          onClose={() => setPreview(null)}
        />
      )}
    </section>
  )
}

export function ProjectMaterials({
  project,
  tasks,
}: {
  project: WorkspaceProject
  tasks: Task[]
}) {
  const results = useProjectResults(project.id)
  const videos = membersOfKind(project, "video")
  const names = new Map(videos.map((video) => [video.id, video.label]))
  const tabs = [
    { id: "original", title: "原始视频", icon: FileVideo },
    { id: "overlay", title: "推理可视化视频", icon: Clapperboard },
    { id: "database", title: "数据库", icon: Database },
    { id: "files", title: "分析产物", icon: Files },
  ]

  return (
    <Tabs defaultValue="original">
      <TabsList className="materials-tabs" aria-label="资料类型">
        {tabs.map(({ id, title, icon: Icon }) => (
          <TabsTrigger value={id} key={id}>
            <Icon size={17} />
            {title}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="original">
        <OriginalVideos project={project} />
      </TabsContent>
      <TabsContent value="overlay">
        <InferenceVideos results={results} videoNames={names} />
      </TabsContent>
      <TabsContent value="database">
        <div className="materials-panel">
          <ProjectDatabase projectId={project.id} results={results} />
        </div>
      </TabsContent>
      <TabsContent value="files">
        <AnalysisFiles project={project} tasks={tasks} />
      </TabsContent>
    </Tabs>
  )
}
