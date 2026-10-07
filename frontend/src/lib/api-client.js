const configuredApiUrl = import.meta.env?.VITE_API_URL?.trim() ?? ''

export function normalizeApiBaseUrl(value) {
  if (!value) return ''

  try {
    const url = new URL(value)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== '/' && url.pathname !== '')
    ) {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}

export const apiBaseUrl = normalizeApiBaseUrl(configuredApiUrl)

export function buildApiUrl(path, baseUrl = apiBaseUrl) {
  if (typeof path !== 'string' || !path.startsWith('/api/')) return null
  if (baseUrl === null) return null
  return baseUrl ? new URL(path, baseUrl).toString() : path
}

function errorResult(code, message, status, extra = {}) {
  return Object.freeze({
    ok: false,
    code,
    message,
    ...(typeof status === 'number' ? { status } : {}),
    ...extra,
  })
}

function retryAfterSeconds(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const seconds = Number(value)
  return Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 3_600 ? seconds : null
}

const inFlightGets = new WeakMap()
const GET_ABORT_GRACE_MS = 25

function abortedResult() {
  return errorResult('REQUEST_ABORTED', '', undefined, { aborted: true })
}

function headerKey(headers = {}) {
  return Object.entries(headers)
    .filter(([name]) => name.toLowerCase() !== 'authorization')
    .map(([name, value]) => [name.toLowerCase(), String(value)])
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}:${value}`)
    .join('\n')
}

function getBucket(fetchImpl, accessToken) {
  let sessions = inFlightGets.get(fetchImpl)
  if (!sessions) {
    sessions = new Map()
    inFlightGets.set(fetchImpl, sessions)
  }
  const sessionKey = accessToken || ''
  let requests = sessions.get(sessionKey)
  if (!requests) {
    requests = new Map()
    sessions.set(sessionKey, requests)
  }
  return { requests, sessionKey, sessions }
}

function readTransport(fetchImpl, url, options, bucket, requestKey) {
  const controller = new AbortController()
  const entry = { controller, subscribers: 0, abortTimer: null, settled: false, promise: null }
  entry.promise = (async () => {
    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal })
      let body = null
      try {
        body = await response.json()
      } catch {
        // Empty and malformed responses are validated by the calling service.
      }
      return { response, body }
    } catch (error) {
      return { fetchError: true, aborted: controller.signal.aborted || error?.name === 'AbortError' }
    } finally {
      entry.settled = true
      if (entry.abortTimer) clearTimeout(entry.abortTimer)
      if (bucket.requests.get(requestKey) === entry) bucket.requests.delete(requestKey)
      if (bucket.requests.size === 0) bucket.sessions.delete(bucket.sessionKey)
    }
  })()
  bucket.requests.set(requestKey, entry)
  return entry
}

function subscribeToGet(entry, signal) {
  if (signal?.aborted) return Promise.resolve(abortedResult())
  if (entry.abortTimer) {
    clearTimeout(entry.abortTimer)
    entry.abortTimer = null
  }
  entry.subscribers += 1
  return new Promise((resolve) => {
    let finished = false
    const finish = (value) => {
      if (finished) return
      finished = true
      signal?.removeEventListener('abort', onAbort)
      entry.subscribers -= 1
      resolve(value)
    }
    const onAbort = () => {
      finish(abortedResult())
      if (!entry.settled && entry.subscribers === 0 && !entry.abortTimer) {
        // Give React StrictMode's immediate setup/cleanup/setup cycle time to
        // attach the replacement subscriber before cancelling shared I/O.
        entry.abortTimer = setTimeout(() => {
          entry.abortTimer = null
          if (!entry.settled && entry.subscribers === 0) entry.controller.abort()
        }, GET_ABORT_GRACE_MS)
      }
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    entry.promise.then(finish)
  })
}

export function normalizeApiError(status, body, fallbackMessage, retryAfter = null) {
  const code =
    typeof body?.error?.code === 'string' && body.error.code.length <= 100
      ? body.error.code
      : 'API_REQUEST_FAILED'

  if (status === 401) {
    return errorResult(code, 'Your session has expired. Sign in again.', status)
  }
  if (status === 429) {
    const seconds = retryAfterSeconds(retryAfter)
    return errorResult(code, 'Too many attempts. Please wait a moment and try again.', status, seconds === null ? {} : { retryAfterSeconds: seconds })
  }
  return errorResult(code, fallbackMessage, status)
}

export async function apiRequest({
  accessToken,
  fallbackMessage = 'The service is unavailable. Please try again.',
  fetchImpl = globalThis.fetch,
  headers,
  method = 'GET',
  path,
  payload,
  requestBody,
  signal,
}) {
  const url = buildApiUrl(path)
  if (!url) {
    return errorResult(
      'API_CONFIGURATION_INVALID',
      'The application service is not configured correctly.',
    )
  }

  const normalizedMethod = method.toUpperCase()
  const requestHeaders = {
    ...headers,
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(payload ? { 'Content-Type': 'application/json' } : {}),
  }
  const options = {
    method: normalizedMethod,
    headers: requestHeaders,
    ...(payload
      ? { body: JSON.stringify(payload) }
      : requestBody
        ? { body: requestBody }
        : {}),
  }

  let transport
  if (normalizedMethod === 'GET') {
    if (signal?.aborted) return abortedResult()
    const bucket = getBucket(fetchImpl, accessToken)
    const requestKey = `${url}\n${headerKey(requestHeaders)}`
    const entry = bucket.requests.get(requestKey) ?? readTransport(fetchImpl, url, options, bucket, requestKey)
    transport = await subscribeToGet(entry, signal)
    if (transport?.aborted) return transport
  } else {
    try {
      const response = await fetchImpl(url, options)
      let body = null
      try {
        body = await response.json()
      } catch {
        // Empty and malformed responses are validated by the calling service.
      }
      transport = { response, body }
    } catch {
      return errorResult('API_UNAVAILABLE', fallbackMessage)
    }
  }

  if (transport.fetchError) {
    return transport.aborted ? abortedResult() : errorResult('API_UNAVAILABLE', fallbackMessage)
  }
  const { response, body } = transport

  if (!response.ok) {
    return normalizeApiError(response.status, body, fallbackMessage, response.headers?.get?.('Retry-After') ?? null)
  }

  return Object.freeze({ ok: true, status: response.status, data: body })
}
