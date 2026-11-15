import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import useAuth from "@/hooks/useAuth"
import { agentRoutes } from "@/lib/upstreamRoutes.gen"
import { agentJson } from "./api"
import "./memory.css"

type Source = {
  id: string
  task_id: string
  run_id: string
  source_version: number
  source_sha256: string
  excerpt: string
}
type Preference = {
  id: string
  owner_user_id: string
  kind: "personal_preference"
  project_id: null
  content: string
  content_version: number
  state: "active"
  sources: Source[]
}
type Recipient = { recipient: string; model: string }
type MemoryView = {
  contract: "personal-memory-v1"
  processing: {
    state: "enabled" | "disabled"
    extraction: Recipient | null
    embedding: Recipient | null
  }
  index: { state: string }
  items: Preference[]
}
type Uses = {
  contract: "personal-memory-v1"
  items: {
    run_id: string
    memory_id: string
    content_version: number
    available: boolean
    content: string | null
    sources: Source[]
  }[]
}
function Sources({ sources }: { sources: Source[] }) {
  return (
    <ul className="agent-memory-sources">
      {sources.map((source) => (
        <li key={source.id}>
          <Link to="/tasks/$taskId" params={{ taskId: source.task_id }}>
            查看来源任务
          </Link>
          <span>来源版本 {source.source_version}</span>
          <p>{source.excerpt}</p>
          <code title="来源 SHA256">{source.source_sha256}</code>
        </li>
      ))}
    </ul>
  )
}
export function MemoryPanel({ taskId }: { taskId?: string }) {
  const { user } = useAuth()
  const memories = useQuery({
    queryKey: ["personal-memories", user?.id, taskId],
    enabled: !!user?.id,
    retry: false,
    refetchInterval: 5000,
    queryFn: async ({ signal }) => {
      const value = await agentJson<MemoryView>(
        agentRoutes.memories(),
        undefined,
        "GET",
        signal,
      )
      if (
        value.contract !== "personal-memory-v1" ||
        !value.processing ||
        !value.index ||
        !Array.isArray(value.items) ||
        value.items.some(
          (m) =>
            m.owner_user_id !== user?.id ||
            m.kind !== "personal_preference" ||
            m.project_id !== null ||
            m.state !== "active" ||
            !Array.isArray(m.sources),
        )
      )
        throw new Error("个人偏好记忆协议不兼容，请更新服务。")
      return value
    },
  })
  const uses = useQuery({
    queryKey: ["task-memory-uses", user?.id, taskId],
    enabled: !!user?.id && !!taskId,
    retry: false,
    refetchInterval: 5000,
    queryFn: async ({ signal }) => {
      const value = await agentJson<Uses>(
        agentRoutes.tasksByTaskIdMemories(taskId!),
        undefined,
        "GET",
        signal,
      )
      if (
        value.contract !== "personal-memory-v1" ||
        !Array.isArray(value.items)
      )
        throw new Error("任务记忆使用依据暂不可用。")
      return value
    },
  })
  // A failed refresh cannot advertise a formerly successful cached response.
  const view = memories.isError ? undefined : memories.data
  const supplied = uses.isError ? undefined : uses.data
  const indexUnavailable =
    view && !["ready", "disabled", "not_built"].includes(view.index.state)
  return (
    <section className="agent-memory-panel" aria-label="个人偏好记忆">
      <div className="agent-memory-heading">
        <strong>个人偏好记忆</strong>
        <button
          type="button"
          onClick={() => {
            void memories.refetch()
            if (taskId) void uses.refetch()
          }}
        >
          刷新偏好
        </button>
      </div>
      {memories.isPending && <p>正在读取偏好…</p>}
      {memories.error && <p role="alert">{memories.error.message}</p>}
      {view && (
        <>
          <p>
            {view.processing.state === "disabled"
              ? "未配置获授权记忆处理服务；不会自动抽取或调用额外模型。"
              : "稳定表达偏好自动保存，可跨本人项目使用；单次要求和科研参数不提升为全局偏好。"}
          </p>
          {indexUnavailable && (
            <p role="status">
              {view.index.state === "lagging" ? "索引同步滞后" : "索引暂不可用"}
              ；权威记录仍可查看，不保证本次召回。
            </p>
          )}
          <details>
            <summary>查看个人偏好（{view.items.length}）</summary>
            {view.items.length === 0 && <p>尚无已保存的个人偏好。</p>}
            <ul className="agent-memory-records">
              {view.items.map((memory) => (
                <li key={memory.id}>
                  <p>{memory.content}</p>
                  <small>自动保存 · 内容版本 {memory.content_version}</small>
                  <Sources sources={memory.sources} />
                </li>
              ))}
            </ul>
            {taskId && (
              <div className="agent-memory-uses">
                <strong>已提供给本任务</strong>
                <p>
                  表示已提供给执行引擎，不代表模型必然采用，也不是科研依据。
                </p>
                {uses.error && <p role="alert">{uses.error.message}</p>}
                {supplied?.items.length === 0 && (
                  <p>本任务尚无记忆使用依据。</p>
                )}
                {supplied?.items.map((use) => (
                  <p
                    key={`${use.run_id}:${use.memory_id}:${use.content_version}`}
                  >
                    {use.available ? use.content : "原记忆版本已不可用"} ·
                    内容版本 {use.content_version}
                  </p>
                ))}
              </div>
            )}
            <div className="agent-memory-recipients">
              <strong>数据处理</strong>
              <p>
                抽取：{view.processing.extraction?.recipient ?? "未启用"}
                ；嵌入：
                {view.processing.embedding?.recipient ?? "未启用"}
                。重排与遥测关闭。
              </p>
              <p>任务生成仍使用现有获授权模型；记忆不会扩大工具权限。</p>
            </div>
          </details>
        </>
      )}
    </section>
  )
}
