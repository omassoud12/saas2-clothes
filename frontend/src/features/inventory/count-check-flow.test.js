import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { buildCountReview, formatDifference, parseCountedInput, submitCount } from './count-check-flow.js'

const supabase = { auth: { async getSession() { return { data: { session: { user: { id: 'user' }, access_token: 'synthetic-test-token' } } } } } }
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const variantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const key = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

describe('counted number input', () => {
  test('a whole number is a count, empty means not counted, anything else is refused', () => {
    assert.deepEqual(parseCountedInput('12'), { ok: true, value: 12 })
    assert.deepEqual(parseCountedInput(' 0 '), { ok: true, value: 0 })
    assert.deepEqual(parseCountedInput(''), { ok: true, value: null })
    assert.deepEqual(parseCountedInput(undefined), { ok: true, value: null })
    for (const bad of ['-1', '1.5', 'abc', '1e3', '12345678901', '2147483648']) assert.equal(parseCountedInput(bad).ok, false, bad)
  })
})

describe('count review', () => {
  const variants = [
    { id: 'v1', color: 'Black', size: 'M', currentStock: 7 },
    { id: 'v2', color: 'Black', size: 'L', currentStock: 4 },
    { id: 'v3', color: null, size: null, currentStock: 0 },
  ]

  test('lists only the sizes that were counted and differ, with current -> counted and the difference', () => {
    const review = buildCountReview(variants, { v1: '10', v2: '4', v3: '' })
    assert.deepEqual(review.lines, [{ variantId: 'v1', color: 'Black', size: 'M', current: 7, counted: 10, difference: 3 }])
    assert.equal(review.ready, true)
    const down = buildCountReview(variants, { v1: '2', v3: '5' })
    assert.deepEqual(down.lines.map((line) => line.difference), [-5, 5])
    assert.equal(down.lines[1].color, 'No color'); assert.equal(down.lines[1].size, 'No size')
  })

  test('nothing to review, or a bad entry, is not ready', () => {
    assert.equal(buildCountReview(variants, {}).ready, false)
    assert.equal(buildCountReview(variants, { v1: '7' }).ready, false, 'a count equal to the system changes nothing')
    const bad = buildCountReview(variants, { v1: 'x', v2: '9' })
    assert.equal(bad.ready, false); assert.match(bad.errors.get('v1'), /whole number/u)
  })

  test('differences are signed', () => {
    assert.equal(formatDifference(3), '+3'); assert.equal(formatDifference(-5), '-5'); assert.equal(formatDifference(0), '0')
  })
})

describe('submitting a count', () => {
  test('posts the counted and the expected number with the operation key', async () => {
    let call
    const result = await submitCount({ supabase, variantId, operationId: key, countedQuantity: 10, expectedStock: 7, fetchImpl: async (input, init) => {
      call = { url: String(input), init }
      return json(201, { count: { variantId, previousStock: 7, countedQuantity: 10, difference: 3, currentStock: 10 }, idempotentReplay: false })
    } })
    assert.deepEqual(result, { ok: true, difference: 3, currentStock: 10, idempotentReplay: false })
    assert.match(call.url, new RegExp(`/api/inventory/variants/${variantId}/count-check$`, 'u'))
    assert.deepEqual(JSON.parse(call.init.body), { countedQuantity: 10, expectedStock: 7 })
    assert.equal(new Headers(call.init.headers).get('Idempotency-Key'), key)
  })

  test('explains a stock change in simple words and marks server failures as safe to retry', async () => {
    const fail = (status, code) => submitCount({ supabase, variantId, operationId: key, countedQuantity: 1, expectedStock: 0, fetchImpl: async () => json(status, { error: { code, message: 'private detail' } }) })
    const changed = await fail(409, 'COUNT_STOCK_CHANGED')
    assert.match(changed.message, /stock changed/u); assert.equal(changed.retryable, false)
    const server = await fail(503, 'COUNT_UNAVAILABLE')
    assert.equal(server.retryable, true); assert.doesNotMatch(server.message, /private/u)
    assert.match((await fail(403, 'ROLE_FORBIDDEN')).message, /Only an owner/u)
    assert.equal((await fail(401, 'SESSION_REQUIRED')).requiresLogin, true)
    const network = await submitCount({ supabase, variantId, operationId: key, countedQuantity: 1, expectedStock: 0, fetchImpl: async () => { throw new TypeError('network down') } })
    assert.equal(network.ok, false); assert.equal(network.retryable, true)
  })

  test('a response for another variant is not trusted', async () => {
    const result = await submitCount({ supabase, variantId, operationId: key, countedQuantity: 10, expectedStock: 7, fetchImpl: async () => json(200, { count: { variantId: 'other', difference: 3, currentStock: 10 } }) })
    assert.equal(result.code, 'INVALID_COUNT_RESPONSE')
  })
})
