import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import useAuth from "@/hooks/useAuth"
import {
  agentResearchMemoryContract,
  agentRoutes,
} from "@/lib/upstreamRoutes.gen"
import { AgentError, agentJson } from "./api"
import { type Source, Sources, useMemoryUses } from "./MemoryPanel"
import { agentRequest, discardPendingRequest, pendingRequest } from "./requests"

type ResearchMemory = {
  id: string
  owner_user_id: string
  project_id: string
  kind: "research_candidate" | "project_research"
  content: string
  content_version: number
  version: number
  source_fingerprint: string
  state: "active" | "rejected" | "source_changed"
  confirmation: "pending" | "confirmed" | "rejected"
  sources: Source[]
}
type ResearchView = {
  contract: string
  project_id: string
  processing: {
    state: string
    extraction: { recipient: string } | null
    embedding: { recipient: string } | null
  }
  items: ResearchMemory[]
}
function Decision({
  memory,
  taskId,
  owner,
  onDone,
}: {
  memory: ResearchMemory
  taskId: string
  owner: string
  onDone: () => void
}) {
  const path = agentRoutes.tasksByTaskIdResearchMemoriesByMemoryIdDecision(
    taskId,
    memory.id,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(() => {
    try {
      return pendingRequest(owner, path)
    } catch {
      return null
    }
  })
  const act = async (decision?: "confirm" | "reject") => {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      const previous = pendingRequest(owner, path)
      await agentRequest(
        owner,
        path,
        previous?.body ?? {
          expected_version: memory.version,
          content_version: memory.content_version,
          source_fingerprint: memory.source_fingerprint,
          decision,
        },
      )
      setSaved(null)
      onDone()
    } catch (err) {
      setSaved(pendingRequest(owner, path))
      setError(
        err instanceof AgentError && err.status === 409
          ? "版本已变化，原决定未覆盖当前记录。请放弃旧决定并重新核对内容和来源。"
          : err instanceof AgentError
            ? err.message
            : "请求失败，接收状态未确认；请重试原决定。",
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      {memory.state === "active" &&
        memory.confirmation === "pending" &&
        !saved && (
          <div>
            <p>
              请核对上方完整内容及来源；确认仅绑定当前内容和来源版本，不代表科研结论已复核。
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void act("confirm")}
            >
              确认此版本
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void act("reject")}
            >
              拒绝此候选
            </button>
          </div>
        )}
      {saved && (
        <div>
          <p>
            原决定接收状态待核对；重试沿用原请求与版本，不会自动改为确认新内容。
          </p>
          <button type="button" disabled={busy} onClick={() => void act()}>
            重试原决定
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              discardPendingRequest(owner, path)
              setSaved(null)
              setError("")
              onDone()
            }}
          >
            放弃旧决定并重新核对
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  )
}
export function ResearchMemoryPanel({
  taskId,
  projectId,
  supported,
}: {
  taskId: string
  projectId: string
  supported: boolean
}) {
  const { user } = useAuth()
  const uses = useMemoryUses(taskId)
  const memories = useQuery({
    queryKey: ["research-memories", user?.id, projectId, taskId],
    enabled: !!user?.id && !!taskId && !!projectId && supported,
    retry: false,
    refetchInterval: 5000,
    queryFn: async ({ signal }) => {
      const value = await agentJson<ResearchView>(
        agentRoutes.tasksByTaskIdResearchMemories(taskId),
        undefined,
        "GET",
        signal,
      )
      if (
        value.contract !== agentResearchMemoryContract ||
        value.project_id !== projectId ||
        !value.processing ||
        !Array.isArray(value.items) ||
        value.items.some(
          (m) =>
            m.owner_user_id !== user?.id ||
            m.project_id !== projectId ||
            !["research_candidate", "project_research"].includes(m.kind) ||
            !Array.isArray(m.sources),
        )
      )
        throw new Error("项目科研记忆范围或协议不兼容，已禁用核对。")
      return value
    },
  })
  const view = memories.isError ? undefined : memories.data
  return (
    <section className="agent-memory-panel" aria-label="项目科研记忆">
      <div className="agent-memory-heading">
        <strong>项目科研记忆</strong>
        <button
          type="button"
          disabled={!supported}
          onClick={() => void memories.refetch()}
        >
          刷新科研记忆
        </button>
      </div>
      <p>
        候选不作为已确认依据；确认后仅本项目使用，不提升为个人偏好，不替代科研复核、版本化
        Skills 或正式交付物。
      </p>
      {!supported && (
        <p role="status">服务尚不支持项目科研记忆核对，请更新服务。</p>
      )}
      {memories.error && <p role="alert">{memories.error.message}</p>}
      {view?.items.length === 0 && <p>本项目暂无候选科研记忆。</p>}
      {view && (
        <>
          <p>
            科研内容及同项目已确认历史的抽取：
            {view.processing.extraction?.recipient ?? "未启用"}；嵌入：
            {view.processing.embedding?.recipient ?? "未启用"}
            。任务生成沿用现有授权模型；确认本身不调用额外模型。
          </p>
          <ul className="agent-memory-records">
            {view.items.map((memory) => (
              <li key={memory.id}>
                <p>{memory.content}</p>
                <strong>
                  {memory.state === "source_changed"
                    ? "来源已变化 · 旧确认失效，需新候选"
                    : memory.confirmation === "confirmed"
                      ? "已确认 · 仅本项目"
                      : memory.confirmation === "rejected"
                        ? "已拒绝 · 不会自动提升"
                        : "候选 · 待核对"}
                </strong>
                <p>
                  内容版本 {memory.content_version} · 核对版本 {memory.version}
                </p>
                <Sources sources={memory.sources} />
                <details>
                  <summary>来源集合版本指纹</summary>
                  <code>{memory.source_fingerprint}</code>
                </details>
                <Decision
                  memory={memory}
                  taskId={taskId}
                  owner={user!.id}
                  onDone={() => void memories.refetch()}
                />
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="agent-memory-uses">
        <strong>已提供给本任务 · 项目科研记忆</strong>
        <p>表示提供给引擎，不代表模型必然采用或结论通过科研复核。</p>
        {uses.error && <p role="alert">{uses.error.message}</p>}
        {!uses.isError &&
          uses.data?.items
            .filter((use) => use.kind === "project_research")
            .map((use) => (
              <div
                key={`${use.run_id}:${use.memory_id}:${use.content_version}`}
              >
                <p>
                  {use.available ? use.content : "原科研记忆确认版本已不可用"} ·
                  内容版本 {use.content_version}
                </p>
                <code>{use.memory_id}</code>
                <Sources sources={use.sources} />
              </div>
            ))}
      </div>
    </section>
  )
}
