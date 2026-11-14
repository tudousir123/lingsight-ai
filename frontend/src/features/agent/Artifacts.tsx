import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Download, FileCode2, FileText, Image, X } from "lucide-react"
import { useEffect, useState } from "react"
import ReactMarkdown from "react-markdown"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { agentRoutes } from "@/lib/upstreamRoutes.gen"
import { type Artifact, agentFetch, agentJson, download, taskKey } from "./api"

function Markdown({ text }: { text: string }) {
  // Raw HTML stays text; remote images never load. Keep the default safe URL transform.
  return (
    <div className="agent-markdown">
      <ReactMarkdown disallowedElements={["img"]}>{text}</ReactMarkdown>
    </div>
  )
}
export function ArtifactViewer({
  artifact,
  taskId,
  onClose,
}: {
  artifact: Artifact
  taskId: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [imageUrl, setImageUrl] = useState("")
  const file = useQuery({
    queryKey: ["agent-file", artifact.id],
    queryFn: async ({ signal }) =>
      (
        await agentFetch(agentRoutes.artifactsByArtifactId(artifact.id), {
          signal,
        })
      ).blob(),
    retry: false,
  })
  const [text, setText] = useState("")
  const truncated = (file.data?.size ?? 0) > 512000
  const figure =
    artifact.kind === "figure" && /\.(png|svg)$/i.test(artifact.name)
  useEffect(() => {
    let alive = true
    setDraft(null)
    setError("")
    setText("")
    if (!file.data) return
    if (figure) {
      const url = URL.createObjectURL(file.data)
      setImageUrl(url)
      return () => URL.revokeObjectURL(url)
    }
    void file.data
      .slice(0, 512000)
      .text()
      .then((t) => {
        if (alive) setText(t)
      })
    return () => {
      alive = false
    }
  }, [file.data, figure])
  const save = async () => {
    if (!draft?.trim()) return
    setSaving(true)
    setError("")
    try {
      await agentJson(
        agentRoutes.artifactsByArtifactId(artifact.id),
        { markdown: draft },
        "PATCH",
      )
      await queryClient.invalidateQueries({ queryKey: taskKey(taskId) })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "报告保存失败。")
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
    >
      <DialogContent className="agent-file-dialog">
        <DialogTitle>{artifact.name}</DialogTitle>
        <DialogDescription>
          已保留来源与版本 · {Math.ceil(artifact.bytes / 1024)} KB
        </DialogDescription>
        <div className="agent-file-actions">
          <button
            type="button"
            onClick={() =>
              void download(
                agentRoutes.artifactsByArtifactId(artifact.id),
                artifact.name,
              ).catch((e) => setError(e.message))
            }
          >
            <Download size={15} />
            下载文件
          </button>
          {artifact.kind === "report" &&
            file.data &&
            !truncated &&
            draft === null && (
              <button type="button" onClick={() => setDraft(text)}>
                编辑报告
              </button>
            )}
          {draft !== null && (
            <>
              <button
                type="button"
                disabled={saving || !draft.trim()}
                onClick={() => void save()}
              >
                {saving ? "正在保存…" : "另存为新版本"}
              </button>
              <button
                type="button"
                onClick={() => setDraft(null)}
                disabled={saving}
              >
                <X size={14} />
                取消编辑
              </button>
            </>
          )}
        </div>
        {truncated && !figure && <p>仅预览前 512 KB，请下载完整文件后编辑。</p>}
        {(error || file.error) && (
          <p role="alert" className="agent-error">
            {error || file.error?.message}
          </p>
        )}
        <div className="agent-file-body">
          {file.isPending ? (
            <p>正在加载文件…</p>
          ) : figure ? (
            <img src={imageUrl || undefined} alt={artifact.name} />
          ) : draft !== null ? (
            <textarea
              aria-label="报告 Markdown"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          ) : artifact.kind === "report" ? (
            <Markdown text={text} />
          ) : (
            <pre>{text}</pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
export function ArtifactCards({
  artifacts,
  onSelect,
}: {
  artifacts: Artifact[]
  onSelect: (a: Artifact) => void
}) {
  return (
    <div className="agent-artifacts">
      {artifacts.map((a) => (
        <button type="button" key={a.id} onClick={() => onSelect(a)}>
          {a.kind === "figure" ? (
            <Image size={21} />
          ) : a.kind === "report" ? (
            <FileText size={21} />
          ) : (
            <FileCode2 size={21} />
          )}
          <span>
            <strong>{a.name}</strong>
            <small>
              {a.kind === "figure"
                ? "图表"
                : a.kind === "report"
                  ? "报告"
                  : a.kind === "data"
                    ? "数据"
                    : "文件"}{" "}
              · {Math.ceil(a.bytes / 1024)} KB
            </small>
          </span>
        </button>
      ))}
    </div>
  )
}
