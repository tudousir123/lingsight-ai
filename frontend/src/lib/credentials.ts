// Single reader for the session token. Storage stays in localStorage under
// "access_token" (unchanged); only reading and request assembly live here so
// a future refresh/expiry policy change touches exactly one module.

export const TOKEN_STORAGE_KEY = "access_token"

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY)
}

export function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function withTokenQuery(path: string): string {
  const token = getToken()
  if (!token) return path
  const separator = path.includes("?") ? "&" : "?"
  return `${path}${separator}token=${encodeURIComponent(token)}`
}
