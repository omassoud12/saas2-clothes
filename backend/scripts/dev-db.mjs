// Local development/test Postgres (embedded-postgres, a real PostgreSQL 17 server, no Docker needed).
// It never touches the real database: it lives in backend/.dev-db/ and listens on localhost only.
//
//   node scripts/dev-db.mjs start   start it (creates the cluster and the "saas2_dev" database the first time)
//   node scripts/dev-db.mjs stop    stop it
//
// Then use DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/saas2_dev
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const DEV_DB_PORT = Number(process.env.DEV_DB_PORT ?? 54329)
export const DEV_DB_NAME = process.env.DEV_DB_NAME ?? 'saas2_dev'
export const DEV_DB_URL = `postgresql://postgres:postgres@127.0.0.1:${DEV_DB_PORT}/${DEV_DB_NAME}`
const databaseDir = fileURLToPath(new URL('../.dev-db/', import.meta.url))

export function createDevServer() {
  return new EmbeddedPostgres({
    databaseDir,
    user: 'postgres',
    password: 'postgres',
    port: DEV_DB_PORT,
    persistent: true,
    // UTC server clock, like Supabase; the reports convert to the shop timezone themselves.
    postgresFlags: ['-c', 'timezone=UTC', '-c', 'listen_addresses=127.0.0.1'],
    onLog: () => {},
  })
}

// The roles Supabase has; our migrations grant and revoke on them.
const SUPABASE_ROLES = ['anon', 'authenticated', 'service_role']

export async function prepareDevDatabase(name = DEV_DB_NAME) {
  const client = new pg.Client({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${DEV_DB_PORT}/postgres` })
  await client.connect()
  try {
    for (const role of SUPABASE_ROLES) {
      await client.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`)
    }
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])
    if (!exists.rowCount) await client.query(`CREATE DATABASE "${name}"`)
  } finally {
    await client.end()
  }
}

export async function startDevDatabase() {
  const server = createDevServer()
  const fresh = !existsSync(new URL('../.dev-db/PG_VERSION', import.meta.url))
  if (fresh) await server.initialise()
  await server.start()
  await prepareDevDatabase()
  return server
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  const command = process.argv[2]
  if (command === 'start') {
    const server = await startDevDatabase()
    console.log(`Dev database running: ${DEV_DB_URL.replace(':postgres@', ':***@')} (Ctrl+C to stop)`)
    // The server lives as long as this process: stop it cleanly on Ctrl+C.
    const stop = async () => { await server.stop(); process.exit(0) }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    setInterval(() => {}, 1 << 30)
  } else if (command === 'stop') {
    await createDevServer().stop()
    console.log('Dev database stopped')
  } else {
    console.log('usage: node scripts/dev-db.mjs start|stop')
  }
}
