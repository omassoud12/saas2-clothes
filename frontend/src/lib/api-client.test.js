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
})
