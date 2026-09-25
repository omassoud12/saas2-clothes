import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  DATABASE_CONNECTION_TIMEOUT_MS,
  DATABASE_IDLE_TIMEOUT_MS,
  createVerifiedMigrationUrl,
  createVerifiedPgPoolConfig,
  validateDatabaseTlsConfiguration,
} from './database-tls.js'
import { loadEnvironment } from './env.js'

const SAFE_ERROR = 'database TLS configuration is invalid'
const REMOTE_BASE = 'postgresql://user:secret@example.invalid:5432/app'

function expectInvalid(url: string): void {
  assert.throws(
    () => validateDatabaseTlsConfiguration(url, 'production'),
    (error: unknown) =>
      error instanceof Error &&
      error.message === SAFE_ERROR &&
      !error.message.includes('secret') &&
      !error.message.includes('example.invalid'),
  )
}

describe('database TLS configuration', () => {
  it('accepts verified TLS for a production remote URL', () => {
    assert.doesNotThrow(() =>
      validateDatabaseTlsConfiguration(
        `${REMOTE_BASE}?sslmode=verify-full`,
        'production',
      ),
    )
  })

  for (const [name, query] of [
    ['missing TLS', ''],
    ['disabled TLS', '?sslmode=disable'],
    ['allow downgrade', '?sslmode=allow'],
    ['prefer downgrade', '?sslmode=prefer'],
    ['unverified require', '?sslmode=require'],
    ['unknown mode', '?sslmode=unexpected'],
  ]) {
    it(`rejects ${name} for a production remote URL`, () => {
      expectInvalid(`${REMOTE_BASE}${query}`)
    })
  }

  it('rejects conflicting TLS parameters without leaking the URL', () => {
    expectInvalid(
      `${REMOTE_BASE}?sslmode=verify-full&uselibpqcompat=true`,
    )
  })

  it('allows plaintext loopback only outside production', () => {
    assert.doesNotThrow(() =>
      validateDatabaseTlsConfiguration(
        'postgresql://local:local@127.0.0.1:5432/app',
        'test',
      ),
    )
    expectInvalid('postgresql://local:local@127.0.0.1:5432/app')
  })

  it('builds explicit verified Pool and migration configurations', () => {
    const directory = mkdtempSync(join(tmpdir(), 'database-tls-'))
    const caPath = join(directory, 'ca.crt')
    const certificate = 'test-certificate-authority'

    try {
      writeFileSync(caPath, certificate)
      const context = { caPath, nodeEnvironment: 'production' }
      const verifiedUrl = `${REMOTE_BASE}?sslmode=verify-full`
      const pool = createVerifiedPgPoolConfig(verifiedUrl, context)
      const migrationUrl = new URL(
        createVerifiedMigrationUrl(verifiedUrl, context),
      )

      assert.equal(pool.ssl && typeof pool.ssl === 'object', true)
      assert.deepEqual(pool.ssl, {
        ca: certificate,
        rejectUnauthorized: true,
      })
      assert.equal(
        pool.connectionTimeoutMillis,
        DATABASE_CONNECTION_TIMEOUT_MS,
      )
      assert.equal(pool.idleTimeoutMillis, DATABASE_IDLE_TIMEOUT_MS)
      assert.equal(
        new URL(String(pool.connectionString)).searchParams.has('sslmode'),
        false,
      )
      assert.equal(migrationUrl.searchParams.get('sslmode'), 'verify-full')
      assert.equal(migrationUrl.searchParams.get('sslrootcert'), caPath)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('uses one safe error for unavailable CA material', () => {
    assert.throws(
      () =>
        createVerifiedPgPoolConfig(`${REMOTE_BASE}?sslmode=verify-full`, {
          caPath: 'relative/private-ca.crt',
          nodeEnvironment: 'production',
        }),
      (error: unknown) =>
        error instanceof Error && error.message === SAFE_ERROR,
    )
  })

  it('validates the production runtime URL without requiring migration-only configuration', () => {
    const environment = {
      NODE_ENV: 'production',
      SUPABASE_URL: 'https://project.invalid',
      SUPABASE_PUBLISHABLE_KEY: 'public-placeholder',
      SUPABASE_DB_CA_PATH: 'C:/secure/ca.crt',
      DATABASE_URL: `${REMOTE_BASE}?sslmode=verify-full`,
      DIRECT_URL: `${REMOTE_BASE}?sslmode=require`,
      CORS_ALLOWED_ORIGINS: 'https://app.example.invalid',
      TRUST_PROXY_HOPS: '1',
      APP_REPLICA_COUNT: '1',
    }

    assert.doesNotThrow(() => loadEnvironment(environment))

    assert.throws(
      () =>
        loadEnvironment({
          ...environment,
          DATABASE_URL: `${REMOTE_BASE}?sslmode=require`,
        }),
      (error: unknown) =>
        error instanceof Error && error.message === SAFE_ERROR,
    )
  })
})
