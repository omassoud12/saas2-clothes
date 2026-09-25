import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const syntheticCertificate = [
  '-----BEGIN CERTIFICATE-----',
  'c3ludGhldGljLWRlcGxveW1lbnQtc21va2UtY2E=',
  '-----END CERTIFICATE-----',
  '',
].join('\n')

async function reservePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : null
  await new Promise((resolve) => server.close(resolve))
  if (!port) throw new Error('built-start smoke failed')
  return port
}

async function waitForHealth(port, child) {
  const deadline = Date.now() + 10_000

  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('built-start smoke failed')

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`)
      const body = await response.json()
      if (response.status === 200 && body.status === 'ok') return
    } catch {
      // The listener may still be starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  throw new Error('built-start smoke failed')
}

async function waitForExit(child) {
  if (child.exitCode !== null) return { code: child.exitCode, signal: null }

  return await Promise.race([
    new Promise((resolve) =>
      child.once('exit', (code, signal) => resolve({ code, signal })),
    ),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('built-start smoke failed')), 5_000),
    ),
  ])
}

const secretDirectory = mkdtempSync(join(tmpdir(), 'saas2-start-smoke-'))
const port = await reservePort()
const child = spawn(process.execPath, ['scripts/railway-start.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    APP_REPLICA_COUNT: '1',
    TRUST_PROXY_HOPS: '1',
    CORS_ALLOWED_ORIGINS: 'https://frontend.example.invalid',
    DATABASE_URL:
      'postgresql://synthetic:synthetic@database.example.invalid:5432/postgres?sslmode=verify-full',
    SUPABASE_DB_CA_PATH: join(secretDirectory, 'supabase-ca.crt'),
    SUPABASE_DB_CA_BASE64:
      Buffer.from(syntheticCertificate).toString('base64'),
    SUPABASE_URL: 'https://project.example.invalid',
    SUPABASE_PUBLISHABLE_KEY: 'synthetic-publishable-key',
  },
  stdio: 'ignore',
})

try {
  await waitForHealth(port, child)
  child.kill('SIGTERM')
  const exit = await waitForExit(child)
  const cleanWindowsTermination =
    process.platform === 'win32' && exit.code === null && exit.signal === 'SIGTERM'
  if (exit.code !== 0 && !cleanWindowsTermination) {
    throw new Error('built-start smoke failed')
  }
  process.stdout.write('Built backend start smoke passed.\n')
} finally {
  if (child.exitCode === null) child.kill('SIGKILL')
  rmSync(secretDirectory, { recursive: true, force: true })
}
