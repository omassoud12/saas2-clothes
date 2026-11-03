// In-process protection for the business endpoints (no Redis in this project):
//   * ReportCache — LRU of report bodies keyed by account:store:endpoint:period:role, 30 s for live
//     periods, 10 min for finished ones; every entry of an account is dropped when its rollups change.
//   * AccountRateLimiter — fixed one-minute window per account (60 requests by default).
import { createHash } from 'node:crypto'

export interface CachedReport { readonly body: object; readonly etag: string; readonly live: boolean }

export class ReportCache {
  private readonly entries = new Map<string, CachedReport & { expires: number; accountId: string }>()

  constructor(private readonly maxEntries = 5000, private readonly liveMs = 30_000, private readonly pastMs = 10 * 60_000, private readonly now = () => Date.now()) {}

  get(key: string): CachedReport | null {
    const entry = this.entries.get(key)
    if (!entry) return null
    if (entry.expires <= this.now()) { this.entries.delete(key); return null }
    // LRU: move to the end.
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry
  }

  set(key: string, accountId: string, body: object, live: boolean): CachedReport {
    const entry = { body, live, etag: etagOf(body), accountId, expires: this.now() + (live ? this.liveMs : this.pastMs) }
    this.entries.delete(key)
    this.entries.set(key, entry)
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!)
    return entry
  }

  /** Drop every report of an account (its rollups, targets or closed days changed). */
  invalidateAccount(accountId: string): void {
    for (const [key, entry] of this.entries) if (entry.accountId === accountId) this.entries.delete(key)
  }

  get size(): number { return this.entries.size }
}

export function etagOf(body: object): string {
  return `W/"${createHash('sha1').update(JSON.stringify(body)).digest('base64url')}"`
}

export class AccountRateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>()

  constructor(private readonly limit = 60, private readonly windowMs = 60_000, private readonly now = () => Date.now()) {}

  /** null when allowed, otherwise the seconds to wait. */
  take(accountId: string): number | null {
    const time = this.now()
    const window = this.windows.get(accountId)
    if (!window || time - window.start >= this.windowMs) {
      this.windows.set(accountId, { start: time, count: 1 })
      if (this.windows.size > 50_000) for (const [key, value] of this.windows) if (time - value.start >= this.windowMs) this.windows.delete(key)
      return null
    }
    if (window.count >= this.limit) return Math.max(1, Math.ceil((window.start + this.windowMs - time) / 1000))
    window.count += 1
    return null
  }
}
