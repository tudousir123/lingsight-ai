import type { MediaInfo } from "@/client"

/**
 * Playable src for a trial's media. The `<video>` element cannot send an
 * Authorization header, so the JWT is attached as a query parameter — the
 * media route accepts exactly that (and only that) fallback.
 */
export function mediaSrc(info: MediaInfo | undefined | null): string | null {
  if (info?.status !== "available" || !info.url) {
    return null
  }
  const token = localStorage.getItem("access_token")
  return token ? `${info.url}?token=${encodeURIComponent(token)}` : info.url
}

export function mediaKindLabel(kind: MediaInfo["kind"]): string {
  return kind === "overlay" ? "推理叠加视频" : "原始试次视频"
}
