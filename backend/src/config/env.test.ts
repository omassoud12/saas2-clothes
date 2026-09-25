import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  loadAdminEnvironment,
  loadEnvironment,
  parseCorsAllowedOrigins,
} from './env.js'

const developmentEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: 'development', PORT: '3001',
  SUPABASE_URL: 'https://project.example.invalid',
  SUPABASE_PUBLISHABLE_KEY: 'public-placeholder',
  DATABASE_URL: 'postgresql://local:local@127.0.0.1:5432/app',
  SUPABASE_DB_CA_PATH: 'C:/secure/ca.crt',
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173', TRUST_PROXY_HOPS: '0',
}

const productionEnvironment: NodeJS.ProcessEnv = {
  ...developmentEnvironment, NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:secret@db.example.invalid:5432/app?sslmode=verify-full',
  CORS_ALLOWED_ORIGINS: 'https://app.example.invalid', TRUST_PROXY_HOPS: '1',
  APP_REPLICA_COUNT: '1',
}

describe('HTTP runtime environment', () => {
  test('loads without service-role or migration-only DIRECT_URL', () => {
    const loaded = loadEnvironment(developmentEnvironment)
    assert.equal(loaded.nodeEnvironment, 'development')
    assert.equal(loaded.trustProxyHops, 0)
    assert.deepEqual(loaded.corsAllowedOrigins, ['http://localhost:5173'])
    assert.equal('supabaseServiceRoleKey' in loaded, false)
    assert.equal('directUrl' in loaded, false)
  })

  test('normalizes and deduplicates explicit origins', () => {
    assert.deepEqual(parseCorsAllowedOrigins('https://app.example.invalid/, https://app.example.invalid', 'production'), ['https://app.example.invalid'])
  })

  for (const value of [undefined, '', '   ', '*', 'https://*.example.invalid']) {
    test(`rejects unsafe production CORS configuration ${String(value)}`, () => {
      assert.throws(() => loadEnvironment({ ...productionEnvironment, CORS_ALLOWED_ORIGINS: value }), /CORS allowlist configuration is invalid/)
    })
  }

  for (const value of ['not-a-url', 'ftp://app.example.invalid', 'https://user:password@app.example.invalid', 'https://app.example.invalid/path', 'https://app.example.invalid?query=yes', 'https://app.example.invalid#fragment', 'https://app.example.invalid,,https://other.example.invalid']) {
    test(`rejects malformed CORS origin shape ${value}`, () => {
      assert.throws(() => parseCorsAllowedOrigins(value, 'development'), /CORS allowlist configuration is invalid/)
    })
  }

  test('allows an empty development allowlist without permitting localhost implicitly', () => {
    assert.deepEqual(parseCorsAllowedOrigins(undefined, 'development'), [])
  })

  test('rejects an unrecognized NODE_ENV', () => {
    assert.throws(() => loadEnvironment({ ...developmentEnvironment, NODE_ENV: 'prod' }), /NODE_ENV configuration is invalid/)
  })

  for (const value of ['0', '65536', '3.5', '3001x']) {
    test(`rejects invalid PORT ${value}`, () => {
      assert.throws(() => loadEnvironment({ ...developmentEnvironment, PORT: value }), /PORT must be an integer/)
    })
  }

  test('rejects an insecure remote Supabase URL', () => {
    assert.throws(() => loadEnvironment({ ...developmentEnvironment, SUPABASE_URL: 'http://project.example.invalid' }), /SUPABASE_URL configuration is invalid/)
  })

  test('allows explicit loopback HTTP Supabase only outside production', () => {
    assert.doesNotThrow(() => loadEnvironment({ ...developmentEnvironment, SUPABASE_URL: 'http://127.0.0.1:54321' }))
    assert.throws(() => loadEnvironment({ ...productionEnvironment, SUPABASE_URL: 'http://127.0.0.1:54321' }), /SUPABASE_URL configuration is invalid/)
  })

  test('requires a normal-runtime public Supabase key', () => {
    assert.throws(() => loadEnvironment({ ...developmentEnvironment, SUPABASE_PUBLISHABLE_KEY: '' }), /SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY/)
  })

  for (const value of ['-1', '11', '1.5', 'all']) {
    test(`rejects invalid trust-proxy value ${value}`, () => {
      assert.throws(() => loadEnvironment({ ...developmentEnvironment, TRUST_PROXY_HOPS: value }), /TRUST_PROXY_HOPS configuration is invalid/)
    })
  }

  test('requires an explicit positive proxy hop count in production', () => {
    assert.throws(() => loadEnvironment({ ...productionEnvironment, TRUST_PROXY_HOPS: undefined }), /TRUST_PROXY_HOPS configuration is invalid/)
    assert.throws(() => loadEnvironment({ ...productionEnvironment, TRUST_PROXY_HOPS: '0' }), /TRUST_PROXY_HOPS configuration is invalid/)
  })

  test('requires an explicit single-replica contract in production', () => {
    assert.throws(() => loadEnvironment({ ...productionEnvironment, APP_REPLICA_COUNT: undefined }), /APP_REPLICA_COUNT configuration is invalid/)
    assert.throws(() => loadEnvironment({ ...productionEnvironment, APP_REPLICA_COUNT: '2' }), /APP_REPLICA_COUNT configuration is invalid/)
    assert.equal(loadEnvironment(productionEnvironment).appReplicaCount, 1)
  })

  test('validates bounded rate limits and Supabase timeout', () => {
    assert.throws(() => loadEnvironment({ ...developmentEnvironment, API_RATE_LIMIT_MAX: '0' }), /API rate-limit configuration is invalid/)
    assert.throws(() => loadEnvironment({ ...developmentEnvironment, API_WRITE_RATE_LIMIT_MAX: '301' }), /API rate-limit configuration is invalid/)
    assert.throws(() => loadEnvironment({ ...developmentEnvironment, SUPABASE_AUTH_TIMEOUT_MS: '999' }), /SUPABASE_AUTH_TIMEOUT_MS configuration is invalid/)
    const loaded = loadEnvironment(developmentEnvironment)
    assert.equal(loaded.generalRateLimitMax, 300)
    assert.equal(loaded.writeRateLimitMax, 120)
    assert.equal(loaded.expensiveRateLimitMax, 30)
    assert.equal(loaded.imageRateLimitMax, 10)
    assert.equal(loaded.supabaseAuthTimeoutMs, 5_000)
  })
})

describe('administrative environment', () => {
  test('requires the service-role key', () => {
    assert.throws(() => loadAdminEnvironment(developmentEnvironment), /SUPABASE_SERVICE_ROLE_KEY environment variable is required/)
  })

  test('loads service-role configuration without public, CORS, proxy, or DIRECT_URL values', () => {
    const loaded = loadAdminEnvironment({ NODE_ENV: 'development', SUPABASE_URL: 'https://project.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'service-placeholder', DATABASE_URL: 'postgresql://local:local@127.0.0.1:5432/app', SUPABASE_DB_CA_PATH: 'C:/secure/ca.crt' })
    assert.equal(loaded.supabaseServiceRoleKey, 'service-placeholder')
    assert.equal('supabasePublicKey' in loaded, false)
  })
})
