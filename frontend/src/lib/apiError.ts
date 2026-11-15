// Branch on HTTP status and `detail.code` only (ADR-0019 error contract
// `{detail:{code,message,fields?}}`); the server message is never used for
// control flow. Legacy string `detail` responses degrade to status handling.

import { AxiosError } from "axios"

export type ApiProblem = {
  status: number | null
  code: string | null
  message: string | null
  fields: Record<string, string>
}

export class ApiRequestError extends Error {
  constructor(public problem: ApiProblem) {
    super(problem.message ?? `请求失败（${problem.status ?? "网络错误"}）`)
  }
}

function fromBody(status: number | null, body: unknown): ApiProblem {
  const detail =
    typeof body === "object" && body !== null
      ? (body as { detail?: unknown }).detail
      : undefined
  if (typeof detail === "object" && detail !== null && !Array.isArray(detail)) {
    const { code, message, fields } = detail as Record<string, unknown>
    return {
      status,
      code: typeof code === "string" ? code : null,
      message: typeof message === "string" ? message : null,
      fields:
        typeof fields === "object" && fields !== null
          ? Object.fromEntries(
              Object.entries(fields).map(([key, value]) => [
                key,
                String(value),
              ]),
            )
          : {},
    }
  }
  return {
    status,
    code: null,
    message: typeof detail === "string" ? detail : null,
    fields: {},
  }
}

export async function problemFromResponse(
  response: Response,
): Promise<ApiProblem> {
  return fromBody(response.status, await response.json().catch(() => ({})))
}

export function apiProblem(error: unknown): ApiProblem {
  if (error instanceof ApiRequestError) return error.problem
  if (error instanceof AxiosError) {
    return fromBody(error.response?.status ?? null, error.response?.data)
  }
  return {
    status: null,
    code: null,
    message: error instanceof Error ? error.message : null,
    fields: {},
  }
}

const codeText: Record<string, string> = {
  authentication_required: "登录已失效，请重新登录。",
  permission_denied: "你没有权限执行此操作。",
  resource_not_found: "资源不存在，或不属于当前账号。",
  state_conflict: "当前状态不允许此操作，请刷新后重试。",
  stale_version: "候选或确认版本已过期，请重新读取后再提交。",
  idempotency_conflict: "该请求与之前使用同一幂等键的内容不一致，请重新发起。",
  last_project_reference: "这是该视频在项目中的最后一个归组，不能移出。",
  project_confirmation_required: "请使用项目视频的预标注确认流程。",
  file_too_large: "文件超过 2 GB 上限。",
  payload_too_large: "提交内容过大。",
  unsupported_media_type: "仅支持 mp4 或 avi 视频。",
  invalid_input: "提交的信息不符合要求。",
  invalid_geometry:
    "标注几何无效：请确认坐标都在画面内，水池为圆、标志物为不自相交的多边形，且起点在水池内。",
  invalid_video: "视频无法解码或为空，请检查文件后重试。",
  upstream_error: "上游服务暂时异常，请稍后重试。",
  service_unavailable: "服务暂不可用，请稍后重试。",
}

const statusText: Record<number, string> = {
  401: codeText.authentication_required,
  403: codeText.permission_denied,
  404: codeText.resource_not_found,
  409: codeText.state_conflict,
  413: codeText.payload_too_large,
  415: codeText.unsupported_media_type,
  422: codeText.invalid_input,
  502: codeText.upstream_error,
  503: codeText.service_unavailable,
}

export function problemText(error: unknown, fallback: string): string {
  const problem = apiProblem(error)
  const known = problem.code ? codeText[problem.code] : undefined
  if (known) {
    const fields = Object.values(problem.fields)
    return fields.length ? `${known}（${fields.join("；")}）` : known
  }
  // Unknown codes and legacy string details: the server text beats a generic status line.
  return (
    problem.message ??
    (problem.status ? statusText[problem.status] : undefined) ??
    fallback
  )
}
