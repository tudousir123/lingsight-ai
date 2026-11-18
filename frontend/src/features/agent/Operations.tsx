import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { agentRoutes } from "@/lib/upstreamRoutes.gen"
import { agentJson, type Run } from "./api"
import { agentRequest, discardPendingRequest, pendingRequest } from "./requests"

type Operation = {
  operation_id: string
  tool: string
  policy: "safe" | "idempotent" | "unknown"
  state:
    | "started"
    | "effect_confirmed"
    | "result_saved"
    | "unknown"
    | "not_applied"
  version: number
  attempts: number
  checkpoint: { phase: string; durable_task_id: string }
  reason: string | null
  stop_confirmed_at?: string | null
  stop_reason?: string | null
  evidence?: { source?: string; text?: string } | null
}
function readPending(owner: string, path: string) {
  try {
    return pendingRequest(owner, path)
  } catch {
    return null
  }
}
const labels: Record<Operation["state"], string> = {
  started: "已开始，尚无结果",
  effect_confirmed: "已记录生效依据",
  result_saved: "结果已保存",
  unknown: "结果未知",
  not_applied: "已记录未生效依据",
}
function Review({
  operation,
  run,
  owner,
  onDone,
}: {
  operation: Operation
  run: Run
  owner: string
  onDone: () => void
}) {
  const resolvePath = agentRoutes.runsByRunIdOperationsByOperationIdResolve(
    run.id,
    operation.operation_id,
  )
  const verifyPath = agentRoutes.runsByRunIdOperationsByOperationIdVerify(
    run.id,
    operation.operation_id,
  )
  const [evidence, setEvidence] = useState(() =>
    String(readPending(owner, resolvePath)?.body.evidence ?? ""),
  )
  const [decision, setDecision] = useState(() =>
    String(readPending(owner, resolvePath)?.body.decision ?? "confirm_effect"),
  )
  const [stopConfirmed, setStopConfirmed] = useState(
    () => readPending(owner, resolvePath)?.body.stop_confirmed === true,
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const act = async (kind: "verify" | "resolve") => {
    if (pending) return
    setPending(true)
    setError("")
    const path = kind === "verify" ? verifyPath : resolvePath
    try {
      const saved = pendingRequest(owner, path)
      const body = {
        expected_version: saved?.body.expected_version ?? operation.version,
        ...(kind === "resolve"
          ? {
              decision,
              evidence: evidence.trim(),
              stop_confirmed: stopConfirmed,
            }
          : {}),
      }
      await agentRequest(owner, path, body)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : "核验未完成，请重试。")
    } finally {
      setPending(false)
    }
  }
  return (
    <article className="agent-operation">
      <h3>
        {operation.tool} · {labels[operation.state]}
      </h3>
      <p className="agent-operation-id">操作 {operation.operation_id}</p>
      <p>
        检查点 {operation.checkpoint.phase} /{" "}
        {operation.checkpoint.durable_task_id} · 版本 {operation.version} · 尝试{" "}
        {operation.attempts} 次
      </p>
      <p>
        {operation.policy === "safe"
          ? "纯操作可有界重放"
          : operation.policy === "idempotent"
            ? "仅按原操作身份核验外部幂等结果"
            : "不可判定副作用，不会自动重发"}
      </p>
      {operation.reason && <p>{operation.reason}</p>}
      {operation.stop_reason && <p>停止依据：{operation.stop_reason}</p>}
      {operation.evidence && (
        <p>
          {operation.evidence.source === "owner_decision"
            ? "人工核验记录"
            : "外部核验记录"}
          ：{operation.evidence.text ?? "已保留原操作的核验来源"}
        </p>
      )}
      {operation.state !== "unknown" &&
        (readPending(owner, resolvePath) || readPending(owner, verifyPath)) && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              void act(readPending(owner, resolvePath) ? "resolve" : "verify")
            }
          >
            重试未确认核验请求
          </button>
        )}
      {(operation.state === "unknown" ||
        (run.cancellation &&
          !run.cancellation.confirmed_at &&
          !operation.stop_confirmed_at)) && (
        <>
          <p>
            核验与人工记录不会重发工具，也不会扩大原任务授权。确认生效不等于科研交付成功；未确认停止的执行仍保持停止未确认。
          </p>
          <button
            type="button"
            disabled={pending || !owner}
            onClick={() => void act("verify")}
          >
            核验原操作结果
          </button>
          <label>
            核验结论
            <select
              value={decision}
              onChange={(event) => setDecision(event.target.value)}
              disabled={pending}
            >
              <option value="confirm_effect">已确认生效</option>
              <option value="confirm_no_effect">已确认未生效</option>
            </select>
          </label>
          <label>
            人工核验依据
            <textarea
              value={evidence}
              maxLength={2000}
              onChange={(event) => setEvidence(event.target.value)}
              disabled={pending}
            />
          </label>
          {run.cancellation && (
            <label>
              <input
                type="checkbox"
                checked={stopConfirmed}
                onChange={(event) => setStopConfirmed(event.target.checked)}
                disabled={pending}
              />
              我已独立核验外部操作停止，并在依据中记录证据
            </label>
          )}
          <button
            type="button"
            disabled={pending || !owner || !evidence.trim()}
            onClick={() => void act("resolve")}
          >
            保存人工核验记录
          </button>
        </>
      )}
      {error && (
        <>
          <p role="alert">{error}</p>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              discardPendingRequest(owner, resolvePath)
              discardPendingRequest(owner, verifyPath)
              setError("")
              onDone()
            }}
          >
            放弃本地重试并刷新
          </button>
        </>
      )}
    </article>
  )
}
export function OperationReview({
  run,
  owner,
  supported,
  onDone,
}: {
  run: Run
  owner: string
  supported: boolean
  onDone: () => void
}) {
  const required = [
    "result_unknown",
    "cancel_unconfirmed",
    "interrupted",
    "cancelled",
  ].includes(run.status)
  const operations = useQuery({
    queryKey: ["agent-operations", owner, run.id],
    enabled: required && !!owner && supported,
    retry: false,
    refetchInterval: 5000,
    queryFn: async ({ signal }) => {
      const data = await agentJson<Operation[]>(
        agentRoutes.runsByRunIdOperations(run.id),
        undefined,
        "GET",
        signal,
      )
      if (!Array.isArray(data))
        throw new Error("操作记录格式不可用，请更新服务后重试。")
      return data
    },
  })
  if (!required) return null
  const done = () => {
    void operations.refetch()
    onDone()
  }
  return (
    <section aria-label="工具操作核验" className="agent-operation-review">
      <h2>工具操作核验</h2>
      {run.cancellation && (
        <p role="status">
          {run.cancellation.confirmed_at
            ? "已确认停止执行；已产生的副作用和研究材料仍保留，结果未知项需另行核验。"
            : "已请求停止，但尚未确认停止。不会发起新的模型请求或工具操作。"}
          <br />
          {run.cancellation.reason}
        </p>
      )}
      {!supported && (
        <p role="alert">
          当前服务不支持操作核验协议，不能将停止请求视为已确认取消。
        </p>
      )}
      {operations.error && <p role="alert">{operations.error.message}</p>}
      {operations.isPending && supported && <p>正在读取持久操作记录…</p>}
      {operations.data?.map((operation) => (
        <Review
          key={operation.operation_id}
          operation={operation}
          run={run}
          owner={owner}
          onDone={done}
        />
      ))}
    </section>
  )
}
