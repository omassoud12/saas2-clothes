import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { NextFunction, Request, Response } from 'express'
import { VerifiedTokenCache, tokenExpiryMs } from './token-cache.js'
import { createRequireAuth, createRequireTenant, createRequireVerifiedIdentity } from './auth.middleware.js'
import type { AuthDependencies } from './auth.types.js'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'

const identity = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com', emailConfirmedAt: '2026-01-01T00:00:00.000Z', isAnonymous: false }
const jwt = (exp: number) => `x.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.y`

describe('verified token cache', () => {
  test('remembers a confirmed token for 30 s at most, never past its own expiry', () => {
    let now = 1_000_000
    const cache = new VerifiedTokenCache({ now: () => now })
    const token = jwt(now / 1000 + 3600)
    cache.set(token, identity)
    assert.deepEqual(cache.get(token), identity)
    now += 29_999
    assert.deepEqual(cache.get(token), identity)
    now += 2
    assert.equal(cache.get(token), null)
    // A token that expires in 5 s is kept 5 s.
    const short = jwt(now / 1000 + 5)
    cache.set(short, identity)
    now += 5_001
    assert.equal(cache.get(short), null)
    // An expired token is never stored.
    cache.set(jwt(now / 1000 - 1), identity)
    assert.equal(cache.size, 0)
  })

  test('the TTL is capped at 60 s, entries are bounded, and the token itself is not a key', () => {
    let now = 0
    const cache = new VerifiedTokenCache({ ttlMs: 10 * 60_000, maxEntries: 2, now: () => now })
    cache.set('a', identity); cache.set('b', identity); cache.set('c', identity)
    assert.equal(cache.size, 2)
    assert.equal(cache.get('a'), null)
    now += 60_001
    assert.equal(cache.get('c'), null)
    assert.equal(tokenExpiryMs('not-a-jwt'), null)
    assert.equal(tokenExpiryMs(jwt(10)), 10_000)
  })
})

function request(): Request {
  return { headers: { authorization: 'Bearer token' }, rawHeaders: ['Authorization', 'Bearer token'], ip: '127.0.0.1', socket: {} } as unknown as Request
}
async function run(handler: (req: Request, res: Response, next: NextFunction) => unknown, req: Request): Promise<unknown> {
  return new Promise((resolve) => { void handler(req, {} as Response, (error?: unknown) => resolve(error)) })
}

describe('auth middleware with the cache and the joined account', () => {
  test('owner onboarding always asks Supabase fresh; other routes may use the cache', async () => {
    const calls: Array<{ fresh?: boolean } | undefined> = []
    const dependencies = {
      async verifyAccessToken(_token: string, options?: { fresh?: boolean }) { calls.push(options); return identity },
      async findApplicationUser() { return { id: identity.id, role: UserRole.OWNER, accountId: '22222222-2222-4222-8222-222222222222', isActive: true } },
    } as unknown as AuthDependencies
    await run(createRequireVerifiedIdentity(dependencies), request())
    await run(createRequireAuth(dependencies), request())
    assert.deepEqual(calls.map((options) => options?.fresh === true), [true, false])
  })

  test('the tenant check uses the account loaded with the user (no second query), and still refuses a suspended one', async () => {
    let accountQueries = 0
    const accountId = '22222222-2222-4222-8222-222222222222'
    const make = (status: AccountStatus) => ({
      async verifyAccessToken() { return identity },
      async findApplicationUser() { return { id: identity.id, role: UserRole.OWNER, accountId, isActive: true, account: { id: accountId, status } } },
      async findAccountById() { accountQueries += 1; return { id: accountId, status } },
    } as unknown as AuthDependencies)
    const active = request()
    assert.equal(await run(createRequireAuth(make(AccountStatus.ACTIVE)), active), undefined)
    assert.equal(await run(createRequireTenant(make(AccountStatus.ACTIVE)), active), undefined)
    assert.equal(active.auth?.accountStatus, AccountStatus.ACTIVE)
    const suspended = request()
    await run(createRequireAuth(make(AccountStatus.SUSPENDED)), suspended)
    const error = await run(createRequireTenant(make(AccountStatus.SUSPENDED)), suspended) as { status?: number; code?: string }
    assert.equal(error?.status, 403)
    assert.equal(error?.code, 'ACCOUNT_SUSPENDED')
    assert.equal(accountQueries, 0)
  })
})
