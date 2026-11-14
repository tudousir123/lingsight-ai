import { isAxiosError } from "axios"
import { z } from "zod"

export const FULL_NAME_MAX_LENGTH = 255
export const fullNameLengthMessage = `姓名最多 ${FULL_NAME_MAX_LENGTH} 个字符`
export const fullNameSchema = z
  .string()
  .max(FULL_NAME_MAX_LENGTH, fullNameLengthMessage)

export function setFullNameError(
  error: Error,
  setError: (
    name: "full_name",
    error: { type: string; message: string },
  ) => void,
): boolean {
  if (
    !isAxiosError<{ detail?: unknown }>(error) ||
    error.response?.status !== 422
  )
    return false
  const detail = error.response.data.detail
  if (!Array.isArray(detail)) return false
  const fieldError = detail.find(
    (item: unknown) =>
      typeof item === "object" &&
      item !== null &&
      "loc" in item &&
      Array.isArray(item.loc) &&
      item.loc[item.loc.length - 1] === "full_name",
  )
  if (!fieldError) return false
  setError("full_name", {
    type: "server",
    message:
      fieldError.type === "string_too_long"
        ? fullNameLengthMessage
        : "姓名无效，请检查后重试",
  })
  return true
}
