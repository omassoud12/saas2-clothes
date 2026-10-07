import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  apiRequest,
  buildApiUrl,
  normalizeApiBaseUrl,
  normalizeApiError,
} from './api-client.js'

describe('frontend API client', () => {
  test('accepts only a clean HTTP(S) backend origin', () => {
    assert.equal(normalizeApiBaseUrl('https://api.example.test'), 'https://api.example.test')
    assert.equal(normalizeApiBaseUrl('http://localhost:3001/'), 'http://localhost:3001')
    assert.equal(normalizeApiBaseUrl('https://user:pass@example.test'), null)
    assert.equal(normalizeApiBaseUrl('javascript:alert(1)'), null)
  })

  test('builds only application API paths', () => {
    assert.equal(buildApiUrl('/api/health', 'https://api.example.test'), 'https://api.example.test/api/health')
    assert.equal(buildApiUrl('/other', 'https://api.example.test'), null)
  })

  test('adds bearer and JSON headers without leaking request failures', async () => {
    let captured
    const result = await apiRequest({
      accessToken: 'synthetic-token',
      fetchImpl: async (url, options) => {
        captured = { url, options }
        return { ok: true, status: 200, async json() { return { ready: true } } }
      },
      method: 'POST',
      path: '/api/example',
      payload: { value: 1 },
    })

    assert.equal(result.ok, true)
    assert.equal(captured.url, '/api/example')
    assert.equal(captured.options.headers.Authorization, 'Bearer synthetic-token')
    assert.equal(captured.options.headers['Content-Type'], 'application/json')
    assert.equal(captured.options.body, '{"value":1}')

    const failed = await apiRequest({
      fetchImpl: async () => { throw new Error('private network detail') },
      path: '/api/example',
      fallbackMessage: 'Please try again.',
    })
    assert.deepEqual(failed, {
      ok: false,
      code: 'API_UNAVAILABLE',
      message: 'Please try again.',
    })
  })

  test('normalizes server errors to bounded safe messages', () => {
    assert.deepEqual(
      normalizeApiError(401, { error: { code: 'AUTHENTICATION_REQUIRED' } }, 'fallback'),
      {
        ok: false,
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Your session has expired. Sign in again.',
        status: 401,
      },
    )
    assert.equal(
      normalizeApiError(500, { error: { code: 42, message: 'private detail' } }, 'Safe fallback').message,
      'Safe fallback',
    )
  })

  test('retains only a bounded numeric Retry-After hint for rate limits', () => {
    assert.deepEqual(normalizeApiError(429, { error: { code: 'RATE_LIMITED' } }, 'fallback', '45'), {
      ok: false, code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a moment and try again.', status: 429, retryAfterSeconds: 45,
    })
    assert.equal(normalizeApiError(429, {}, 'fallback', 'private-date').retryAfterSeconds, undefined)
    assert.equal(normalizeApiError(429, {}, 'fallback', '999999').retryAfterSeconds, undefined)
  })

  test('shares only equivalent in-flight GET work for the same session', async () => {
    let calls = 0
    let release
    const pending = new Promise((resolve) => { release = resolve })
    const fetchImpl = async () => {
      calls += 1
      await pending
      return { ok: true, status: 200, async json() { return { value: calls } } }
    }
    const first = apiRequest({ accessToken: 'session-a', fetchImpl, path: '/api/example?view=one' })
    const second = apiRequest({ accessToken: 'session-a', fetchImpl, path: '/api/example?view=one' })
    assert.equal(calls, 1)
    release()
    assert.deepEqual(await first, await second)

    await apiRequest({ accessToken: 'session-a', fetchImpl, path: '/api/example?view=one' })
    assert.equal(calls, 2, 'settled reads are not cached')
  })

  test('does not share GET work across authenticated sessions', async () => {
    let calls = 0
    const fetchImpl = async () => {
      calls += 1
      return { ok: true, status: 200, async json() { return { ready: true } } }
    }
    await Promise.all([
      apiRequest({ accessToken: 'session-a', fetchImpl, path: '/api/example' }),
      apiRequest({ accessToken: 'session-b', fetchImpl, path: '/api/example' }),
    ])
    assert.equal(calls, 2)
  })

  test('lets one GET subscriber abort without cancelling another subscriber', async () => {
    let calls = 0
    let release
    const pending = new Promise((resolve) => { release = resolve })
    const fetchImpl = async () => {
      calls += 1
      await pending
      return { ok: true, status: 200, async json() { return { ready: true } } }
    }
    const controller = new AbortController()
    const first = apiRequest({ accessToken: 'session', fetchImpl, path: '/api/example', signal: controller.signal })
    const second = apiRequest({ accessToken: 'session', fetchImpl, path: '/api/example' })
    controller.abort()
    assert.equal((await first).aborted, true)
    release()
    assert.equal((await second).ok, true)
    assert.equal(calls, 1)
  })

  test('cancels an unobserved GET after the StrictMode grace period', async () => {
    let underlyingAborted = false
    const fetchImpl = async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        underlyingAborted = true
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      }, { once: true })
    })
    const controller = new AbortController()
    const resultPromise = apiRequest({ accessToken: 'session', fetchImpl, path: '/api/example', signal: controller.signal })
    controller.abort()
    assert.equal((await resultPromise).aborted, true)
    await new Promise((resolve) => setTimeout(resolve, 40))
    assert.equal(underlyingAborted, true)
  })

  test('never deduplicates or generically aborts mutations', async () => {
    let calls = 0
    const fetchImpl = async (_url, options) => {
      calls += 1
      assert.equal(options.signal, undefined)
      return { ok: true, status: 201, async json() { return { saved: true } } }
    }
    const controller = new AbortController()
    controller.abort()
    const request = { accessToken: 'session', fetchImpl, method: 'POST', path: '/api/example', payload: { value: 1 }, signal: controller.signal }
    const [first, second] = await Promise.all([apiRequest(request), apiRequest(request)])
    assert.equal(first.ok, true)
    assert.equal(second.ok, true)
    assert.equal(calls, 2)
  })
})
