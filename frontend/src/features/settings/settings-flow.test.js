import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { loadSettings, parseRateInput, saveExchangeRate } from './settings-flow.js'

const supabase = { auth: { async getSession() { return { data: { session: { user: { id: 'user' }, access_token: 'synthetic-test-token' } } } } } }
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('exchange rate input', () => {
  test('accepts a typed rate and empty to clear it', () => {
    assert.deepEqual(parseRateInput('89,500'), { ok: true, value: '89500' })
    assert.deepEqual(parseRateInput(' 89 500.5 '), { ok: true, value: '89500.5' })
    assert.deepEqual(parseRateInput(''), { ok: true, value: null })
    for (const bad of ['0', '-1', 'abc', '1.234', '1000000001']) assert.equal(parseRateInput(bad).ok, false, bad)
  })
})

describe('settings requests', () => {
  test('loads the store currency and the rate', async () => {
    const result = await loadSettings({ supabase, fetchImpl: async () => json(200, { settings: { baseCurrency: 'USD', lbpPerUsd: '89500.00' } }) })
    assert.deepEqual(result, { ok: true, baseCurrency: 'USD', lbpPerUsd: '89500.00' })
    const none = await loadSettings({ supabase, fetchImpl: async () => json(200, { settings: { baseCurrency: 'USD', lbpPerUsd: null } }) })
    assert.equal(none.lbpPerUsd, null)
  })

  test('refuses a malformed response', async () => {
    for (const body of [{}, { settings: { baseCurrency: 'USD', lbpPerUsd: '0' } }, { settings: { lbpPerUsd: null } }, { settings: { baseCurrency: 'USD', lbpPerUsd: 5 } }]) {
      assert.equal((await loadSettings({ supabase, fetchImpl: async () => json(200, body) })).code, 'INVALID_SETTINGS_RESPONSE')
    }
  })

  test('saves with PUT and explains what a person can fix', async () => {
    let call
    const saved = await saveExchangeRate({ supabase, lbpPerUsd: '89500', fetchImpl: async (input, init) => { call = { url: String(input), init }; return json(200, { settings: { baseCurrency: 'USD', lbpPerUsd: '89500.00' } }) } })
    assert.equal(saved.lbpPerUsd, '89500.00'); assert.equal(call.init.method, 'PUT'); assert.match(call.url, /\/api\/settings\/exchange-rate$/u); assert.deepEqual(JSON.parse(call.init.body), { lbpPerUsd: '89500' })
    const fail = (status, code) => saveExchangeRate({ supabase, lbpPerUsd: '1', fetchImpl: async () => json(status, { error: { code, message: 'private detail' } }) })
    assert.match((await fail(409, 'EXCHANGE_RATE_UNSUPPORTED_CURRENCY')).message, /US dollars/u)
    assert.match((await fail(422, 'INVALID_EXCHANGE_RATE')).message, /greater than zero/u)
    assert.match((await fail(403, 'ROLE_FORBIDDEN')).message, /Only an owner/u)
    assert.equal((await fail(401, 'SESSION_REQUIRED')).requiresLogin, true)
    const server = await fail(503, 'SETTINGS_UNAVAILABLE'); assert.doesNotMatch(server.message, /private/u)
  })
})
