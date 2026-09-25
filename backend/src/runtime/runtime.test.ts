import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, test } from 'node:test'
import express, { type NextFunction, type Request, type Response } from 'express'
import {
  isExpensiveRead,
  isImageUpload,
  isWriteRequest,
} from '../app.js'
import { createBootstrapRateLimit } from '../auth/auth.middleware.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import { HttpError } from '../errors/http-error.js'
import { createErrorHandler } from '../middleware/error-handler.js'
import { createRateLimit } from '../middleware/rate-limit.js'
import { createRequestContext } from '../middleware/request-context.js'
import { createTimeoutFetch } from '../supabase.js'
import { createJsonLogger, type RuntimeLogger } from './logger.js'
import {
  createPrismaReadinessProbe,
  createReadinessHandler,
  ReadinessState,
} from './readiness.js'
import {
  configureHttpServer,
  createFatalProcessHandler,
  createShutdownCoordinator,
  HTTP_HEADERS_TIMEOUT_MS,
  HTTP_KEEP_ALIVE_TIMEOUT_MS,
  HTTP_REQUEST_TIMEOUT_MS,
  type ShutdownCoordinator,
} from './server-lifecycle.js'

async function withServer<T>(
  app: ReturnType<typeof express>,
  operation: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
  })
  const { port } = server.address() as AddressInfo

  try {
    return await operation(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

const noOpLogger: RuntimeLogger = {
  info() {},
  warn() {},
  error() {},
}

describe('process-local API rate limiting', () => {
  test('allows the threshold, rejects threshold + 1, and isolates trusted IP buckets', async () => {
    let now = 1_000
    const app = express()
    app.set('trust proxy', 1)
    app.use(createRequestContext(noOpLogger))
    app.use(createRateLimit({ limit: 2, windowMs: 60_000 }, { now: () => now }))
    app.get('/api/test', (_request, response) => response.json({ ok: true }))
    app.use(createErrorHandler(noOpLogger))

    await withServer(app, async (baseUrl) => {
      const request = (ip: string) =>
        fetch(`${baseUrl}/api/test`, { headers: { 'X-Forwarded-For': ip } })

      assert.equal((await request('198.51.100.10')).status, 200)
      assert.equal((await request('198.51.100.10')).status, 200)
      const blocked = await request('198.51.100.10')
      assert.equal(blocked.status, 429)
      assert.equal(blocked.headers.get('retry-after'), '60')
      assert.deepEqual(await blocked.json(), {
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests; try again later',
        },
      })
      assert.equal((await request('198.51.100.11')).status, 200)

      now += 60_000
      assert.equal((await request('198.51.100.10')).status, 200)
    })
  })

  test('uses req.ip and ignores attacker-controlled addresses beyond one trusted hop', async () => {
    const app = express()
    app.set('trust proxy', 1)
    app.use(createRateLimit({ limit: 1, windowMs: 60_000 }))
    app.get('/api/test', (_request, response) => response.json({ ok: true }))
    app.use(createErrorHandler(noOpLogger))

    await withServer(app, async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/test`, {
        headers: { 'X-Forwarded-For': '203.0.113.1, 198.51.100.20' },
      })
      const second = await fetch(`${baseUrl}/api/test`, {
        headers: { 'X-Forwarded-For': '203.0.113.2, 198.51.100.20' },
      })
      assert.equal(first.status, 200)
      assert.equal(second.status, 429)
    })
  })

  test('classifies writes, costly reads, and image uploads without broadening simple catalog reads', () => {
    const request = (method: string, originalUrl: string) =>
      ({ method, originalUrl } as Request)

    assert.equal(isWriteRequest(request('POST', '/api/sales')), true)
    assert.equal(isWriteRequest(request('PATCH', '/api/products/id')), true)
    assert.equal(isWriteRequest(request('GET', '/api/products')), false)
    assert.equal(isExpensiveRead(request('GET', '/api/reports/daily?date=x')), true)
    assert.equal(isExpensiveRead(request('GET', '/api/inventory/reconciliation')), true)
    assert.equal(isExpensiveRead(request('GET', '/api/products')), false)
    assert.equal(isImageUpload(request('POST', '/api/products/id/image')), true)
    assert.equal(isImageUpload(request('DELETE', '/api/products/id/image')), false)
  })

  test('enforces the stacked write, expensive-read, and image thresholds', async () => {
    const app = express()
    app.set('trust proxy', 1)
    app.use(createRateLimit({ limit: 10, windowMs: 60_000 }))
    app.use(
      createRateLimit(
        { limit: 2, windowMs: 60_000 },
        { shouldLimit: isWriteRequest },
      ),
    )
    app.use(
      createRateLimit(
        { limit: 1, windowMs: 60_000 },
        { shouldLimit: isExpensiveRead },
      ),
    )
    app.use(
      createRateLimit(
        { limit: 1, windowMs: 60_000 },
        { shouldLimit: isImageUpload },
      ),
    )
    app.post('/api/write', (_request, response) => response.json({ ok: true }))
    app.get('/api/reports/daily', (_request, response) =>
      response.json({ ok: true }),
    )
    app.post('/api/products/product-id/image', (_request, response) =>
      response.json({ ok: true }),
    )
    app.use(createErrorHandler(noOpLogger))

    await withServer(app, async (baseUrl) => {
      const request = (path: string, method: string, ip: string) =>
        fetch(`${baseUrl}${path}`, {
          method,
          headers: { 'X-Forwarded-For': ip },
        })

      assert.equal((await request('/api/write', 'POST', '198.51.100.40')).status, 200)
      assert.equal((await request('/api/write', 'POST', '198.51.100.40')).status, 200)
      assert.equal((await request('/api/write', 'POST', '198.51.100.40')).status, 429)

      assert.equal((await request('/api/reports/daily', 'GET', '198.51.100.41')).status, 200)
      assert.equal((await request('/api/reports/daily', 'GET', '198.51.100.41')).status, 429)

      assert.equal((await request('/api/products/product-id/image', 'POST', '198.51.100.42')).status, 200)
      assert.equal((await request('/api/products/product-id/image', 'POST', '198.51.100.42')).status, 429)
    })
  })

  test('preserves the bootstrap limiter at five attempts per verified user', async () => {
    const handler = createBootstrapRateLimit()
    const request = {
      verifiedIdentity: {
        authUserId: '11111111-1111-4111-8111-111111111111',
        verifiedEmail: 'owner@example.invalid',
      },
      ip: '198.51.100.30',
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request

    async function invoke(): Promise<unknown> {
      return new Promise((resolve) =>
        handler(
          request,
          {} as Response,
          ((error?: unknown) => resolve(error)) as NextFunction,
        ),
      )
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal(await invoke(), undefined)
    }
    const blocked = await invoke()
    assert.ok(blocked instanceof HttpError)
    assert.equal(blocked.code, 'BOOTSTRAP_RATE_LIMITED')
  })
})

describe('request IDs and structured logging', () => {
  test('generates authoritative UUIDs on 2xx, 4xx, and 5xx and never logs secrets', async () => {
    const output: string[] = []
    let timestamp = Date.parse('2026-09-25T12:00:00.000Z')
    const logger = createJsonLogger(
      {
        log: (message) => output.push(message),
        warn: (message) => output.push(message),
        error: (message) => output.push(message),
      },
      () => timestamp,
    )
    const app = express()
    app.use(createRequestContext(logger, { now: () => timestamp }))
    app.use(express.json())
    app.get('/api/ok', (_request, response) => response.json({ ok: true }))
    app.get('/api/bad', (_request, _response, next) =>
      next(new HttpError(400, 'TEST_BAD_REQUEST', 'Bad request')),
    )
    app.post('/api/fail', () => {
      throw new Error(
        'password=fake-password postgresql://fake:secret@db.invalid SELECT private request-body',
      )
    })
    app.use(createErrorHandler(logger))

    await withServer(app, async (baseUrl) => {
      const ok = await fetch(`${baseUrl}/api/ok`, {
        headers: { 'X-Request-Id': 'attacker-controlled-value' },
      })
      const bad = await fetch(`${baseUrl}/api/bad`)
      timestamp += 7
      const failure = await fetch(`${baseUrl}/api/fail`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer fake-authorization-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: 'fake-request-password' }),
      })

      for (const response of [ok, bad, failure]) {
        const requestId = response.headers.get('x-request-id')
        assert.match(
          requestId ?? '',
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        )
        assert.notEqual(requestId, 'attacker-controlled-value')
      }
      assert.equal(ok.status, 200)
      assert.equal(bad.status, 400)
      assert.equal(failure.status, 500)
      const failureRequestId = failure.headers.get('x-request-id')
      assert.ok(
        output.some((line) => {
          const parsed = JSON.parse(line) as Record<string, unknown>
          return (
            parsed.event === 'http_request_failed' &&
            parsed.requestId === failureRequestId
          )
        }),
      )
    })

    const serialized = output.join('\n')
    assert.doesNotMatch(
      serialized,
      /fake-password|postgresql|secret@|SELECT private|request-body|fake-authorization-token|fake-request-password|attacker-controlled-value/,
    )
    for (const line of output) {
      const parsed = JSON.parse(line) as Record<string, unknown>
      assert.equal(typeof parsed.timestamp, 'string')
      assert.equal(typeof parsed.level, 'string')
      assert.equal(typeof parsed.event, 'string')
    }
  })
})

describe('external and server timeouts', () => {
  test('aborts Supabase fetch at the configured deadline', async () => {
    let aborted = false
    const hangingFetch: typeof fetch = async (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            aborted = true
            reject(new Error('synthetic abort'))
          },
          { once: true },
        )
      })
    const timeoutFetch = createTimeoutFetch(5, hangingFetch)

    await assert.rejects(timeoutFetch('https://example.invalid'))
    assert.equal(aborted, true)
  })

  test('applies explicit Node HTTP timeout values', () => {
    const server = {
      requestTimeout: 0,
      headersTimeout: 0,
      keepAliveTimeout: 0,
    } as Server
    configureHttpServer(server)
    assert.equal(server.requestTimeout, HTTP_REQUEST_TIMEOUT_MS)
    assert.equal(server.headersTimeout, HTTP_HEADERS_TIMEOUT_MS)
    assert.equal(server.keepAliveTimeout, HTTP_KEEP_ALIVE_TIMEOUT_MS)
    assert.ok(server.headersTimeout > server.keepAliveTimeout)
  })
})

describe('readiness', () => {
  test('returns ready only after startup and a successful DB probe', async () => {
    const state = new ReadinessState()
    let failProbe = false
    const app = express()
    app.get(
      '/api/ready',
      createReadinessHandler({
        state,
        async probeDatabase() {
          if (failProbe) throw new Error('private database detail')
        },
      }),
    )

    await withServer(app, async (baseUrl) => {
      let response = await fetch(`${baseUrl}/api/ready`)
      assert.equal(response.status, 503)
      assert.deepEqual(await response.json(), { status: 'not_ready' })

      state.markStarted()
      response = await fetch(`${baseUrl}/api/ready`)
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { status: 'ready' })

      failProbe = true
      response = await fetch(`${baseUrl}/api/ready`)
      assert.equal(response.status, 503)
      assert.deepEqual(await response.json(), { status: 'not_ready' })

      state.beginShutdown()
      failProbe = false
      response = await fetch(`${baseUrl}/api/ready`)
      assert.equal(response.status, 503)
    })
  })

  test('bounds a hanging Prisma readiness query', async () => {
    const prisma = {
      $queryRaw: async () => new Promise<never>(() => {}),
    } as unknown as PrismaClient
    await assert.rejects(createPrismaReadinessProbe(prisma, 5)())
  })
})

describe('graceful shutdown and fatal policy', () => {
  test('marks unready, closes server, and releases resources exactly once', async () => {
    const state = new ReadinessState()
    state.markStarted()
    let serverCloses = 0
    let prismaDisconnects = 0
    let resourceCloses = 0
    const exitCodes: number[] = []
    const server = {
      close(callback: (error?: Error) => void) {
        serverCloses += 1
        queueMicrotask(callback)
      },
    }
    const coordinator = createShutdownCoordinator({
      server,
      readiness: state,
      logger: noOpLogger,
      async disconnectPrisma() { prismaDisconnects += 1 },
      closeResources() { resourceCloses += 1 },
      exit: (code) => { exitCodes.push(code) },
    })

    const first = coordinator.shutdown('SIGTERM')
    const duplicate = coordinator.shutdown('uncaught_exception', 1)
    assert.equal(state.isReady(), false)
    await Promise.all([first, duplicate])
    assert.equal(serverCloses, 1)
    assert.equal(prismaDisconnects, 1)
    assert.equal(resourceCloses, 1)
    assert.deepEqual(exitCodes, [1])
  })

  test('forces bounded termination when HTTP drain never completes', async () => {
    const state = new ReadinessState()
    state.markStarted()
    let forcedConnections = 0
    let cleanupCalls = 0
    const exitCodes: number[] = []
    const coordinator = createShutdownCoordinator({
      server: {
        close() {},
        closeAllConnections() { forcedConnections += 1 },
      },
      readiness: state,
      logger: noOpLogger,
      async disconnectPrisma() { cleanupCalls += 1 },
      deadlineMs: 5,
      exit: (code) => { exitCodes.push(code) },
    })

    await coordinator.shutdown('SIGTERM')
    assert.equal(forcedConnections, 1)
    assert.equal(cleanupCalls, 1)
    assert.deepEqual(exitCodes, [1])
  })

  test('fatal event handlers request one nonzero coordinated shutdown', () => {
    const calls: Array<{ reason: string; code?: number }> = []
    const coordinator: ShutdownCoordinator = {
      async shutdown(reason, code) { calls.push({ reason, code }) },
    }
    createFatalProcessHandler(coordinator, 'unhandled_rejection')()
    createFatalProcessHandler(coordinator, 'uncaught_exception')()
    assert.deepEqual(calls, [
      { reason: 'unhandled_rejection', code: 1 },
      { reason: 'uncaught_exception', code: 1 },
    ])
  })
})
