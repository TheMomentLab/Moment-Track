/**
 * API client — centralized HTTP communication with the backend.
 */

const DEFAULT_API_BASE = "/api/v1"
const rawApiBase = import.meta.env.VITE_API_BASE?.trim()

export const API_BASE = rawApiBase ? rawApiBase.replace(/\/+$/, "") : DEFAULT_API_BASE

export interface PaginatedResponse<T> {
  total: number
  items: T[]
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`
}

export function buildApiUrl(path: string): string {
  return `${API_BASE}${normalizePath(path)}`
}

function withPagination(path: string, limit: number, offset: number): string {
  const url = new URL(normalizePath(path), window.location.origin)
  url.searchParams.set("limit", String(limit))
  url.searchParams.set("offset", String(offset))
  return `${url.pathname}${url.search}`
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const isFormData = options?.body instanceof FormData
  const rawHeaders = options?.headers
  const normalizedHeaders =
    rawHeaders instanceof Headers
      ? Object.fromEntries(rawHeaders.entries())
      : Array.isArray(rawHeaders)
        ? Object.fromEntries(rawHeaders)
        : rawHeaders ?? {}

  const res = await fetch(buildApiUrl(path), {
    ...options,
    headers: isFormData ? normalizedHeaders : { "Content-Type": "application/json", ...normalizedHeaders },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export async function getAllPaginated<T>(path: string, pageSize = 200): Promise<T[]> {
  let offset = 0
  const items: T[] = []

  for (;;) {
    const page = await request<PaginatedResponse<T>>(withPagination(path, pageSize, offset))
    items.push(...page.items)

    if (page.items.length === 0 || items.length >= page.total) {
      return items
    }

    offset += page.items.length
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  postForm: <T>(path: string, body: FormData) =>
    request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
}
