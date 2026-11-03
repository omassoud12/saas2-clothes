// A short in-process cache of Supabase access-token verifications.
//
// Every API request used to ask Supabase Auth (getUser) about its token: 200–400 ms each time. A token
// that Supabase confirmed is now remembered for at most 30 seconds (never past its own expiry), keyed by
// its SHA-256 (the token itself is not stored). What this changes for security: after a logout the
// access token keeps working for at most those 30 seconds. Nothing else changes: every request still
// loads the application User from the database, so a deactivated or deleted member is refused on the
// next request, and the owner-onboarding route always asks Supabase (fresh).
// Failed verifications are never cached.
import { createHash } from 'node:crypto'
import type { VerifiedAuthIdentity } from './auth.types.js'

export interface TokenCacheOptions {
  readonly ttlMs?: number
  readonly maxEntries?: number
  readonly now?: () => number
}

/** The token's own expiry (exp claim) in ms, read without trusting it: it can only shorten the cache. */
export function tokenExpiryMs(token: string): number | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const exp = (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown }).exp
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null
  } catch {
    return null
  }
}

export class VerifiedTokenCache {
  private readonly entries = new Map<string, { identity: VerifiedAuthIdentity; expires: number }>()
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly now: () => number

  constructor(options: TokenCacheOptions = {}) {
    this.ttlMs = Math.min(Math.max(options.ttlMs ?? 30_000, 0), 60_000)
    this.maxEntries = options.maxEntries ?? 10_000
    this.now = options.now ?? (() => Date.now())
  }

  private key(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  get(token: string): VerifiedAuthIdentity | null {
    const key = this.key(token)
    const entry = this.entries.get(key)
    if (!entry) return null
    if (entry.expires <= this.now()) {
      this.entries.delete(key)
      return null
    }
    return entry.identity
  }

  set(token: string, identity: VerifiedAuthIdentity): void {
    if (this.ttlMs === 0) return
    const now = this.now()
    const tokenExpiry = tokenExpiryMs(token)
    const expires = Math.min(now + this.ttlMs, tokenExpiry ?? now + this.ttlMs)
    if (expires <= now) return
    const key = this.key(token)
    this.entries.delete(key)
    this.entries.set(key, { identity: Object.freeze({ ...identity }), expires })
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!)
  }

  get size(): number {
    return this.entries.size
  }
}
