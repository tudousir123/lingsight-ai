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

function extractErrorMessage(err: Error): string {
  if (err instanceof AxiosError) {
    const detail: unknown = err.response?.data?.detail
    if (Array.isArray(detail)) return "提交的信息不符合要求，请检查各字段。"
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
