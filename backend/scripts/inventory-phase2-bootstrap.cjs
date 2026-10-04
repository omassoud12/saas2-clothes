const { Client } = require('pg')

async function main() {
  const client = new Client({ connectionString: 'postgresql://postgres@127.0.0.1:55432/postgres' })
  await client.connect()
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    END $$
  `)
  await client.query('DROP DATABASE IF EXISTS saas2_phase2 WITH (FORCE)')
  await client.query('CREATE DATABASE saas2_phase2')
  await client.end()
}

main().catch(error => {
  console.error(error.code || error.message)
  process.exitCode = 1
})
