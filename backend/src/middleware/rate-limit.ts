import type { Request, RequestHandler } from 'express'
import { HttpError } from '../errors/http-error.js'

interface RateLimitEntry {
  count: number
  expiresAt: number
}

export interface RateLimitPolicy {
  readonly limit: number
  readonly windowMs: number
  readonly maxEntries?: number
}

export interface RateLimitOptions {
  readonly now?: () => number
  readonly shouldLimit?: (request: Request) => boolean
}

const DEFAULT_MAX_ENTRIES = 10_000

export function createRateLimit(
  policy: RateLimitPolicy,
  options: RateLimitOptions = {},
): RequestHandler {
  const entries = new Map<string, RateLimitEntry>()
  const now = options.now ?? Date.now
  const shouldLimit = options.shouldLimit ?? (() => true)
  const maxEntries = policy.maxEntries ?? DEFAULT_MAX_ENTRIES
  let nextCleanupAt = 0

  return (request, response, next) => {
    if (!shouldLimit(request)) {
      next()
      return
    }

    const timestamp = now()

    if (timestamp >= nextCleanupAt) {
      for (const [key, entry] of entries) {
        if (entry.expiresAt <= timestamp) entries.delete(key)
      }
      nextCleanupAt = timestamp + Math.min(policy.windowMs, 60_000)
    }

    const key = request.ip || request.socket.remoteAddress || 'unknown'
    let entry = entries.get(key)

    if (!entry || entry.expiresAt <= timestamp) {
      if (entries.size >= maxEntries) {
        const oldestKey = entries.keys().next().value as string | undefined
        if (oldestKey !== undefined) entries.delete(oldestKey)
      }

      entry = { count: 0, expiresAt: timestamp + policy.windowMs }
      entries.set(key, entry)
    }

    if (entry.count >= policy.limit) {
      response.setHeader(
        'Retry-After',
        String(Math.max(1, Math.ceil((entry.expiresAt - timestamp) / 1_000))),
      )
      next(
        new HttpError(
          429,
          'RATE_LIMIT_EXCEEDED',
          'Too many requests; try again later',
        ),
      )
      return
    }

    entry.count += 1
    next()
  }
}
