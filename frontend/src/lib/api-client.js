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

function errorResult(code, message, status) {
  return Object.freeze({
    ok: false,
    code,
    message,
    ...(typeof status === 'number' ? { status } : {}),
  })
}

export function normalizeApiError(status, body, fallbackMessage) {
  const code =
    typeof body?.error?.code === 'string' && body.error.code.length <= 100
      ? body.error.code
      : 'API_REQUEST_FAILED'

  if (status === 401) {
    return errorResult(code, 'Your session has expired. Sign in again.', status)
  }
  if (status === 429) {
    return errorResult(code, 'Too many attempts. Please wait a moment and try again.', status)
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
}) {
  const url = buildApiUrl(path)
  if (!url) {
    return errorResult(
      'API_CONFIGURATION_INVALID',
      'The application service is not configured correctly.',
    )
  }

  let response
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        ...headers,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(payload
        ? { body: JSON.stringify(payload) }
        : requestBody
          ? { body: requestBody }
          : {}),
    })
  } catch {
    return errorResult('API_UNAVAILABLE', fallbackMessage)
  }

  let body = null
  try {
    body = await response.json()
  } catch {
    // Empty and malformed responses are validated by the calling service.
  }

  if (!response.ok) {
    return normalizeApiError(response.status, body, fallbackMessage)
  }

  return Object.freeze({ ok: true, status: response.status, data: body })
}
