// Read-only snapshot of the database before a migration: every table in the public schema
// (all rows, as JSON), the public functions and triggers, and the applied Prisma migrations.
// Usage (from backend/): npx tsx scripts/backup-database.ts <output folder>
// It never writes to the database. The output holds real customer data: keep it private.
import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import pg from 'pg'
import { createVerifiedPgPoolConfig } from '../src/config/database-tls.js'

const output = resolve(process.argv[2] ?? '')
if (!process.argv[2]) throw new Error('Give the output folder: npx tsx scripts/backup-database.ts <folder>')
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DIRECT_URL or DATABASE_URL is required')

const pool = new pg.Pool(createVerifiedPgPoolConfig(databaseUrl, {
  caPath: process.env.SUPABASE_DB_CA_PATH?.trim() ?? '',
  nodeEnvironment: process.env.NODE_ENV,
}))

const client = await pool.connect()
try {
  // One consistent, read-only view of the whole database.
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  mkdirSync(join(output, 'tables'), { recursive: true })

  const tables = (await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  )).rows.map((row) => row.tablename)

  const counts: Record<string, number> = {}
  for (const table of tables) {
    const quoted = `"public"."${table.replace(/"/g, '""')}"`
    const rows = (await client.query(`SELECT * FROM ${quoted}`)).rows
    counts[table] = rows.length
    writeFileSync(join(output, 'tables', `${table}.json`), JSON.stringify(rows, null, 2))
  }

  const functions = (await client.query<{ name: string; definition: string }>(`
    SELECT p.proname AS name, pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' ORDER BY p.proname`)).rows
  const triggers = (await client.query<{ table: string; name: string; definition: string }>(`
    SELECT c.relname AS "table", t.tgname AS name, pg_get_triggerdef(t.oid) AS definition
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal ORDER BY c.relname, t.tgname`)).rows
  const constraints = (await client.query<{ table: string; name: string; definition: string }>(`
    SELECT c.relname AS "table", k.conname AS name, pg_get_constraintdef(k.oid) AS definition
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' ORDER BY c.relname, k.conname`)).rows
  const columns = (await client.query(`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`)).rows

  writeFileSync(join(output, 'functions.sql'), functions.map((f) => `-- ${f.name}\n${f.definition};\n`).join('\n'))
  writeFileSync(join(output, 'triggers.sql'), triggers.map((t) => `-- ${t.table}.${t.name}\n${t.definition};\n`).join('\n'))
  writeFileSync(join(output, 'constraints.json'), JSON.stringify(constraints, null, 2))
  writeFileSync(join(output, 'columns.json'), JSON.stringify(columns, null, 2))
  writeFileSync(join(output, 'summary.json'), JSON.stringify({ takenAt: new Date().toISOString(), tables: counts, functions: functions.length, triggers: triggers.length }, null, 2))
  await client.query('COMMIT')

  console.log(`Backup written to ${output}`)
  for (const [table, count] of Object.entries(counts)) console.log(`  ${table}: ${count} rows`)
  console.log(`  ${functions.length} functions, ${triggers.length} triggers, ${constraints.length} constraints`)
} catch (error) {
  await client.query('ROLLBACK').catch(() => {})
  throw error
} finally {
  client.release()
  await pool.end()
}
