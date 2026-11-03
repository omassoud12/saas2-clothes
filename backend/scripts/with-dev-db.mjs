// Runs a command against the LOCAL dev database only (see scripts/dev-db.mjs).
// It overrides DATABASE_URL and DIRECT_URL so .env (the real database) is never used, and refuses
// any URL that is not on this machine.
//
//   node scripts/with-dev-db.mjs npx prisma migrate deploy
//   node scripts/with-dev-db.mjs npx tsx scripts/rollup-backfill.ts
import { spawnSync } from 'node:child_process'

const url = process.env.DEV_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54329/saas2_dev'
const host = new URL(url).hostname
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error(`Refusing to run: ${host} is not a local database.`)
  process.exit(1)
}
const [command, ...args] = process.argv.slice(2)
if (!command) {
  console.error('usage: node scripts/with-dev-db.mjs <command> [args...]')
  process.exit(1)
}
const result = spawnSync(command, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url, NODE_ENV: process.env.NODE_ENV === 'production' ? 'development' : (process.env.NODE_ENV ?? 'development') },
})
process.exit(result.status ?? 1)
