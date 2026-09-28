/** Real Flask transport. Cookies remain HttpOnly; CSRF tokens stay in memory. */
import type { GlobalFilters } from './types'
export const USE_MOCKS = false
const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
let csrfToken: string | null = null
// Compatibility with source page signatures; bearer tokens are not used.
export function getToken(): null { return null }
export function storeToken(_token: string | null): void { /* Flask owns the session. */ }
export type AuthHeaders = { Authorization?: string }
export type ApiErrorKind = 'network' | 'auth' | 'forbidden' | 'not_found' | 'no_data' | 'pipeline' | 'model' | 'server'
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly kind: ApiErrorKind, readonly endpoint: string) {
    super(message); this.name = 'ApiError'
  }
}
async function request<T>(endpoint: string, method: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(BASE_URL + endpoint, {
      method, credentials: 'include', cache: 'no-store',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(csrfToken && method !== 'GET' ? { 'X-CSRF-Token': csrfToken } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError('Cannot reach DineIQ. Start the existing backend and retry.', 0, 'network', endpoint)
  }
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const kinds: Record<number, ApiErrorKind> = {401:'auth',403:'forbidden',404:'not_found',422:'no_data',503:'pipeline'}
    if (response.status === 401 && !endpoint.startsWith('/api/auth/')) window.dispatchEvent(new Event('dineiq:session-expired'))
    throw new ApiError(payload?.error?.message ?? ('Request failed (' + response.status + ').'), response.status, kinds[response.status] ?? 'server', endpoint)
  }
  if (payload === null) throw new ApiError('The backend returned an invalid JSON response.', response.status, 'server', endpoint)
  if (typeof payload.csrf_token === 'string') csrfToken = payload.csrf_token
  if (payload.logged_out) csrfToken = null
  return payload as T
}
export function apiGet<T>(endpoint: string, _auth?: AuthHeaders): Promise<T> { return request(endpoint, 'GET') }
export function apiPost<T>(endpoint: string, body?: unknown, _auth?: AuthHeaders): Promise<T> { return request(endpoint, 'POST', body) }
export function apiDelete<T>(endpoint: string, _auth?: AuthHeaders): Promise<T> { return request(endpoint, 'DELETE') }
export function cleanFilters(filters: GlobalFilters): GlobalFilters {
  return Object.fromEntries(Object.entries(filters).filter(([,v]) => v !== undefined && v !== '' && v !== 'all'))
}
