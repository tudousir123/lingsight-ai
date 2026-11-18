import { useState } from "react"
import { agentRoutes } from "@/lib/upstreamRoutes.gen"
import { agentJson } from "./api"

export type FileInputRef = {
  id: string
  name: string
  sha256: string
  bytes: number
}

export function FileInputs({
  value,
  onChange,
  disabled,
  onBusy,
}: {
  value: FileInputRef[]
  onChange: (refs: FileInputRef[]) => void
  disabled: boolean
  onBusy: (busy: boolean) => void
}) {
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  return (
    <section className="agent-file-inputs" aria-label="授权分析材料">
      <label>
        添加授权文件（CSV / JSON / TXT / MD，≤64 KB）
        <input
          type="file"
          aria-label="授权分析文件"
          accept=".csv,.json,.txt,.md"
          disabled={disabled || busy || value.length >= 8}
          onChange={async (event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ""
            if (!file) return
            setError("")
            if (file.size > 65536 || file.size === 0) {
              setError("请选择非空、64 KB 以内的 UTF-8 文本材料。")
              return
            }
            setBusy(true)
            onBusy(true)
            try {
              const content = new TextDecoder("utf-8", { fatal: true }).decode(
                await file.arrayBuffer(),
              )
              const ref = await agentJson<FileInputRef>(agentRoutes.inputs(), {
                name: file.name,
                content,
              })
              onChange([...value, ref])
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "文件上传失败，未附加材料。",
              )
            } finally {
              setBusy(false)
              onBusy(false)
            }
          }}
        />
      </label>
      <p>
        {disabled
          ? "当前服务尚不支持受控文件，或正在执行。"
          : "仅上传你获授权的材料。文件私有复制到个人 Agent；原文只读。模型可接收来源、代码及输出，数据处理授权仍须有效。"}
      </p>
      {busy && <p role="status">正在保存私有输入…</p>}
      {value.map((ref) => (
        <div key={ref.id}>
          <strong>{ref.name}</strong>
          <small className="agent-artifact-version">
            SHA-256：{ref.sha256}
          </small>
          <button
            type="button"
            disabled={busy}
            onClick={() => onChange(value.filter((item) => item.id !== ref.id))}
          >
            移除 {ref.name}
          </button>
        </div>
      ))}
      {error && (
        <p role="alert" className="agent-error">
          {error}
        </p>
      )}
    </section>
  )
}
