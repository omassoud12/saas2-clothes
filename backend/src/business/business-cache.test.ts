import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { AccountRateLimiter, ReportCache, etagOf } from './business-cache.js'

describe('report cache', () => {
  test('live reports live 30 s, finished ones 10 min; an account can be forgotten at once', () => {
    let now = 0
    const cache = new ReportCache(10, 30_000, 600_000, () => now)
    cache.set('a:all:daily:2026-10-19:owner', 'a', { x: 1 }, true)
    cache.set('a:all:daily:2026-10-12:owner', 'a', { x: 2 }, false)
    cache.set('b:all:daily:2026-10-12:owner', 'b', { x: 3 }, false)
    now = 29_000
    assert.deepEqual(cache.get('a:all:daily:2026-10-19:owner')?.body, { x: 1 })
    now = 31_000
    assert.equal(cache.get('a:all:daily:2026-10-19:owner'), null, 'live expired')
    assert.deepEqual(cache.get('a:all:daily:2026-10-12:owner')?.body, { x: 2 })
    cache.invalidateAccount('a')
    assert.equal(cache.get('a:all:daily:2026-10-12:owner'), null)
    assert.deepEqual(cache.get('b:all:daily:2026-10-12:owner')?.body, { x: 3 }, 'other accounts are kept')
  })

  test('least recently used entries go first when full', () => {
    const cache = new ReportCache(2)
    cache.set('k1', 'a', { n: 1 }, false); cache.set('k2', 'a', { n: 2 }, false)
    cache.get('k1')
    cache.set('k3', 'a', { n: 3 }, false)
    assert.equal(cache.get('k2'), null); assert.ok(cache.get('k1')); assert.ok(cache.get('k3'))
  })

  test('the ETag follows the body', () => {
    assert.equal(etagOf({ a: 1 }), etagOf({ a: 1 }))
    assert.notEqual(etagOf({ a: 1 }), etagOf({ a: 2 }))
    assert.match(etagOf({ a: 1 }), /^W\/"[\w-]+"$/)
  })
})

describe('per-account rate limit', () => {
  test('60 requests a minute per account, then the seconds to wait; accounts are independent', () => {
    let now = 0
    const limiter = new AccountRateLimiter(60, 60_000, () => now)
    for (let index = 0; index < 60; index += 1) assert.equal(limiter.take('a'), null)
    now = 15_000
    assert.equal(limiter.take('a'), 45)
    assert.equal(limiter.take('b'), null)
    now = 60_000
    assert.equal(limiter.take('a'), null, 'a new minute')
  })
})
