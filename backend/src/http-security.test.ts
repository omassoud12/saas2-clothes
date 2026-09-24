import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, test } from 'node:test'
import express from 'express'
import { configureHttpSecurity, JSON_BODY_LIMIT, jsonNotFoundHandler } from './app.js'
import type { HttpRuntimeConfiguration } from './config/env.js'
import { errorHandler } from './middleware/error-handler.js'

const allowedOrigin = 'https://app.example.invalid'

function createTestApp(configuration: HttpRuntimeConfiguration = { corsAllowedOrigins: [allowedOrigin], trustProxyHops: 0 }) {
  const app = express()
  configureHttpSecurity(app, configuration)
  app.use(express.json({ limit: JSON_BODY_LIMIT }))
  app.get('/api/value', (_request, response) => response.json({ ok: true }))
  app.post('/api/value', (request, response) => response.json({ received: request.body }))
  app.get('/api/ip', (request, response) => response.json({ ip: request.ip }))
  app.get('/api/failure', () => { throw new Error('password=fake-password postgresql://fake:secret@db.invalid SELECT fake request-content') })
  app.use(jsonNotFoundHandler)
  app.use(errorHandler)
  return app
}

async function withServer<T>(app: ReturnType<typeof express>, operation: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
  })
  const { port } = server.address() as AddressInfo
  try { return await operation(`http://127.0.0.1:${port}`) }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
}

describe('HTTP CORS policy', () => {
  test('accepts an approved Origin and emits no credentials permission', async () => {
    await withServer(createTestApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/value`, { headers: { Origin: allowedOrigin } })
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('access-control-allow-origin'), allowedOrigin)
      assert.equal(response.headers.get('access-control-allow-credentials'), null)
    })
  })

  test('rejects an unapproved and unconfigured localhost Origin', async () => {
    await withServer(createTestApp(), async (baseUrl) => {
      for (const origin of ['https://other.example.invalid', 'http://localhost:5173']) {
        const response = await fetch(`${baseUrl}/api/value`, { headers: { Origin: origin } })
        assert.equal(response.status, 403)
        assert.equal(response.headers.get('access-control-allow-origin'), null)
        assert.deepEqual(await response.json(), { error: { code: 'CORS_ORIGIN_FORBIDDEN', message: 'Origin is not allowed' } })
      }
    })
  })

  test('allows requests without Origin through normal route handling', async () => {
    await withServer(createTestApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/value`)
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('access-control-allow-origin'), null)
    })
  })

  test('handles approved preflight with only approved methods and headers', async () => {
    await withServer(createTestApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/value`, { method: 'OPTIONS', headers: { Origin: allowedOrigin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Authorization, Content-Type, Idempotency-Key' } })
      assert.equal(response.status, 204)
      assert.equal(response.headers.get('access-control-allow-origin'), allowedOrigin)
      assert.equal(response.headers.get('access-control-allow-methods'), 'GET,POST,PATCH,DELETE,OPTIONS')
      assert.equal(response.headers.get('access-control-allow-headers'), 'Authorization,Content-Type,Idempotency-Key')
    })
  })

  test('does not grant CORS headers to a rejected preflight', async () => {
    await withServer(createTestApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/value`, { method: 'OPTIONS', headers: { Origin: 'https://other.example.invalid', 'Access-Control-Request-Method': 'GET' } })
      assert.equal(response.status, 403)
      assert.equal(response.headers.get('access-control-allow-origin'), null)
    })
  })
})

describe('HTTP baseline protection', () => {
  test('removes framework identification and emits baseline headers', async () => {
    await withServer(createTestApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/value`)
      assert.equal(response.headers.get('x-powered-by'), null)
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
    })
  })

  test('returns controlled JSON for malformed JSON without echoing content', async () => {
    await withServer(createTestApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/value`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"password":"fake-secret"' })
      const text = await response.text()
      assert.equal(response.status, 400)
      assert.deepEqual(JSON.parse(text), { error: { code: 'INVALID_JSON_BODY', message: 'Request body must contain valid JSON' } })
      assert.doesNotMatch(text, /fake-secret/)
    })
  })

  test('returns controlled JSON for an oversized JSON body', async () => {
    await withServer(createTestApp(), async (baseUrl) => {
      const marker = 'fake-oversized-secret'
      const response = await fetch(`${baseUrl}/api/value`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: marker.repeat(7_000) }) })
      const text = await response.text()
      assert.equal(response.status, 413)
      assert.deepEqual(JSON.parse(text), { error: { code: 'JSON_BODY_TOO_LARGE', message: 'Request body exceeds the allowed size' } })
      assert.doesNotMatch(text, new RegExp(marker))
    })
  })

  test('returns a JSON 404 envelope for an unknown API route', async () => {
    await withServer(createTestApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/unknown`)
      assert.equal(response.status, 404)
      assert.match(response.headers.get('content-type') ?? '', /application\/json/)
      assert.deepEqual(await response.json(), { error: { code: 'API_ROUTE_NOT_FOUND', message: 'API route not found' } })
    })
  })

  test('logs only bounded safe metadata for an unexpected error', async () => {
    const originalError = console.error
    const logged: unknown[][] = []
    console.error = (...arguments_: unknown[]) => { logged.push(arguments_) }
    try {
      await withServer(createTestApp(), async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/failure`)
        assert.equal(response.status, 500)
        assert.deepEqual(await response.json(), { error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } })
      })
    } finally { console.error = originalError }
    const serialized = JSON.stringify(logged)
    assert.match(serialized, /UNEXPECTED_ERROR/)
    assert.doesNotMatch(serialized, /fake-password|postgresql|secret@|SELECT fake|request-content/)
  })
})

describe('trusted proxy policy', () => {
  test('uses one explicitly trusted forwarding hop', async () => {
    await withServer(createTestApp({ corsAllowedOrigins: [], trustProxyHops: 1 }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/ip`, { headers: { 'X-Forwarded-For': '198.51.100.17' } })
      assert.deepEqual(await response.json(), { ip: '198.51.100.17' })
    })
  })

  test('does not let forwarding input control req.ip when no proxy is trusted', async () => {
    await withServer(createTestApp({ corsAllowedOrigins: [], trustProxyHops: 0 }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/ip`, { headers: { 'X-Forwarded-For': '198.51.100.17' } })
      const body = await response.json() as { ip: string }
      assert.notEqual(body.ip, '198.51.100.17')
    })
  })
})
