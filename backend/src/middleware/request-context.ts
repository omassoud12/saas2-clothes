import { randomUUID } from 'node:crypto'
import type { Request, RequestHandler } from 'express'
import type { RuntimeLogger } from '../runtime/logger.js'

function safeRouteGroup(request: Request): string {
  const segments = request.path.split('/').filter(Boolean)
  if (segments[0] !== 'api') return '/non-api'

  const knownGroups = new Set([
    'admin',
    'auth',
    'categories',
    'exchanges',
    'expenses',
    'health',
    'inventory',
    'products',
    'ready',
    'reports',
    'sales',
  ])
  const group = segments[1]

  return group && knownGroups.has(group) ? `/api/${group}` : '/api/unknown'
}

function suppressRoutineLog(request: Request): boolean {
  return request.path === '/api/health' || request.path === '/api/ready'
}

export function createRequestContext(
  logger: RuntimeLogger,
  options: {
    readonly idFactory?: () => string
    readonly now?: () => number
  } = {},
): RequestHandler {
  const idFactory = options.idFactory ?? randomUUID
  const now = options.now ?? Date.now

  return (request, response, next) => {
    const startedAt = now()
    request.requestId = idFactory()
    response.setHeader('X-Request-Id', request.requestId)

    response.once('finish', () => {
      if (suppressRoutineLog(request)) return

      logger.info('http_request_completed', {
        requestId: request.requestId,
        method: request.method,
        route: safeRouteGroup(request),
        status: response.statusCode,
        durationMs: Math.max(0, Math.round(now() - startedAt)),
      })
    })

    next()
  }
}
