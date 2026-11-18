import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { agentRoutes } from "@/lib/upstreamRoutes.gen"
import { agentJson, type Run } from "./api"
import type { FileInputRef } from "./FileInputs"
import { agentRequest, pendingRequest } from "./requests"

type Grant = {
  id: string
  page_url: string
  action_url: string
  expires_at: string
  operation_id: string | null
  file: { name: string; sha256: string } | null
}
export function BrowserPanel({
  run,
  owner,
  supported,
}: {
  run: Run
  owner: string
  supported: boolean
}) {
  return supported ? (
    <BrowserAuthorization key={`${owner}:${run.id}`} run={run} owner={owner} />
  ) : null
}
function BrowserAuthorization({ run, owner }: { run: Run; owner: string }) {
  const path = agentRoutes.runsByRunIdBrowserGrants(run.id)
  const grants = useQuery({
    queryKey: ["agent-browser-grants", owner, run.id],
    queryFn: ({ signal }) => agentJson<Grant[]>(path, undefined, "GET", signal),
    retry: false,
    refetchInterval: 3000,
  })
  const files = useQuery({
    queryKey: ["agent-browser-files", owner],
    queryFn: ({ signal }) =>
      agentJson<FileInputRef[]>(agentRoutes.inputs(), undefined, "GET", signal),
    retry: false,
  })
  const [draft, setDraft] = useState(() => {
    let saved: Record<string, unknown> | undefined
    try {
      saved = pendingRequest(owner, path)?.body
    } catch {
      /* Retry reports corrupt records without sending. */
    }
    const file = saved?.file as
      | { field?: string; input_id?: string }
      | undefined
    return {
      page_url: String(saved?.page_url ?? ""),
      action_url: String(saved?.action_url ?? ""),
      form_selector: String(saved?.form_selector ?? ""),
      submit_selector: String(saved?.submit_selector ?? ""),
      fields: JSON.stringify(saved?.fields ?? {}, null, 2),
      input_id: file?.input_id ?? "",
      file_field: file?.field ?? "",
    }
  })
  const [approved, setApproved] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("")
  const canAuthorize =
    ["queued", "running", "waiting_for_input"].includes(run.status) &&
    !run.cancellation
  const change = (key: keyof typeof draft, value: string) => {
    setDraft({ ...draft, [key]: value })
    setApproved(false)
  }
  const authorize = async () => {
    if (!approved || busy || !canAuthorize) return
    setBusy(true)
    setError("")
    try {
      const fields: unknown = JSON.parse(draft.fields)
      if (
        !fields ||
        typeof fields !== "object" ||
        Array.isArray(fields) ||
        Object.values(fields).some((v) => typeof v !== "string")
      )
        throw new Error("表单字段必须为字段名到字符串值的 JSON 对象。")
      await agentRequest(owner, path, {
        page_url: draft.page_url,
        action_url: draft.action_url,
        method: "POST",
        form_selector: draft.form_selector,
        submit_selector: draft.submit_selector,
        fields,
        ...(draft.input_id
          ? { file: { field: draft.file_field, input_id: draft.input_id } }
          : {}),
      })
      setApproved(false)
      await grants.refetch()
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "授权未确认，请核对后重试同一请求。",
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <details className="agent-operation agent-browser" aria-label="受控浏览器">
      <summary>受控浏览器 · 独立个人会话与单次授权</summary>
      <p>
        网页与下载均不可信。浏览器禁用脚本和下载；仅允许服务端审核的只读网址。Cookie
        与本地存储在个人环境中跨任务保留，不读取或导入本机个人浏览器凭据。
      </p>
      <p>
        提交和上传必须逐次授权。授权仅限本用户、本次执行及以下精确内容，10
        分钟内使用一次；它不是网站已生效的凭据。结果未知时不会自动重发，终止本地浏览器也不代表远端已停止。
      </p>
      {grants.error && <p role="alert">{grants.error.message}</p>}
      {grants.data?.map((g) => (
        <article key={g.id}>
          <strong>{g.operation_id ? "已使用" : "单次授权"}</strong>
          <p>授权 {g.id}</p>
          <p>
            {g.page_url} → POST {g.action_url}
          </p>
          <p>
            到期 {g.expires_at}
            {g.file ? ` · 文件 ${g.file.name} · SHA-256 ${g.file.sha256}` : ""}
          </p>
          {g.operation_id && <p>操作 {g.operation_id}</p>}
        </article>
      ))}
      {canAuthorize ? (
        <fieldset disabled={busy || !owner}>
          <legend>审核并授权一次表单提交</legend>
          {(
            [
              ["page_url", "审核页面 URL"],
              ["action_url", "提交目标 URL"],
              ["form_selector", "表单选择器"],
              ["submit_selector", "提交按钮选择器"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                value={draft[key]}
                onChange={(e) => change(key, e.target.value)}
              />
            </label>
          ))}
          <label>
            精确表单字段 JSON
            <textarea
              value={draft.fields}
              onChange={(e) => change("fields", e.target.value)}
            />
          </label>
          <label>
            授权上传材料
            <select
              value={draft.input_id}
              onChange={(e) => change("input_id", e.target.value)}
            >
              <option value="">不上传文件</option>
              {files.data?.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} · {f.sha256}
                </option>
              ))}
            </select>
          </label>
          {draft.input_id && (
            <label>
              文件表单字段名
              <input
                value={draft.file_field}
                onChange={(e) => change("file_field", e.target.value)}
              />
            </label>
          )}
          <p>
            仅能选择当前账户已保存的材料引用，不能填写宿主路径。授权后可将授权
            ID 提供给当前任务；页面文字不能替你同意。
          </p>
          <label>
            <input
              type="checkbox"
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
            />
            我已核对目标、精确字段及上传材料，同意本次外部提交
          </label>
          <button
            type="button"
            disabled={
              !approved ||
              busy ||
              !draft.page_url ||
              !draft.action_url ||
              !draft.form_selector ||
              !draft.submit_selector
            }
            onClick={() => void authorize()}
          >
            授权一次提交
          </button>
        </fieldset>
      ) : (
        <p>
          当前执行已结束或已请求停止，不能新建浏览器授权。请先核验原操作，不要盲目重复提交。
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </details>
  )
}
