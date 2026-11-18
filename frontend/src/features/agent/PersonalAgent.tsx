import { useQuery } from "@tanstack/react-query"
import useAuth from "@/hooks/useAuth"
import { agentEnvironmentContract, agentRoutes } from "@/lib/upstreamRoutes.gen"
import { agentJson, type PersonalAgent } from "./api"

export function usePersonalAgent() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ["personal-agent", user?.id],
    enabled: !!user?.id,
    queryFn: async ({ signal }) => {
      const identity = await agentJson<PersonalAgent>(
        agentRoutes.personalAgent(),
        undefined,
        "GET",
        signal,
      )
      if (
        !identity.id ||
        identity.owner_user_id !== user?.id ||
        !identity.environment?.id ||
        identity.environment.contract !== agentEnvironmentContract
      )
        throw new Error("个人 Agent 协议不兼容，请更新服务。")
      return identity
    },
    retry: false,
    refetchInterval: 5000,
    // Do not execute on a stale formerly-ready environment after a failed probe.
    refetchOnWindowFocus: true,
  })
}

export function PersonalAgentStatus({
  identity,
  loading,
  error,
  onRetry,
}: {
  identity?: PersonalAgent
  loading: boolean
  error?: Error | null
  onRetry: () => void
}) {
  return (
    <section
      className="agent-personal-status"
      aria-label="个人 Agent 与工作环境"
    >
      <div>
        <strong>个人 Agent</strong>
        <span>
          {error
            ? "个人环境不可用"
            : loading
              ? "正在连接个人环境…"
              : identity?.environment.status === "ready"
                ? "环境可用"
                : "个人环境不可用"}
        </span>
      </div>
      {identity && (
        <dl>
          <div>
            <dt>Agent 身份</dt>
            <dd>{identity.id}</dd>
          </div>
          <div>
            <dt>工作环境</dt>
            <dd>{identity.environment.id}</dd>
          </div>
        </dl>
      )}
      <p>
        同一身份跨任务保留；各任务上下文独立。原始输入只读，输出归属当前任务。
      </p>
      {(error || (!loading && identity?.environment.status !== "ready")) && (
        <div>
          <p role="alert">
            {error?.message ||
              "持久工作目录不可用，已禁用新执行，请联系管理员。"}
          </p>
          <button type="button" onClick={onRetry}>
            重试个人环境
          </button>
        </div>
      )}
    </section>
  )
}
