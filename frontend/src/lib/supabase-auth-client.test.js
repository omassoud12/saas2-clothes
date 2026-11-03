import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { createAuthOnlyClient } from './supabase-auth-client.js'

// The auth-only client must talk to Supabase exactly like supabase-js did, or every signed-in user would
// be signed out: same Auth URL, same storage key for the saved session, same apikey headers.
describe('auth-only Supabase client', () => {
  const url = 'https://abcdefghijklmnop.supabase.co'
  const key = 'sb_publishable_test-key'
  const memory = () => { const data = new Map(); return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) } }

  test('same URL, storage key and headers as createClient()', () => {
    globalThis.localStorage ??= memory()
    const full = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: true, detectSessionInUrl: false } }).auth
    const light = createAuthOnlyClient(url, key, { detectSessionInUrl: false }).auth
    light.stopAutoRefresh?.()
    assert.equal(light.url, full.url)
    assert.equal(light.storageKey, full.storageKey)
    assert.equal(light.storageKey, 'sb-abcdefghijklmnop-auth-token')
    assert.equal(light.headers.apikey, full.headers.apikey)
    assert.equal(light.headers.Authorization, full.headers.Authorization)
    assert.equal(light.flowType, full.flowType)
    assert.equal(light.persistSession, full.persistSession)
  })

  test('a URL with or without the trailing slash gives the same client', () => {
    globalThis.localStorage ??= memory()
    const a = createAuthOnlyClient(url, key, { detectSessionInUrl: false }).auth
    const b = createAuthOnlyClient(`${url}/`, key, { detectSessionInUrl: false }).auth
    a.stopAutoRefresh?.(); b.stopAutoRefresh?.()
    assert.equal(a.url, `${url}/auth/v1`)
    assert.equal(b.url, a.url)
  })
})
