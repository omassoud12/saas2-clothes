import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { canShowVariantCost } from './product-flow.js'
import { canRestock, createRestockWorkflow, postRestock, validateRestockDraft } from './restock-flow.js'

const productId = '11111111-1111-4111-8111-111111111111'
const variantId = '22222222-2222-4222-8222-222222222222'
const keyA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const keyB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const draft = { quantity: '5', unitCost: '12.3456', note: '  Cafe\u0301  ' }
const supabase = { auth: { async getSession() { return { data: { session: { user: { id: 'u' }, access_token: 'test-token' } } } } } }
const response = { restock: { id: 'movement', quantity: 5, unitCost: '12.3456' }, variant: { currentStock: 17, lastPurchaseCost: '12.3456' }, idempotentReplay: false }

function json(status, data, headers = {}) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } }) }

describe('Restock frontend contract', () => {
  test('OWNER sees Restock for active records; WAREHOUSE never sees action or cost', () => {
    const product = { isActive: true }
    const variant = { isActive: true, lastPurchaseCost: '12.0000' }
    assert.equal(canRestock('OWNER', product, variant), true)
    assert.equal(canRestock('WAREHOUSE', product, variant), false)
    assert.equal(canShowVariantCost('WAREHOUSE', variant), false)
    assert.equal(canRestock('OWNER', product, { ...variant, isActive: false }), false)
    assert.equal(canRestock('OWNER', { isActive: false }, variant), false)
  })

  test('validates integer quantity, decimal-string precision and normalized note', () => {
    assert.deepEqual(validateRestockDraft(draft).payload, { quantity: 5, unitCost: '12.3456', note: 'Café' })
    for (const unitCost of ['12', '12.3', '12.34', '12.3456']) assert.equal(validateRestockDraft({ ...draft, unitCost }).ok, true)
    for (const quantity of ['0', '-1', '1.2', '1000001', 'abc']) assert.equal(validateRestockDraft({ ...draft, quantity }).field, 'quantity')
    for (const unitCost of ['0', '-1', '12.34567', 'x', '1e2']) assert.equal(validateRestockDraft({ ...draft, unitCost }).field, 'unitCost')
    assert.equal(validateRestockDraft({ ...draft, note: 'x'.repeat(501) }).field, 'note')
  })

  test('API request sends only approved body and Idempotency-Key', async () => {
    let sent
    const result = await postRestock({ supabase, productId, variantId, ...validateRestockDraft(draft).payload, idempotencyKey: keyA, accountId: 'forged', currentStock: 99,
      fetchImpl: async (path, options) => { sent = { path, options }; return json(201, response) } })
    assert.equal(result.ok, true)
    assert.equal(sent.path, `/api/products/${productId}/variants/${variantId}/restocks`)
    assert.equal(sent.options.headers['Idempotency-Key'], keyA)
    assert.equal(sent.options.headers.Authorization, 'Bearer test-token')
    assert.deepEqual(JSON.parse(sent.options.body), { quantity: 5, unitCost: '12.3456', note: 'Café' })
  })

  test('uncertain network outcome keeps frozen payload and key for retry', async () => {
    const calls = []
    const workflow = createRestockWorkflow({ createKey: () => keyA, send: async (attempt) => {
      calls.push(attempt)
      return calls.length === 1 ? { ok: false, uncertain: true, message: 'Connection interrupted' } : { ok: true, ...response }
    } })
    const first = await workflow.submit({ productId, variantId, draft })
    assert.equal(first.uncertain, true)
    assert.equal(workflow.hasUncertainAttempt(), true)
    const retry = await workflow.retry()
    assert.equal(retry.ok, true)
    assert.equal(calls[0], calls[1])
    assert.equal(calls[0].idempotencyKey, keyA)
    assert.equal(workflow.hasUncertainAttempt(), false)
  })

  test('unchanged resubmission after uncertainty keeps the original key', async () => {
    const keys = [keyA, keyB]
    const calls = []
    const workflow = createRestockWorkflow({ createKey: () => keys.shift(), send: async (attempt) => {
      calls.push(attempt)
      return calls.length === 1 ? { ok: false, uncertain: true } : { ok: true, ...response }
    } })
    await workflow.submit({ productId, variantId, draft })
    await workflow.submit({ productId, variantId, draft: { quantity: '5', unitCost: '12.3456', note: 'Café' } })
    assert.deepEqual(calls.map((call) => call.idempotencyKey), [keyA, keyA])
    assert.deepEqual(keys, [keyB])
  })

  test('equivalent decimal formatting is the same semantic Restock', async () => {
    const keys = [keyA, keyB]
    const calls = []
    const workflow = createRestockWorkflow({ createKey: () => keys.shift(), send: async (attempt) => {
      calls.push(attempt)
      return { ok: false, uncertain: true }
    } })
    await workflow.submit({ productId, variantId, draft: { quantity: '5', unitCost: '12.3', note: '' } })
    await workflow.submit({ productId, variantId, draft: { quantity: '5', unitCost: '12.3000', note: '  ' } })
    assert.deepEqual(calls.map((call) => call.idempotencyKey), [keyA, keyA])
    assert.deepEqual(calls.map((call) => call.payload), [{ quantity: 5, unitCost: '12.3', note: null }, { quantity: 5, unitCost: '12.3', note: null }])
  })

  test('changed semantic request gets a new key; successful operation clears old key', async () => {
    const keys = [keyA, keyB, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc']
    const calls = []
    const workflow = createRestockWorkflow({ createKey: () => keys.shift(), send: async (attempt) => {
      calls.push(attempt)
      return calls.length === 1 ? { ok: false, uncertain: true } : { ok: true, ...response }
    } })
    await workflow.submit({ productId, variantId, draft })
    await workflow.submit({ productId, variantId, draft: { ...draft, quantity: '6' } })
    assert.deepEqual(calls.map((call) => call.idempotencyKey), [keyA, keyB])
    assert.equal(workflow.hasUncertainAttempt(), false)
    await workflow.submit({ productId, variantId, draft: { ...draft, quantity: '6' } })
    assert.equal(calls[2].idempotencyKey, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
  })

  test('pending double submit sends only once', async () => {
    let release
    const calls = []
    const workflow = createRestockWorkflow({ createKey: () => keyA, send: (attempt) => { calls.push(attempt); return new Promise((resolve) => { release = resolve }) } })
    const first = workflow.submit({ productId, variantId, draft })
    const second = await workflow.submit({ productId, variantId, draft })
    assert.deepEqual(second, { skipped: true })
    assert.equal(calls.length, 1)
    release({ ok: true, ...response })
    await first
  })

  test('conflict is safe and definitive; replay uses backend current stock', async () => {
    const conflict = await postRestock({ supabase, productId, variantId, idempotencyKey: keyA, ...validateRestockDraft(draft).payload,
      fetchImpl: async () => json(409, { error: { code: 'RESTOCK_IDEMPOTENCY_CONFLICT', message: 'private fingerprint and database detail' } }) })
    assert.equal(conflict.ok, false)
    assert.match(conflict.message, /Start a new Restock/)
    assert.doesNotMatch(conflict.message, /fingerprint|database/)
    const replay = await postRestock({ supabase, productId, variantId, idempotencyKey: keyA, ...validateRestockDraft(draft).payload,
      fetchImpl: async () => json(200, { ...response, variant: { currentStock: 42, lastPurchaseCost: '14.0000' }, idempotentReplay: true }) })
    assert.equal(replay.idempotentReplay, true)
    assert.equal(replay.variant.currentStock, 42)
    assert.equal(replay.variant.lastPurchaseCost, '14.0000')
  })

  test('network and server uncertainty are retryable; inactive response asks for refresh', async () => {
    const payload = validateRestockDraft(draft).payload
    const network = await postRestock({ supabase, productId, variantId, idempotencyKey: keyA, ...payload, fetchImpl: async () => { throw Error('private network detail') } })
    assert.equal(network.uncertain, true)
    const server = await postRestock({ supabase, productId, variantId, idempotencyKey: keyA, ...payload, fetchImpl: async () => json(503, { error: { code: 'RESTOCK_UNAVAILABLE' } }) })
    assert.equal(server.uncertain, true)
    const inactive = await postRestock({ supabase, productId, variantId, idempotencyKey: keyA, ...payload, fetchImpl: async () => json(409, { error: { code: 'VARIANT_INACTIVE' } }) })
    assert.equal(inactive.refresh, true)
    assert.equal(inactive.uncertain, undefined)
  })

  test('rate limits preserve the shared safe message and retry delay', async () => {
    const limited = await postRestock({
      supabase, productId, variantId, idempotencyKey: keyA, ...validateRestockDraft(draft).payload,
      fetchImpl: async () => json(429, { error: { code: 'RATE_LIMITED', message: 'private limiter detail' } }, { 'Retry-After': '20' }),
    })
    assert.deepEqual(limited, {
      ok: false,
      code: 'RATE_LIMITED',
      message: 'Too many attempts. Please wait a moment and try again.',
      retryAfterSeconds: 20,
    })
  })
})
