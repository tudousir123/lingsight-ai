import { useQuery } from "@tanstack/react-query"
import useAuth from "@/hooks/useAuth"
import { agentRoutes } from "@/lib/upstreamRoutes.gen"
import { agentJson } from "./api"

export type ExecutionCapability = {
  contract: "durable-run-v1"
  engine: "pi-durable"
  version: "1.5.2"
  requests: "persistent-v1"
  recovery: "safe-v1"
  operations: "ledger-v1"
  cancellation: "verified-v1"
  enabled: boolean
}

export function useExecutionCapability() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ["agent-execution-capability", user?.id],
    enabled: !!user?.id,
    queryFn: async ({ signal }) => {
      const response = await agentJson<{ execution?: ExecutionCapability }>(
        agentRoutes.capabilities(),
        undefined,
        "GET",
        signal,
      )
      const capability = response?.execution
      if (
        capability?.contract !== "durable-run-v1" ||
        capability.engine !== "pi-durable" ||
        capability.version !== "1.5.2" ||
        capability.requests !== "persistent-v1" ||
        capability.recovery !== "safe-v1" ||
        capability.operations !== "ledger-v1" ||
        capability.cancellation !== "verified-v1" ||
        typeof capability.enabled !== "boolean"
      )
        throw new Error(
          "执行能力不可用：Agent 服务缺少兼容的 Pi Durable 协议。",
        )
      return capability
    },
    retry: false,
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  })
}

export function ExecutionStatus({
  loading,
  capability,
  error,
  onRetry,
}: {
  loading: boolean
  capability?: ExecutionCapability
  error: Error | null
  onRetry: () => void
}) {
  return (
    <section className="agent-personal-status" aria-label="执行引擎">
      <div>
        <strong>执行引擎</strong>
        <span>
          {loading
            ? "正在核验执行能力…"
            : error
              ? "执行能力不可用"
              : capability?.enabled
                ? "Pi Durable · 1.5.2"
                : "模型或数据处理授权未配置"}
        </span>
      </div>
      <p>任务完成以科研交付契约核验为准，不以模型或引擎结束为准。</p>
      {(error || (!loading && !capability?.enabled)) && (
        <div>
          <p role="alert">
            {error?.message ||
              "未配置明确授权的模型服务，已禁用新执行。历史材料仍可读取。"}
          </p>
          <button type="button" onClick={onRetry}>
            重试执行能力
          </button>
        </div>
      )}
    </section>
  )
}
