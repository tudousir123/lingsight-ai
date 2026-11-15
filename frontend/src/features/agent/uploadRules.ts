// Pure client-side upload rules; the server's error codes stay authoritative.
// No imports: node-side specs load this file directly.

export const MAX_UPLOAD_BYTES = 2_000_000_000
export const UPLOAD_EXTENSIONS = ["mp4", "avi"] as const

export function uploadPrecheck(file: {
  name: string
  size: number
}): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? ""
  if (!(UPLOAD_EXTENSIONS as readonly string[]).includes(extension))
    return "仅支持 mp4 或 avi 视频。"
  if (file.size === 0) return "文件为空。"
  if (file.size > MAX_UPLOAD_BYTES) return "文件超过 2 GB 上限。"
  return null
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`
}
