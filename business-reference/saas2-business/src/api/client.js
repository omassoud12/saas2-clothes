// Small fetch wrapper: base URL, auth header, JSON, abort support, and one error shape for the UI.

const BASE = import.meta.env?.VITE_API_URL ?? '';

let getToken = async () => null;
/** Call once at startup, e.g. setTokenProvider(async () => (await supabase.auth.getSession()).data.session?.access_token). */
export function setTokenProvider(fn) {
  getToken = fn;
}

export class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * GET helper. Query params with value null/undefined/"all"/"" are dropped.
 * The account (tenant) is NEVER sent from the client: the backend takes it from the session.
 */
export async function apiGet(path, params = {}, { signal } = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === null || v === undefined || v === '' || v === 'all') return;
    qs.set(k, String(v));
  });
  const url = `${BASE}${path}${qs.toString() ? `?${qs}` : ''}`;
  const token = await getToken();
  let res;
  try {
    res = await fetch(url, {
      signal,
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      credentials: 'include',
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('No connection. Check the internet and try again.', { code: 'NETWORK' });
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.error?.message
      || (res.status === 403 ? 'You don’t have access to this.' : res.status === 401 ? 'Please log in again.' : 'Something went wrong. Try again.');
    throw new ApiError(message, { status: res.status, code: body?.error?.code, details: body?.error?.details });
  }
  return body;
}

/** POST/DELETE helper with the same auth and error handling as apiGet. */
export async function apiSend(method, path, body, { signal } = {}) {
  const token = await getToken();
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('No connection. Check the internet and try again.', { code: 'NETWORK' });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(data?.error?.message || 'Something went wrong. Try again.', { status: res.status, code: data?.error?.code });
  }
  return data;
}
