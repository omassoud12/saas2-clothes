// Load-test data for the business reports, in a SEPARATE local database (default saas2_load on the local
// dev Postgres, see scripts/dev-db.mjs). It refuses any non-local host, so production is never touched.
//
//   npx tsx scripts/seed-load.ts [--accounts 200] [--days 365] [--sales 25]
//
// Each account: 1 store, an owner and a staff member, 4 products × 5 variants, `--sales` sales a day on
// average for `--days` days ending yesterday (1–3 lines each), ~3% voided, ~1% partly returned.
// Resumable: accounts already seeded (by name) are skipped. Set-based SQL, one transaction per account.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const args = process.argv.slice(2)
const flag = (name: string, fallback: number) => { const index = args.indexOf(name); return index >= 0 ? Number(args[index + 1]) : fallback }
const accounts = flag('--accounts', 200)
const days = flag('--days', 365)
const salesPerDay = flag('--sales', 25)
const server = process.env.LOAD_DATABASE_SERVER_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54329/postgres'
const name = process.env.LOAD_DATABASE_NAME ?? 'saas2_load'
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(server).hostname)) throw new Error('Refusing to seed a non-local database')
export const loadDatabaseUrl = server.replace(/\/[^/]*$/, `/${name}`)

const admin = new pg.Client({ connectionString: server })
await admin.connect()
const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])
if (!exists.rowCount) {
  await admin.query(`CREATE DATABASE "${name}"`)
  console.log(`created database ${name}`)
}
await admin.end()
const migrated = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  env: { ...process.env, DATABASE_URL: loadDatabaseUrl, DIRECT_URL: loadDatabaseUrl, NODE_ENV: 'development' },
  shell: process.platform === 'win32', encoding: 'utf8',
})
if (migrated.status !== 0) throw new Error(`migrations failed: ${migrated.stdout}${migrated.stderr}`)

const sql = new pg.Client({ connectionString: loadDatabaseUrl })
await sql.connect()
const started = Date.now()
try {
  for (let index = 1; index <= accounts; index += 1) {
    const shopName = `Load shop ${String(index).padStart(4, '0')}`
    const done = await sql.query('SELECT 1 FROM "Account" WHERE "name" = $1', [shopName])
    if (done.rowCount) continue
    await sql.query('BEGIN')
    const account = (await sql.query(`INSERT INTO "Account" ("id", "name", "timezone", "updatedAt") VALUES (gen_random_uuid(), $1, 'Asia/Beirut', now()) RETURNING "id"`, [shopName])).rows[0].id as string
    await sql.query(`INSERT INTO "Store" ("id", "accountId", "name", "isDefault", "updatedAt") VALUES (gen_random_uuid(), $1, 'Hamra', true, now())`, [account])
    const owner = (await sql.query(`INSERT INTO "User" ("id", "email", "firstName", "lastName", "role", "accountId", "updatedAt")
      VALUES (gen_random_uuid(), $1, 'Abu', 'Ali', 'OWNER', $2, now()) RETURNING "id"`, [`owner-${index}@load.local`, account])).rows[0].id as string
    const staff = (await sql.query(`INSERT INTO "User" ("id", "email", "firstName", "lastName", "employeeCode", "role", "employeeRole", "accountId", "updatedAt")
      VALUES (gen_random_uuid(), $1, 'Rami', 'Haddad', 'R1', 'WAREHOUSE', 'WAREHOUSE', $2, now()) RETURNING "id"`, [`staff-${index}@load.local`, account])).rows[0].id as string
    const category = (await sql.query(`INSERT INTO "Category" ("id", "accountId", "name", "updatedAt") VALUES (gen_random_uuid(), $1, 'Clothes', now()) RETURNING "id"`, [account])).rows[0].id as string
    await sql.query(`CREATE TEMP TABLE v ON COMMIT DROP AS
      WITH p AS (
        INSERT INTO "Product" ("id", "accountId", "categoryId", "name", "createdById", "updatedAt")
        SELECT gen_random_uuid(), $1, $2, name, $3, now() FROM unnest(ARRAY['Linen shirt', 'Midi dress', 'Slim jeans', 'Basic tee']) AS name
        RETURNING "id", "name"
      )
      SELECT gen_random_uuid() AS id, p."id" AS product_id, p."name" AS product_name, c AS color, s AS size,
             (12 + floor(random() * 40))::numeric AS price, row_number() OVER () AS n
      FROM p, unnest(ARRAY['Black', 'White']) c, unnest(ARRAY['S', 'M', 'L']) s`, [account, category, owner])
    await sql.query(`INSERT INTO "ProductVariant" ("id", "accountId", "productId", "sku", "color", "size", "lastPurchaseCost", "sellingPrice", "currentStock", "updatedAt")
      SELECT id, $1, product_id, 'SKU-' || n, color, size, round(price * 0.6, 2), price, (random() * 30)::int, now() FROM v`, [account])
    // Sales: `salesPerDay` ± 40% a day, 10:00–21:00 Beirut time, for `days` days ending yesterday.
    await sql.query(`CREATE TEMP TABLE s ON COMMIT DROP AS
      SELECT gen_random_uuid() AS id, row_number() OVER (ORDER BY at) AS rn, at, (random() < 0.5) AS by_owner,
             (ARRAY['CASH','CASH','CASH','WHISH_OMT','WHISH_OMT','CARD'])[1 + floor(random() * 6)::int]::"PaymentMethod" AS method,
             1 + floor(random() * 3)::int AS lines
      FROM (
        SELECT ((d::date)::timestamp + make_interval(mins => (600 + floor(random() * 660))::int)) AT TIME ZONE 'Asia/Beirut' AS at
        FROM generate_series(current_date - $1::int, current_date - 1, interval '1 day') d,
             LATERAL generate_series(1, greatest(1, round($2::numeric * (0.6 + random() * 0.8))::int))
      ) t`, [days, salesPerDay])
    // One random variant per line (the lateral pick is evaluated once per line).
    await sql.query(`CREATE TEMP TABLE i ON COMMIT DROP AS
      SELECT gen_random_uuid() AS id, s.id AS sale_id, s.at, v.id AS variant_id, v.product_id, v.product_name, v.color, v.size, v.price, v.n,
             1 + floor(random() * 2)::int AS qty
      FROM s CROSS JOIN LATERAL generate_series(1, s.lines) l
      CROSS JOIN LATERAL (SELECT (1 + floor(random() * 24))::int + l * 0 AS pick) p
      JOIN v ON v.n = p.pick`)
    await sql.query(`INSERT INTO "Sale" ("id", "accountId", "soldById", "idempotencyKey", "requestFingerprint", "sellerNameAtSale", "sellerCodeAtSale",
        "currency", "subtotal", "totalAmount", "paymentMethod", "receiptNumber", "createdAt", "updatedAt")
      SELECT s.id, $1, CASE WHEN s.by_owner THEN $2::uuid ELSE $3::uuid END, gen_random_uuid(), md5(s.id::text) || md5(s.rn::text),
             CASE WHEN s.by_owner THEN 'Abu Ali' ELSE 'Rami Haddad' END, CASE WHEN s.by_owner THEN NULL ELSE 'R1' END,
             'USD', t.total, t.total, s.method, s.rn, s.at, s.at
      FROM s JOIN (SELECT sale_id, SUM(qty * price) AS total FROM i GROUP BY sale_id) t ON t.sale_id = s.id`, [account, owner, staff])
    await sql.query(`INSERT INTO "SaleItem" ("id", "accountId", "saleId", "productId", "variantId", "categoryId", "productNameAtSale", "categoryNameAtSale",
        "skuAtSale", "colorAtSale", "sizeAtSale", "quantity", "unitSoldPrice", "unitCostAtSale", "lineTotal", "createdAt")
      SELECT i.id, $1, i.sale_id, i.product_id, i.variant_id, $2, i.product_name, 'Clothes', 'SKU-' || i.n, i.color, i.size, i.qty, i.price, round(i.price * 0.6, 2), i.qty * i.price, i.at
      FROM i`, [account, category])
    await sql.query(`UPDATE "Sale" SET "status" = 'VOIDED', "voidedAt" = "createdAt" + interval '1 hour', "voidedById" = $2, "voidedByName" = 'Abu Ali',
        "voidReason" = 'Load test', "updatedAt" = "createdAt" + interval '1 hour'
      WHERE "accountId" = $1 AND "id" IN (SELECT id FROM s WHERE random() < 0.03)`, [account, owner])
    await sql.query(`CREATE TEMP TABLE r ON COMMIT DROP AS
      SELECT gen_random_uuid() AS id, sa."id" AS sale_id, sa."createdAt" + interval '2 days' AS at
      FROM "Sale" sa WHERE sa."accountId" = $1 AND sa."status" = 'COMPLETED' AND random() < 0.01 AND sa."createdAt" + interval '2 days' < now()`, [account])
    await sql.query(`INSERT INTO "SaleReturn" ("id", "accountId", "saleId", "idempotencyKey", "requestFingerprint", "processedById", "processedByName", "createdAt")
      SELECT r.id, $1, r.sale_id, gen_random_uuid(), md5(r.id::text) || md5(r.sale_id::text), $2, 'Abu Ali', r.at FROM r`, [account, owner])
    await sql.query(`INSERT INTO "SaleReturnItem" ("id", "accountId", "returnId", "saleId", "saleItemId", "variantId", "quantity", "refundAmount", "createdAt")
      SELECT gen_random_uuid(), $1, r.id, r.sale_id, x."id", x."variantId", 1, x."unitSoldPrice", r.at
      FROM r CROSS JOIN LATERAL (SELECT si."id", si."variantId", si."unitSoldPrice" FROM "SaleItem" si WHERE si."saleId" = r.sale_id AND si."accountId" = $1 ORDER BY si."id" LIMIT 1) x`, [account])
    await sql.query('COMMIT')
    if (index % 10 === 0 || index === accounts) console.log(`${index}/${accounts} accounts seeded (${Math.round((Date.now() - started) / 1000)} s)`)
  }
  const counts = await sql.query(`SELECT (SELECT count(*) FROM "Account")::int AS accounts, (SELECT count(*) FROM "Sale")::int AS sales,
    (SELECT count(*) FROM "SaleItem")::int AS items, (SELECT count(*) FROM "SaleReturn")::int AS returns`)
  console.log('load database:', counts.rows[0])
  await sql.query('ANALYZE')
} catch (error) {
  await sql.query('ROLLBACK').catch(() => {})
  throw error
} finally {
  await sql.end()
}
