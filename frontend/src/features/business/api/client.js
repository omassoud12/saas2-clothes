// The Business reports' API client, on top of the app's own transport (src/lib/api-client.js through
// authenticatedApiRequest): same base URL, the Supabase session token, abort support. It keeps the
// reference's function names (apiGet, apiSend, ApiError) so the rest of the module is unchanged.
// The account (tenant) is NEVER sent from the client: the backend takes it from the session.
import { authenticatedApiRequest } from '../../../auth/owner-flow.js'
import { supabase } from '../../../lib/supabase.js'

export class ApiError extends Error {
  constructor(message, { status, code } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

const FALLBACK = 'Something went wrong. Try again.'

function toAbortError() {
  return new DOMException('Aborted', 'AbortError')
}

/** Query params with value null/undefined/""/"all" are dropped. */
export function queryString(params = {}) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '' || value === 'all') return
    query.set(key, String(value))
  })
  const text = query.toString()
  return text ? `?${text}` : ''
}

function unwrap(result) {
  if (result.aborted) throw toAbortError()
  if (!result.ok) {
    const message = result.status === 403 ? 'You don’t have access to this.' : result.message || FALLBACK
    throw new ApiError(message, { status: result.status, code: result.code })
  }
  return result.data
}

export async function apiGet(path, params = {}, { signal } = {}) {
  return unwrap(await authenticatedApiRequest({ supabase, path: `${path}${queryString(params)}`, method: 'GET', fallbackMessage: FALLBACK, signal }))
}

/** POST/PUT/DELETE with the same auth and error handling as apiGet. */
export async function apiSend(method, path, body, { signal } = {}) {
  return unwrap(await authenticatedApiRequest({ supabase, path, method, payload: body ?? undefined, fallbackMessage: FALLBACK, signal }))
}
