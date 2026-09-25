import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'
import { materializeDatabaseCa } from './database-ca.mjs'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const backendRoot = join(repositoryRoot, 'backend')
const prismaCliPath = join(
  repositoryRoot,
  'node_modules',
  'prisma',
  'build',
  'index.js',
)

function runPrisma(arguments_, environmentOverrides = {}) {
  const environment = { ...process.env, ...environmentOverrides }

  for (const name of [
    'DATABASE_URL',
    'DIRECT_URL',
    'SUPABASE_DB_CA_PATH',
    'SUPABASE_DB_CA_BASE64',
  ]) {
    if (environmentOverrides[name] === undefined) delete environment[name]
  }

  return spawnSync(process.execPath, [prismaCliPath, ...arguments_], {
    cwd: backendRoot,
    encoding: 'utf8',
    env: environment,
  })
}

const syntheticCertificate = [
  '-----BEGIN CERTIFICATE-----',
  'c3ludGhldGljLWRlcGxveW1lbnQtdGVzdC1jYQ==',
  '-----END CERTIFICATE-----',
  '',
].join('\n')

describe('Railway database CA preparation', () => {
  test('materializes environment-delivered CA bytes with private permissions', () => {
    const directory = mkdtempSync(join(tmpdir(), 'saas2-ca-test-'))
    const caPath = join(directory, 'supabase-ca.crt')

    assert.equal(
      materializeDatabaseCa({
        NODE_ENV: 'production',
        SUPABASE_DB_CA_PATH: caPath,
        SUPABASE_DB_CA_BASE64: Buffer.from(syntheticCertificate).toString(
          'base64',
        ),
      }),
      caPath,
    )
    assert.equal(readFileSync(caPath, 'utf8'), syntheticCertificate)

    if (process.platform !== 'win32') {
      assert.equal(statSync(caPath).mode & 0o777, 0o600)
    }

    chmodSync(caPath, 0o600)
  })

  test('accepts an existing external CA file without requiring encoded material', () => {
    const directory = mkdtempSync(join(tmpdir(), 'saas2-ca-test-'))
    const caPath = join(directory, 'supabase-ca.crt')
    const encoded = Buffer.from(syntheticCertificate).toString('base64')
    materializeDatabaseCa({
      NODE_ENV: 'production',
      SUPABASE_DB_CA_PATH: caPath,
      SUPABASE_DB_CA_BASE64: encoded,
    })

    assert.equal(
      materializeDatabaseCa({
        NODE_ENV: 'production',
        SUPABASE_DB_CA_PATH: caPath,
      }),
      caPath,
    )
  })

  test('fails production safely when CA delivery is missing or invalid', () => {
    assert.throws(
      () => materializeDatabaseCa({ NODE_ENV: 'production' }),
      { message: 'database CA configuration is invalid' },
    )
    assert.throws(
      () =>
        materializeDatabaseCa({
          NODE_ENV: 'production',
          SUPABASE_DB_CA_PATH: resolve(tmpdir(), '..', 'unsafe-ca.crt'),
          SUPABASE_DB_CA_BASE64: Buffer.from(syntheticCertificate).toString(
            'base64',
          ),
        }),
      { message: 'database CA configuration is invalid' },
    )
    assert.throws(
      () =>
        materializeDatabaseCa({
          NODE_ENV: 'production',
          SUPABASE_DB_CA_PATH: 'relative/ca.crt',
          SUPABASE_DB_CA_BASE64: 'not-base64',
        }),
      { message: 'database CA configuration is invalid' },
    )
  })

  test('does nothing without CA settings outside production', () => {
    assert.equal(materializeDatabaseCa({ NODE_ENV: 'test' }), null)
  })
})

describe('Railway deployment command contract', () => {
  const rootPackage = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  )
  const backendPackage = JSON.parse(
    readFileSync(new URL('../backend/package.json', import.meta.url), 'utf8'),
  )

  test('keeps one explicit root build, release, and start path', () => {
    assert.equal(
      rootPackage.scripts['railway:build'],
      'npm run prepare:database-ca && npm run build:backend',
    )
    assert.equal(
      rootPackage.scripts['railway:release'],
      'npm run prepare:database-ca && npm run prisma:migrate:deploy --workspace server',
    )
    assert.equal(
      rootPackage.scripts['railway:start'],
      'node scripts/railway-start.mjs',
    )
    assert.equal(
      backendPackage.scripts.build,
      'npm run prisma:generate && tsc -p tsconfig.json',
    )
    assert.equal(
      backendPackage.scripts['prisma:generate'],
      'prisma generate --config prisma.generate.config.ts',
    )
    assert.equal(
      backendPackage.scripts['prisma:migrate:deploy'],
      'prisma migrate deploy',
    )
    assert.equal(
      backendPackage.scripts['prisma:migrate:status'],
      'prisma migrate status',
    )
  })

  test('generates Prisma Client without database or CA environment', () => {
    const result = runPrisma([
      'generate',
      '--config',
      'prisma.generate.config.ts',
    ])

    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.match(result.stdout, /Generated Prisma Client/u)
  })

  for (const [name, directUrl] of [
    [
      'sslmode=require',
      'postgresql://user:secret@example.invalid:5432/app?sslmode=require',
    ],
    [
      'conflicting TLS query parameters',
      'postgresql://user:secret@example.invalid:5432/app?sslmode=verify-full&uselibpqcompat=true',
    ],
  ]) {
    test(`keeps production migrations fail-closed for ${name}`, () => {
      const result = runPrisma(['migrate', 'status'], {
        DIRECT_URL: directUrl,
        NODE_ENV: 'production',
      })
      const output = `${result.stdout}\n${result.stderr}`

      assert.notEqual(result.status, 0)
      assert.match(output, /database TLS configuration is invalid/u)
      assert.doesNotMatch(output, /secret|example\.invalid/u)
    })
  }

  test('keeps production migrations fail-closed without a valid CA path', () => {
    const result = runPrisma(['migrate', 'status'], {
      DIRECT_URL:
        'postgresql://user:secret@example.invalid:5432/app?sslmode=verify-full',
      NODE_ENV: 'production',
      SUPABASE_DB_CA_PATH: 'relative/ca.crt',
    })
    const output = `${result.stdout}\n${result.stderr}`

    assert.notEqual(result.status, 0)
    assert.match(output, /database TLS configuration is invalid/u)
    assert.doesNotMatch(output, /secret|example\.invalid/u)
  })

  test('keeps deployment scripts present and starts in the same Node process', () => {
    const scriptPaths = [
      'database-ca.mjs',
      'prepare-database-ca.mjs',
      'railway-start.mjs',
      'smoke-built-start.mjs',
    ]
    for (const scriptPath of scriptPaths) {
      assert.equal(
        existsSync(new URL(`./${scriptPath}`, import.meta.url)),
        true,
      )
    }

    const startSource = readFileSync(
      new URL('./railway-start.mjs', import.meta.url),
      'utf8',
    )
    assert.match(
      startSource,
      /materializeDatabaseCa\(\)[\s\S]*await import\('\.\.\/backend\/dist\/index\.js'\)/u,
    )
    assert.doesNotMatch(startSource, /\b(?:spawn|exec|fork)\b/u)
  })

  test('keeps certificate material environment-only and deployment errors quiet', () => {
    const productionSources = [
      'database-ca.mjs',
      'prepare-database-ca.mjs',
      'railway-start.mjs',
    ]
      .map((scriptPath) =>
        readFileSync(new URL(`./${scriptPath}`, import.meta.url), 'utf8'),
      )
      .join('\n')

    assert.match(productionSources, /SUPABASE_DB_CA_BASE64/u)
    assert.doesNotMatch(
      productionSources,
      /-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----/u,
    )
    assert.doesNotMatch(
      productionSources,
      /console\.|process\.(?:stdout|stderr)/u,
    )
  })
})
