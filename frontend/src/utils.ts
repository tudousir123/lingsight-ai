import { AxiosError } from "axios"

const accountErrors: Record<string, string> = {
  "Incorrect email or password": "邮箱或密码错误",
  "Inactive user": "账号已停用，请联系管理员",
  "Invalid token": "重置链接无效或已过期，请重新申请",
  "Incorrect password": "当前密码错误",
  "New password cannot be the same as the current one":
    "新密码不能与当前密码相同",
  "The user with this email already exists in the system.": "该邮箱已被注册",
  "The user with this email already exists in the system": "该邮箱已被注册",
  "User with this email already exists": "该邮箱已被注册",
  "Super users are not allowed to delete themselves":
    "管理员不能删除自己的账号",
  "The user doesn't have enough privileges": "你没有执行此操作的权限",
  "User not found": "用户不存在",
  "The user with this id does not exist in the system": "用户不存在",
}

const accountFields: Record<string, string> = {
  full_name: "姓名",
  email: "邮箱",
  password: "密码",
  new_password: "新密码",
  current_password: "当前密码",
  confirm_password: "确认密码",
}

function validationMessage(error: unknown): string {
  if (typeof error !== "object" || error === null) return "提交信息格式不正确"
  const field =
    "loc" in error && Array.isArray(error.loc)
      ? (accountFields[String(error.loc[error.loc.length - 1])] ?? "提交信息")
      : "提交信息"
  if (
    "type" in error &&
    "ctx" in error &&
    typeof error.ctx === "object" &&
    error.ctx !== null
  ) {
    if (
      error.type === "string_too_long" &&
      "max_length" in error.ctx &&
      typeof error.ctx.max_length === "number"
    ) {
      return `${field}最多 ${error.ctx.max_length} 个字符`
    }
    if (
      error.type === "string_too_short" &&
      "min_length" in error.ctx &&
      typeof error.ctx.min_length === "number"
    ) {
      return `${field}至少需要 ${error.ctx.min_length} 个字符`
    }
  }
  return `${field}格式不正确，请检查后重试`
}

function extractErrorMessage(err: Error): string {
  if (err instanceof AxiosError) {
    const detail: unknown = err.response?.data?.detail
    if (Array.isArray(detail) && detail.length)
      return detail.map(validationMessage).join("；")
    if (typeof detail === "string") return accountErrors[detail] ?? detail
  }
  return "操作未完成，请稍后重试。"
}

export const handleError = function (this: (msg: string) => void, err: Error) {
  const errorMessage = extractErrorMessage(err)
  this(errorMessage)
}

export const getInitials = (name: string): string => {
  return name
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase()
}
