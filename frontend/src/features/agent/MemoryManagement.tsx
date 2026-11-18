import { useState } from "react"
import { AgentError, agentJson } from "./api"
import { useExecutionCapability } from "./Execution"
import { agentRequest, discardPendingRequest, pendingRequest } from "./requests"

export type MutableMemory = {
  id: string
  content: string
  content_version: number
  version: number
  source_fingerprint: string
  state: string
}
export type MemoryIndex = {
  state: string
  revision?: string
  attempts?: number
}
function useAction(owner: string, path: string, onDone: () => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(() => pendingRequest(owner, path))
  const act = async (body?: Record<string, unknown>) => {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      await agentRequest(
        owner,
        path,
        pendingRequest(owner, path)?.body ?? body ?? {},
      )
      setSaved(null)
      onDone()
      return true
    } catch (err) {
      setSaved(pendingRequest(owner, path))
      setError(
        err instanceof AgentError && err.status === 409
          ? "版本已变化或重试额度已用尽。原修改未覆盖当前记录；请重新核对。"
          : err instanceof Error
            ? err.message
            : "接收状态未确认，请重试原修改。",
      )
      return false
    } finally {
      setBusy(false)
    }
  }
  const retry = saved && (
    <div>
      <p>原修改接收状态待核对，重试保留原 UUID、正文和版本。</p>
      <button type="button" disabled={busy} onClick={() => void act()}>
        重试原修改
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
        放弃旧修改并重新核对
      </button>
    </div>
  )
  return {
    act,
    busy,
    saved,
    retry,
    error: error && <p role="alert">{error}</p>,
  }
}
export function MemoryMutation({
  memory,
  owner,
  path,
  research,
  onDone,
}: {
  memory: MutableMemory
  owner: string
  path: string
  research: boolean
  onDone: () => void
}) {
  const capability = useExecutionCapability()
  const action = useAction(owner, path, onDone)
  const [draft, setDraft] = useState<{
    basis: MutableMemory
    content: string
    source: string
    action: "correct" | "delete"
  } | null>(null)
  const [history, setHistory] = useState<MutableMemory[] | null>(null)
  const [historyError, setHistoryError] = useState("")
  if (capability.isError || !capability.data?.memoryManagement) return null
  const submit = async () => {
    if (!draft) return
    if (
      await action.act({
        action: draft.action,
        expected_version: draft.basis.version,
        content_version: draft.basis.content_version,
        source_fingerprint: draft.basis.source_fingerprint,
        ...(draft.action === "correct"
          ? {
              content: draft.content,
              ...(research ? { source_text: draft.source } : {}),
            }
          : {}),
      })
    )
      setDraft(null)
  }
  return (
    <div className="agent-memory-management">
      {memory.state !== "deleted" && !action.saved && (
        <>
          <button
            type="button"
            disabled={action.busy}
            onClick={() =>
              setDraft({
                basis: memory,
                content: memory.content,
                source: "",
                action: "correct",
              })
            }
          >
            纠正记忆
          </button>
          <button
            type="button"
            disabled={action.busy}
            onClick={() =>
              setDraft({
                basis: memory,
                content: "",
                source: "",
                action: "delete",
              })
            }
          >
            删除记忆
          </button>
        </>
      )}
      {draft && !action.saved && (
        <div>
          {draft.action === "correct" ? (
            <>
              <label>
                纠正内容
                <textarea
                  aria-label="纠正内容"
                  maxLength={240}
                  value={draft.content}
                  onChange={(e) =>
                    setDraft({ ...draft, content: e.target.value })
                  }
                />
              </label>
              {research ? (
                <label>
                  纠正来源说明
                  <textarea
                    aria-label="纠正来源说明"
                    maxLength={240}
                    value={draft.source}
                    onChange={(e) =>
                      setDraft({ ...draft, source: e.target.value })
                    }
                  />
                </label>
              ) : (
                <p>
                  支持稳定表达偏好，例如“以后请用英文回答。”；科研参数不作为个人偏好。
                </p>
              )}
              <button
                type="button"
                disabled={
                  action.busy ||
                  !draft.content.trim() ||
                  (research && !draft.source.trim())
                }
                onClick={() => void submit()}
              >
                {research ? "保存纠正并使旧确认失效" : "保存偏好纠正"}
              </button>
            </>
          ) : (
            <>
              <p>
                删除后立即停止后续记忆使用；不会抹去既有报告、审计、备份或供应商已收到的数据。
              </p>
              <button
                type="button"
                disabled={action.busy}
                onClick={() => void submit()}
              >
                确认删除此记忆
              </button>
            </>
          )}
          <button
            type="button"
            disabled={action.busy}
            onClick={() => setDraft(null)}
          >
            取消本地草稿
          </button>
        </div>
      )}
      {action.retry}
      {action.error}
      <p>
        纠正或删除后，含旧记忆的会话将保守停止。请核对当前记忆后新建任务，不会要求模型“忘记”或改写既有交付物。
      </p>
      <p>删除不会抹去既有报告、使用依据、审计或备份；历史仅供本人受控追溯。</p>
      <button
        type="button"
        onClick={async () => {
          setHistoryError("")
          try {
            setHistory(
              (
                await agentJson<{ items: MutableMemory[] }>(
                  path.replace(/\/mutation$/, "/history"),
                )
              ).items,
            )
          } catch (err) {
            setHistory(null)
            setHistoryError(err instanceof Error ? err.message : "历史不可用")
          }
        }}
      >
        查看受控版本历史
      </button>
      {historyError && <p role="alert">{historyError}</p>}
      {history?.map((m) => (
        <p key={m.version}>
          <span>{m.content}</span> · 历史内容版本 {m.content_version} / 决定版本{" "}
          {m.version}（不参与召回）
        </p>
      ))}
    </div>
  )
}
export function MemoryIndexControl({
  index,
  owner,
  path,
  onDone,
}: {
  index: MemoryIndex
  owner: string
  path: string
  onDone: () => void
}) {
  const capability = useExecutionCapability()
  const action = useAction(owner, path, onDone)
  if (
    capability.isError ||
    !capability.data?.memoryManagement ||
    !index.revision
  )
    return null
  return (
    <div>
      <p role="status">
        派生索引：{index.state}；本版本重试 {index.attempts ?? 0}
        /3。索引状态不代表科研确认，权威内容仍保留。
      </p>
      {!action.saved && (
        <button
          type="button"
          disabled={
            action.busy ||
            ["queued", "running"].includes(index.state) ||
            (index.attempts ?? 0) >= 3
          }
          onClick={() => void action.act({ expected_revision: index.revision })}
        >
          重建有效索引
        </button>
      )}
      {action.retry}
      {action.error}
      {(index.attempts ?? 0) >= 3 && index.state !== "ready" && (
        <p role="alert">
          重试额度已用尽，请联系维护者检查获授权处理服务；不要反复发起请求。
        </p>
      )}
    </div>
  )
}
