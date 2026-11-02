# Business reports — performance

Measured on **this development laptop** (8 logical cores, Windows 11): one Node process running the
business routes, the local PostgreSQL 17 (embedded) and the load generator on the same machine — plus the
developer's own `npm run dev` servers. Production splits the API (Railway) and the database (Supabase), so
absolute numbers will differ; the plans and the relative costs carry over.

## Data set

`backend/scripts/seed-load.ts` → database `saas2_load` (local only; the script refuses non-local hosts):

| Accounts | Stores | Days | Sales | Sale lines | Returns | Voided |
|---|---|---|---|---|---|---|
| 200 | 1 each (the project has one store per account) | 365 | 1,765,870 | 3,531,864 | 17,000 | ~3% |

~24 sales a day per account (±40%), 1–3 lines each, 10:00–21:00 Beirut. Rollups backfilled with
`scripts/rollup-backfill.ts`: **2,252 account-months in 317 s** (≈ 0.14 s a month).

The prompt's 200 × **2 stores** could not be reproduced: sales have no store (see the gap report). The
volume per account is the same.

## Query plans

`backend/scripts/bench-business.ts --explain` captures every SQL statement a report runs (for the busiest
account) and prints `EXPLAIN (ANALYZE, BUFFERS)`. Result: **no sequential scan on Sale, SaleItem,
SaleReturn or SaleReturnItem**; raw sales go through `Sale (accountId, status, createdAt)`,
`SaleItem (saleId, accountId)`, `SaleReturn (accountId, createdAt)` and the new
`Sale (accountId, createdAt DESC, id DESC)`; finished days through the rollup primary keys. The slowest
statement executes in **1.6 ms**. Full plans are at the end of this page.

## Latency

`bench-business.ts --requests N --concurrency C [--cache] [--hot]`: random account, random period
(any day/week/month of the last year, 20% of daily requests for today), report cache off unless `--cache`.
`--hot` = 20 shops opening today / this week / this month / this year (what owners mostly do).

**One request at a time** (database work per report):

| Endpoint | p50 ms | p95 ms | p99 ms |
|---|---|---|---|
| daily | 18 | 89 | 384 |
| weekly | 10 | 19 | 107 |
| monthly | 15 | 19 | 33 |
| yearly | 14 | 36 | 50 |
| invoices | 10 | 12 | 35 |

**50 concurrent requests, no cache, every request a different period (worst case)**, pool 10:

| Endpoint | Requests | p50 ms | p95 ms | p99 ms | req/s | Target p95 |
|---|---|---|---|---|---|---|
| daily | 1000 | 1017 | 1270 | 1694 | 50 | < 300 ✗ |
| weekly | 1000 | 634 | 686 | 701 | 79 | < 300 ✗ |
| monthly | 1000 | 991 | 1073 | 1111 | 51 | < 600 ✗ |
| yearly | 1000 | 594 | 880 | 906 | 75 | < 1000 ✓ |
| invoices | 1000 | 180 | 296 | 341 | 253 | — |

**50 concurrent requests, cache on, hot periods (the usual case)**:

| Endpoint | Requests | p50 ms | p95 ms | p99 ms | req/s |
|---|---|---|---|---|---|
| daily | 1000 | 62 | 721 | 1480 | 358 |
| weekly | 1000 | 61 | 129 | 906 | 477 |
| monthly | 1000 | 57 | 466 | 1087 | 445 |
| yearly | 1000 | 53 | 331 | 543 | 592 |
| invoices | 1000 | 45 | 92 | 153 | 1017 |

### Reading the numbers

- The queries are fast (1–2 ms each, index only). Under 50 concurrent uncached requests the time is
  **queueing**: one Node process, a pool of 10 connections and ~13 round trips per Daily report, all on one
  laptop whose CPU is shared with Postgres and the load generator. A pool of 20 made it slower here (CPU
  bound), so it stays at 10.
- **The p95 targets for uncached Daily, Weekly and Monthly at 50 concurrent are not met on this machine.**
  Yearly is. With the cache (normal use) p50 is ~60 ms; the p95 left comes from the first, uncached
  request of each shop and period.
- What would close the gap in production: more API instances behind the load balancer (the work is per
  request and stateless apart from the per-instance cache), fewer round trips per report (one combined
  rollup read per report instead of one per range), and Redis for a shared cache if several instances run.

### Changes made from these measurements

- Rollup writes: Prisma `createMany` (≈ 600 ms for 600 rows) replaced by one `INSERT … SELECT unnest(arrays)`
  per table → backfill from ~60 s to ~1.5 s per account.
- Rollup reads: the three small indexed reads run in parallel without a transaction; the presence check
  is folded into the read (a missing day is detected from the row count).
- Yearly: months are summed in SQL from the rollups (12 rows instead of 365), expenses read in one query.
- A stampede of identical requests builds the report once (in-flight coalescing); the cache is checked
  before any database work.
- Concurrent reports that needed the same missing days: one computes them under the account's advisory
  lock, the others see them done.

## Database settings

- **Connections.** `DATABASE_URL` (runtime) should be Supabase's pooled connection string (Supavisor,
  port 6543, transaction mode); `DIRECT_URL` (port 5432) is only for `prisma migrate deploy` — this is
  already how `prisma.config.ts` and `src/lib/prisma.ts` are set up. One Prisma client per process.
  Pool size: pg's default 10, or `DATABASE_POOL_MAX` (1–100); keep instances × pool under the pooler's
  limit for this project.
- **statement_timeout.** Every query over raw sales (live day, hours, invoices) runs in a
  `REPEATABLE READ` transaction with `SET LOCAL statement_timeout = '5s'`; rollup writes allow 60 s. The
  small rollup reads run without a transaction (they are bounded index lookups). A report not built in
  10 s answers 503. Nothing global was changed for the rest of the app.
- **Read replica.** None is configured. The reports can move to a replica only if the lazy roll-up of a
  missing finished day is left to the nightly job/backfill (it writes).
- **RLS.** All business tables have RLS enabled with no policy and no privileges for `anon` /
  `authenticated` (the API connects as the table owner). Tenant isolation is enforced by every query
  filtering on the session's account (tested with two accounts whose stores have the same name). Per-row
  RLS policies keyed on a session variable would need a non-owner database role for the API and a
  `SET app.account_id` per transaction; not done (it would change how every existing feature connects).
- **Rate limit and slow log.** 60 report requests a minute per account (429 + Retry-After);
  `business_report_slow` log lines above 500 ms with the account id and endpoint only.

## Plans (EXPLAIN ANALYZE, BUFFERS, busiest account)

### daily (today, live)

```
WITH b AS (SELECT (($1::date)::timestamp AT TIME ZONE $2) AS start_at, (($3::date + 1)::timestamp AT TIME ZONE $4) AS end_at), s AS ( SELECT sa."id", sa."soldBy …
Merge Full Join (actual time=0.099..0.101 rows=0 loops=1)
  Merge Cond: (s.d = (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date))
  Buffers: shared hit=8
  CTE b
    ->  Result (actual time=0.001..0.001 rows=1 loops=1)
  CTE s
    ->  Nested Loop (actual time=0.048..0.048 rows=0 loops=1)
          Buffers: shared hit=3
          ->  CTE Scan on b b_1 (actual time=0.002..0.003 rows=1 loops=1)
          ->  Bitmap Heap Scan on "Sale" sa (actual time=0.044..0.044 rows=0 loops=1)
                Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                Buffers: shared hit=3
                ->  Bitmap Index Scan on "Sale_accountId_status_createdAt_idx" (actual time=0.028..0.028 rows=0 loops=1)
                      Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                      Buffers: shared hit=3
  ->  Merge Left Join (actual time=0.058..0.059 rows=0 loops=1)
        Merge Cond: (s.d = s_1.d)
        Buffers: shared hit=3
        ->  Sort (actual time=0.058..0.058 rows=0 loops=1)
              Sort Key: s.d
              Sort Method: quicksort  Memory: 25kB
              Buffers: shared hit=3
              ->  HashAggregate (actual time=0.051..0.051 rows=0 loops=1)
                    Group Key: s.d
                    Batches: 1  Memory Usage: 40kB
                    Buffers: shared hit=3
                    ->  CTE Scan on s (actual time=0.049..0.049 rows=0 loops=1)
                          Buffers: shared hit=3
        ->  GroupAggregate (never executed)
              Group Key: s_1.d
              ->  Sort (never executed)
                    Sort Key: s_1.d
                    ->  Nested Loop (never executed)
                          ->  CTE Scan on s s_1 (never executed)
                          ->  Index Scan using "SaleItem_saleId_accountId_idx" on "SaleItem" si (never executed)
                                Index Cond: (("saleId" = s_1.id) AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
  ->  GroupAggregate (actual time=0.040..0.041 rows=0 loops=1)
        Group Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date)
        Buffers: shared hit=5
        ->  Sort (actual time=0.040..0.040 rows=0 loops=1)
              Sort Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date), sr.id
              Sort Method: quicksort  Memory: 25kB
              Buffers: shared hit=5
              ->  Nested Loop (actual time=0.022..0.022 rows=0 loops=1)
                    Buffers: shared hit=2
                    ->  Nested Loop (actual time=0.021..0.022 rows=0 loops=1)
                          Buffers: shared hit=2
                          ->  Nested Loop (actual time=0.021..0.022 rows=0 loops=1)
                                Buffers: shared hit=2
                                ->  Nested Loop (actual time=0.021..0.021 rows=0 loops=1)
                                      Buffers: shared hit=2
                                      ->  CTE Scan on b (actual time=0.000..0.001 rows=1 loops=1)
                                      ->  Bitmap Heap Scan on "SaleReturn" sr (actual time=0.020..0.020 rows=0 loops=1)
                                            Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                            Buffers: shared hit=2
                                            ->  Bitmap Index Scan on "SaleReturn_accountId_createdAt_idx" (actual time=0.013..0.013 rows=0 loops=1)
                                                  Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                                  Buffers: shared hit=2
                                ->  Index Scan using "SaleReturnItem_saleId_accountId_idx" on "SaleReturnItem" sri (never executed)
                                      Index Cond: (("saleId" = sr."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                      Filter: ("returnId" = sr.id)
                          ->  Index Scan using "SaleItem_id_saleId_variantId_accountId_key" on "SaleItem" si_1 (never executed)
                                Index Cond: ((id = sri."saleItemId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                    ->  Index Scan using "Sale_id_accountId_key" on "Sale" os (never executed)
                          Index Cond: ((id = sri."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                          Filter: (status = 'COMPLETED'::"SaleStatus")
Planning:
  Buffers: shared hit=1215
Planning Time: 38.233 ms
Execution Time: 0.407 ms
```
```
WITH b AS (SELECT (($1::date)::timestamp AT TIME ZONE $2) AS start_at, ((($3::date)::timestamp + make_interval(mins => $4::int)) AT TIME ZONE $5) AS end_at), s  …
Merge Full Join (actual time=0.086..0.091 rows=0 loops=1)
  Merge Cond: (s.d = (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date))
  Buffers: shared hit=5
  CTE b
    ->  Result (actual time=0.001..0.001 rows=1 loops=1)
  CTE s
    ->  Nested Loop (actual time=0.042..0.043 rows=0 loops=1)
          Buffers: shared hit=3
          ->  CTE Scan on b b_1 (actual time=0.004..0.005 rows=1 loops=1)
          ->  Bitmap Heap Scan on "Sale" sa (actual time=0.035..0.035 rows=0 loops=1)
                Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                Buffers: shared hit=3
                ->  Bitmap Index Scan on "Sale_accountId_status_createdAt_idx" (actual time=0.015..0.015 rows=0 loops=1)
                      Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                      Buffers: shared hit=3
  ->  Merge Left Join (actual time=0.056..0.058 rows=0 loops=1)
        Merge Cond: (s.d = s_1.d)
        Buffers: shared hit=3
        ->  Sort (actual time=0.056..0.056 rows=0 loops=1)
              Sort Key: s.d
              Sort Method: quicksort  Memory: 25kB
              Buffers: shared hit=3
              ->  HashAggregate (actual time=0.047..0.048 rows=0 loops=1)
                    Group Key: s.d
                    Batches: 1  Memory Usage: 40kB
                    Buffers: shared hit=3
                    ->  CTE Scan on s (actual time=0.043..0.044 rows=0 loops=1)
                          Buffers: shared hit=3
        ->  GroupAggregate (never executed)
              Group Key: s_1.d
              ->  Sort (never executed)
                    Sort Key: s_1.d
                    ->  Nested Loop (never executed)
                          ->  CTE Scan on s s_1 (never executed)
                          ->  Index Scan using "SaleItem_saleId_accountId_idx" on "SaleItem" si (never executed)
                                Index Cond: (("saleId" = s_1.id) AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
  ->  GroupAggregate (actual time=0.029..0.030 rows=0 loops=1)
        Group Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date)
        Buffers: shared hit=2
        ->  Sort (actual time=0.028..0.029 rows=0 loops=1)
              Sort Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date), sr.id
              Sort Method: quicksort  Memory: 25kB
              Buffers: shared hit=2
              ->  Nested Loop (actual time=0.021..0.022 rows=0 loops=1)
                    Buffers: shared hit=2
                    ->  Nested Loop (actual time=0.020..0.021 rows=0 loops=1)
                          Buffers: shared hit=2
                          ->  Nested Loop (actual time=0.020..0.021 rows=0 loops=1)
                                Buffers: shared hit=2
                                ->  Nested Loop (actual time=0.019..0.020 rows=0 loops=1)
                                      Buffers: shared hit=2
                                      ->  CTE Scan on b (actual time=0.001..0.001 rows=1 loops=1)
                                      ->  Bitmap Heap Scan on "SaleReturn" sr (actual time=0.017..0.018 rows=0 loops=1)
                                            Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                            Buffers: shared hit=2
                                            ->  Bitmap Index Scan on "SaleReturn_accountId_createdAt_idx" (actual time=0.007..0.007 rows=0 loops=1)
                                                  Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                                  Buffers: shared hit=2
                                ->  Index Scan using "SaleReturnItem_saleId_accountId_idx" on "SaleReturnItem" sri (never executed)
                                      Index Cond: (("saleId" = sr."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                      Filter: ("returnId" = sr.id)
                          ->  Index Scan using "SaleItem_id_saleId_variantId_accountId_key" on "SaleItem" si_1 (never executed)
                                Index Cond: ((id = sri."saleItemId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                    ->  Index Scan using "Sale_id_accountId_key" on "Sale" os (never executed)
                          Index Cond: ((id = sri."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                          Filter: (status = 'COMPLETED'::"SaleStatus")
Planning:
  Buffers: shared hit=81
Planning Time: 5.724 ms
Execution Time: 0.520 ms
```
```
WITH b AS (SELECT (($1::date)::timestamp AT TIME ZONE $2) AS start_at, (($3::date + 1)::timestamp AT TIME ZONE $4) AS end_at), s AS ( SELECT sa."id", sa."soldBy …
Sort (actual time=0.170..0.180 rows=0 loops=1)
  Sort Key: (COALESCE(s.h, ((EXTRACT(hour FROM (sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text)))::integer)))
  Sort Method: quicksort  Memory: 25kB
  Buffers: shared hit=8
  CTE b
    ->  Result (actual time=0.001..0.001 rows=1 loops=1)
  CTE s
    ->  Nested Loop (actual time=0.026..0.028 rows=0 loops=1)
          Buffers: shared hit=3
          ->  CTE Scan on b b_1 (actual time=0.001..0.001 rows=1 loops=1)
          ->  Bitmap Heap Scan on "Sale" sa (actual time=0.024..0.025 rows=0 loops=1)
                Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                Buffers: shared hit=3
                ->  Bitmap Index Scan on "Sale_accountId_status_createdAt_idx" (actual time=0.010..0.010 rows=0 loops=1)
                      Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                      Buffers: shared hit=3
  ->  Hash Full Join (actual time=0.130..0.138 rows=0 loops=1)
        Hash Cond: (s.h = ((EXTRACT(hour FROM (sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text)))::integer))
        Buffers: shared hit=5
        ->  HashAggregate (actual time=0.030..0.030 rows=0 loops=1)
              Group Key: s.h
              Batches: 1  Memory Usage: 40kB
              Buffers: shared hit=3
              ->  CTE Scan on s (actual time=0.027..0.027 rows=0 loops=1)
                    Buffers: shared hit=3
        ->  Hash (actual time=0.049..0.051 rows=0 loops=1)
              Buckets: 1024  Batches: 1  Memory Usage: 8kB
              Buffers: shared hit=2
              ->  GroupAggregate (actual time=0.048..0.050 rows=0 loops=1)
                    Group Key: ((EXTRACT(hour FROM (sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text)))::integer)
                    Buffers: shared hit=2
                    ->  Sort (actual time=0.047..0.048 rows=0 loops=1)
                          Sort Key: ((EXTRACT(hour FROM (sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text)))::integer)
                          Sort Method: quicksort  Memory: 25kB
                          Buffers: shared hit=2
                          ->  Nested Loop (actual time=0.040..0.042 rows=0 loops=1)
                                Buffers: shared hit=2
                                ->  Nested Loop (actual time=0.040..0.041 rows=0 loops=1)
                                      Buffers: shared hit=2
                                      ->  Nested Loop (actual time=0.040..0.041 rows=0 loops=1)
                                            Buffers: shared hit=2
                                            ->  Nested Loop (actual time=0.040..0.040 rows=0 loops=1)
                                                  Buffers: shared hit=2
                                                  ->  CTE Scan on b (actual time=0.005..0.006 rows=1 loops=1)
                                                  ->  Bitmap Heap Scan on "SaleReturn" sr (actual time=0.032..0.032 rows=0 loops=1)
                                                        Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                                        Buffers: shared hit=2
                                                        ->  Bitmap Index Scan on "SaleReturn_accountId_createdAt_idx" (actual time=0.009..0.010 rows=0 loops=1)
                                                              Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                                              Buffers: shared hit=2
                                            ->  Index Scan using "SaleReturnItem_saleId_accountId_idx" on "SaleReturnItem" sri (never executed)
                                                  Index Cond: (("saleId" = sr."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                                  Filter: ("returnId" = sr.id)
                                      ->  Index Only Scan using "SaleItem_id_saleId_variantId_accountId_key" on "SaleItem" si (never executed)
                                            Index Cond: ((id = sri."saleItemId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                            Heap Fetches: 0
                                ->  Index Scan using "Sale_id_accountId_key" on "Sale" os (never executed)
                                      Index Cond: ((id = sri."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                      Filter: (status = 'COMPLETED'::"SaleStatus")
Planning:
  Buffers: shared hit=74
Planning Time: 3.927 ms
Execution Time: 0.393 ms
```
```
WITH b AS (SELECT (($1::date)::timestamp AT TIME ZONE $2) AS start_at, (($3::date + 1)::timestamp AT TIME ZONE $4) AS end_at), s AS ( SELECT sa."id", sa."soldBy …
Merge Full Join (actual time=0.091..0.096 rows=0 loops=1)
  Merge Cond: ((s.d = (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date)) AND (s."soldById" = os."soldById"))
  Buffers: shared hit=5
  CTE b
    ->  Result (actual time=0.001..0.001 rows=1 loops=1)
  CTE s
    ->  Nested Loop (actual time=0.042..0.043 rows=0 loops=1)
          Buffers: shared hit=3
          ->  CTE Scan on b b_1 (actual time=0.003..0.004 rows=1 loops=1)
          ->  Bitmap Heap Scan on "Sale" sa (actual time=0.035..0.036 rows=0 loops=1)
                Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                Buffers: shared hit=3
                ->  Bitmap Index Scan on "Sale_accountId_status_createdAt_idx" (actual time=0.014..0.014 rows=0 loops=1)
                      Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                      Buffers: shared hit=3
  ->  Merge Left Join (actual time=0.058..0.059 rows=0 loops=1)
        Merge Cond: ((s.d = s_1.d) AND (s."soldById" = s_1."soldById"))
        Buffers: shared hit=3
        ->  Sort (actual time=0.057..0.058 rows=0 loops=1)
              Sort Key: s.d, s."soldById"
              Sort Method: quicksort  Memory: 25kB
              Buffers: shared hit=3
              ->  HashAggregate (actual time=0.049..0.049 rows=0 loops=1)
                    Group Key: s.d, s."soldById"
                    Batches: 1  Memory Usage: 37kB
                    Buffers: shared hit=3
                    ->  CTE Scan on s (actual time=0.044..0.044 rows=0 loops=1)
                          Buffers: shared hit=3
        ->  GroupAggregate (never executed)
              Group Key: s_1.d, s_1."soldById"
              ->  Sort (never executed)
                    Sort Key: s_1.d, s_1."soldById"
                    ->  Nested Loop (never executed)
                          ->  CTE Scan on s s_1 (never executed)
                          ->  Index Scan using "SaleItem_saleId_accountId_idx" on "SaleItem" si (never executed)
                                Index Cond: (("saleId" = s_1.id) AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
  ->  GroupAggregate (actual time=0.032..0.034 rows=0 loops=1)
        Group Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date), os."soldById"
        Buffers: shared hit=2
        ->  Sort (actual time=0.032..0.033 rows=0 loops=1)
              Sort Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date), os."soldById"
              Sort Method: quicksort  Memory: 25kB
              Buffers: shared hit=2
              ->  Nested Loop (actual time=0.024..0.025 rows=0 loops=1)
                    Buffers: shared hit=2
                    ->  Nested Loop (actual time=0.024..0.025 rows=0 loops=1)
                          Buffers: shared hit=2
                          ->  Nested Loop (actual time=0.023..0.024 rows=0 loops=1)
                                Buffers: shared hit=2
                                ->  Nested Loop (actual time=0.023..0.024 rows=0 loops=1)
                                      Buffers: shared hit=2
                                      ->  CTE Scan on b (actual time=0.001..0.001 rows=1 loops=1)
                                      ->  Bitmap Heap Scan on "SaleReturn" sr (actual time=0.021..0.021 rows=0 loops=1)
                                            Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                            Buffers: shared hit=2
                                            ->  Bitmap Index Scan on "SaleReturn_accountId_createdAt_idx" (actual time=0.007..0.007 rows=0 loops=1)
                                                  Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                                  Buffers: shared hit=2
                                ->  Index Scan using "SaleReturnItem_saleId_accountId_idx" on "SaleReturnItem" sri (never executed)
                                      Index Cond: (("saleId" = sr."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                      Filter: ("returnId" = sr.id)
                          ->  Index Scan using "SaleItem_id_saleId_variantId_accountId_key" on "SaleItem" si_1 (never executed)
                                Index Cond: ((id = sri."saleItemId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                    ->  Index Scan using "Sale_id_accountId_key" on "Sale" os (never executed)
                          Index Cond: ((id = sri."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                          Filter: (status = 'COMPLETED'::"SaleStatus")
Planning:
  Buffers: shared hit=81
Planning Time: 5.292 ms
Execution Time: 0.454 ms
```
```
WITH b AS (SELECT (($1::date)::timestamp AT TIME ZONE $2) AS start_at, (($3::date + 1)::timestamp AT TIME ZONE $4) AS end_at), s AS ( SELECT sa."id", sa."soldBy …
Hash Full Join (actual time=0.161..0.168 rows=0 loops=1)
  Hash Cond: (((((sa."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date) = (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date)) AND (si."variantId" = sri."variantId"))
  Buffers: shared hit=5
  CTE b
    ->  Result (actual time=0.002..0.002 rows=1 loops=1)
  ->  HashAggregate (actual time=0.052..0.054 rows=0 loops=1)
        Group Key: ((sa."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date, si."variantId"
        Batches: 1  Memory Usage: 121kB
        Buffers: shared hit=3
        ->  Nested Loop (actual time=0.030..0.031 rows=0 loops=1)
              Buffers: shared hit=3
              ->  Nested Loop (actual time=0.029..0.030 rows=0 loops=1)
                    Buffers: shared hit=3
                    ->  CTE Scan on b (actual time=0.001..0.002 rows=1 loops=1)
                    ->  Bitmap Heap Scan on "Sale" sa (actual time=0.025..0.026 rows=0 loops=1)
                          Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                          Buffers: shared hit=3
                          ->  Bitmap Index Scan on "Sale_accountId_status_createdAt_idx" (actual time=0.012..0.013 rows=0 loops=1)
                                Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                Buffers: shared hit=3
              ->  Index Scan using "SaleItem_saleId_accountId_idx" on "SaleItem" si (never executed)
                    Index Cond: (("saleId" = sa.id) AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
  ->  Hash (actual time=0.081..0.084 rows=0 loops=1)
        Buckets: 1024  Batches: 1  Memory Usage: 8kB
        Buffers: shared hit=2
        ->  GroupAggregate (actual time=0.080..0.083 rows=0 loops=1)
              Group Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date), sri."variantId"
              Buffers: shared hit=2
              ->  Sort (actual time=0.079..0.081 rows=0 loops=1)
                    Sort Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date), sri."variantId"
                    Sort Method: quicksort  Memory: 25kB
                    Buffers: shared hit=2
                    ->  Nested Loop (actual time=0.068..0.070 rows=0 loops=1)
                          Buffers: shared hit=2
                          ->  Nested Loop (actual time=0.067..0.069 rows=0 loops=1)
                                Buffers: shared hit=2
                                ->  Nested Loop (actual time=0.067..0.068 rows=0 loops=1)
                                      Buffers: shared hit=2
                                      ->  Nested Loop (actual time=0.066..0.067 rows=0 loops=1)
                                            Buffers: shared hit=2
                                            ->  CTE Scan on b b_1 (actual time=0.006..0.008 rows=1 loops=1)
                                            ->  Bitmap Heap Scan on "SaleReturn" sr (actual time=0.056..0.056 rows=0 loops=1)
                                                  Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                                                  Buffers: shared hit=2
                                                  ->  Bitmap Index Scan on "SaleReturn_accountId_createdAt_idx" (actual time=0.019..0.019 rows=0 loops=1)
                                                        Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                                                        Buffers: shared hit=2
                                      ->  Index Scan using "SaleReturnItem_saleId_accountId_idx" on "SaleReturnItem" sri (never executed)
                                            Index Cond: (("saleId" = sr."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                            Filter: ("returnId" = sr.id)
                                ->  Index Scan using "SaleItem_id_saleId_variantId_accountId_key" on "SaleItem" si_1 (never executed)
                                      Index Cond: ((id = sri."saleItemId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                          ->  Index Scan using "Sale_id_accountId_key" on "Sale" os (never executed)
                                Index Cond: ((id = sri."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                Filter: (status = 'COMPLETED'::"SaleStatus")
Planning:
  Buffers: shared hit=91
Planning Time: 5.891 ms
Execution Time: 0.612 ms
```
```
WITH b AS (SELECT (($1::date)::timestamp AT TIME ZONE $2) AS start_at, ((($3::date)::timestamp + make_interval(mins => $4::int)) AT TIME ZONE $5) AS end_at), s  …
Merge Full Join (actual time=0.092..0.096 rows=0 loops=1)
  Merge Cond: ((s.d = (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date)) AND (s."soldById" = os."soldById"))
  Buffers: shared hit=5
  CTE b
    ->  Result (actual time=0.001..0.001 rows=1 loops=1)
  CTE s
    ->  Nested Loop (actual time=0.043..0.044 rows=0 loops=1)
          Buffers: shared hit=3
          ->  CTE Scan on b b_1 (actual time=0.003..0.004 rows=1 loops=1)
          ->  Bitmap Heap Scan on "Sale" sa (actual time=0.036..0.037 rows=0 loops=1)
                Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                Buffers: shared hit=3
                ->  Bitmap Index Scan on "Sale_accountId_status_createdAt_idx" (actual time=0.015..0.015 rows=0 loops=1)
                      Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                      Buffers: shared hit=3
  ->  Merge Left Join (actual time=0.058..0.059 rows=0 loops=1)
        Merge Cond: ((s.d = s_1.d) AND (s."soldById" = s_1."soldById"))
        Buffers: shared hit=3
        ->  Sort (actual time=0.057..0.058 rows=0 loops=1)
              Sort Key: s.d, s."soldById"
              Sort Method: quicksort  Memory: 25kB
              Buffers: shared hit=3
              ->  HashAggregate (actual time=0.049..0.049 rows=0 loops=1)
                    Group Key: s.d, s."soldById"
                    Batches: 1  Memory Usage: 37kB
                    Buffers: shared hit=3
                    ->  CTE Scan on s (actual time=0.044..0.044 rows=0 loops=1)
                          Buffers: shared hit=3
        ->  GroupAggregate (never executed)
              Group Key: s_1.d, s_1."soldById"
              ->  Sort (never executed)
                    Sort Key: s_1.d, s_1."soldById"
                    ->  Nested Loop (never executed)
                          ->  CTE Scan on s s_1 (never executed)
                          ->  Index Scan using "SaleItem_saleId_accountId_idx" on "SaleItem" si (never executed)
                                Index Cond: (("saleId" = s_1.id) AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
  ->  GroupAggregate (actual time=0.032..0.034 rows=0 loops=1)
        Group Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date), os."soldById"
        Buffers: shared hit=2
        ->  Sort (actual time=0.032..0.033 rows=0 loops=1)
              Sort Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date), os."soldById"
              Sort Method: quicksort  Memory: 25kB
              Buffers: shared hit=2
              ->  Nested Loop (actual time=0.024..0.025 rows=0 loops=1)
                    Buffers: shared hit=2
                    ->  Nested Loop (actual time=0.023..0.024 rows=0 loops=1)
                          Buffers: shared hit=2
                          ->  Nested Loop (actual time=0.023..0.024 rows=0 loops=1)
                                Buffers: shared hit=2
                                ->  Nested Loop (actual time=0.023..0.023 rows=0 loops=1)
                                      Buffers: shared hit=2
                                      ->  CTE Scan on b (actual time=0.001..0.001 rows=1 loops=1)
                                      ->  Bitmap Heap Scan on "SaleReturn" sr (actual time=0.020..0.020 rows=0 loops=1)
                                            Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                            Buffers: shared hit=2
                                            ->  Bitmap Index Scan on "SaleReturn_accountId_createdAt_idx" (actual time=0.007..0.007 rows=0 loops=1)
                                                  Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                                  Buffers: shared hit=2
                                ->  Index Scan using "SaleReturnItem_saleId_accountId_idx" on "SaleReturnItem" sri (never executed)
                                      Index Cond: (("saleId" = sr."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                      Filter: ("returnId" = sr.id)
                          ->  Index Scan using "SaleItem_id_saleId_variantId_accountId_key" on "SaleItem" si_1 (never executed)
                                Index Cond: ((id = sri."saleItemId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                    ->  Index Scan using "Sale_id_accountId_key" on "Sale" os (never executed)
                          Index Cond: ((id = sri."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                          Filter: (status = 'COMPLETED'::"SaleStatus")
Planning:
  Buffers: shared hit=78
Planning Time: 5.038 ms
Execution Time: 0.436 ms
```
```
WITH b AS (SELECT (($1::date)::timestamp AT TIME ZONE $2) AS start_at, (($3::date + 1)::timestamp AT TIME ZONE $4) AS end_at), s AS ( SELECT sa."id", sa."soldBy …
Sort (actual time=0.129..0.134 rows=0 loops=1)
  Sort Key: (COALESCE(s.h, ((EXTRACT(hour FROM (sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text)))::integer)))
  Sort Method: quicksort  Memory: 25kB
  Buffers: shared hit=5
  CTE b
    ->  Result (actual time=0.001..0.002 rows=1 loops=1)
  CTE s
    ->  Nested Loop (actual time=0.030..0.030 rows=0 loops=1)
          Buffers: shared hit=3
          ->  CTE Scan on b b_1 (actual time=0.001..0.001 rows=1 loops=1)
          ->  Bitmap Heap Scan on "Sale" sa (actual time=0.027..0.027 rows=0 loops=1)
                Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                Buffers: shared hit=3
                ->  Bitmap Index Scan on "Sale_accountId_status_createdAt_idx" (actual time=0.011..0.011 rows=0 loops=1)
                      Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                      Buffers: shared hit=3
  ->  Hash Full Join (actual time=0.121..0.124 rows=0 loops=1)
        Hash Cond: (s.h = ((EXTRACT(hour FROM (sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text)))::integer))
        Buffers: shared hit=5
        ->  HashAggregate (actual time=0.033..0.034 rows=0 loops=1)
              Group Key: s.h
              Batches: 1  Memory Usage: 40kB
              Buffers: shared hit=3
              ->  CTE Scan on s (actual time=0.030..0.030 rows=0 loops=1)
                    Buffers: shared hit=3
        ->  Hash (actual time=0.066..0.069 rows=0 loops=1)
              Buckets: 1024  Batches: 1  Memory Usage: 8kB
              Buffers: shared hit=2
              ->  GroupAggregate (actual time=0.066..0.068 rows=0 loops=1)
                    Group Key: ((EXTRACT(hour FROM (sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text)))::integer)
                    Buffers: shared hit=2
                    ->  Sort (actual time=0.065..0.066 rows=0 loops=1)
                          Sort Key: ((EXTRACT(hour FROM (sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text)))::integer)
                          Sort Method: quicksort  Memory: 25kB
                          Buffers: shared hit=2
                          ->  Nested Loop (actual time=0.059..0.060 rows=0 loops=1)
                                Buffers: shared hit=2
                                ->  Nested Loop (actual time=0.058..0.060 rows=0 loops=1)
                                      Buffers: shared hit=2
                                      ->  Nested Loop (actual time=0.058..0.059 rows=0 loops=1)
                                            Buffers: shared hit=2
                                            ->  Nested Loop (actual time=0.058..0.058 rows=0 loops=1)
                                                  Buffers: shared hit=2
                                                  ->  CTE Scan on b (actual time=0.005..0.006 rows=1 loops=1)
                                                  ->  Bitmap Heap Scan on "SaleReturn" sr (actual time=0.049..0.049 rows=0 loops=1)
                                                        Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                                        Buffers: shared hit=2
                                                        ->  Bitmap Index Scan on "SaleReturn_accountId_createdAt_idx" (actual time=0.015..0.015 rows=0 loops=1)
                                                              Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                                              Buffers: shared hit=2
                                            ->  Index Scan using "SaleReturnItem_saleId_accountId_idx" on "SaleReturnItem" sri (never executed)
                                                  Index Cond: (("saleId" = sr."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                                  Filter: ("returnId" = sr.id)
                                      ->  Index Only Scan using "SaleItem_id_saleId_variantId_accountId_key" on "SaleItem" si (never executed)
                                            Index Cond: ((id = sri."saleItemId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                            Heap Fetches: 0
                                ->  Index Scan using "Sale_id_accountId_key" on "Sale" os (never executed)
                                      Index Cond: ((id = sri."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                      Filter: (status = 'COMPLETED'::"SaleStatus")
Planning:
  Buffers: shared hit=70
Planning Time: 4.340 ms
Execution Time: 0.348 ms
```
```
WITH b AS (SELECT (($1::date)::timestamp AT TIME ZONE $2) AS start_at, ((($3::date)::timestamp + make_interval(mins => $4::int)) AT TIME ZONE $5) AS end_at), s  …
Hash Full Join (actual time=0.149..0.154 rows=0 loops=1)
  Hash Cond: (((((sa."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date) = (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date)) AND (si."variantId" = sri."variantId"))
  Buffers: shared hit=5
  CTE b
    ->  Result (actual time=0.002..0.002 rows=1 loops=1)
  ->  HashAggregate (actual time=0.046..0.048 rows=0 loops=1)
        Group Key: ((sa."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date, si."variantId"
        Batches: 1  Memory Usage: 121kB
        Buffers: shared hit=3
        ->  Nested Loop (actual time=0.028..0.029 rows=0 loops=1)
              Buffers: shared hit=3
              ->  Nested Loop (actual time=0.028..0.029 rows=0 loops=1)
                    Buffers: shared hit=3
                    ->  CTE Scan on b (actual time=0.001..0.001 rows=1 loops=1)
                    ->  Bitmap Heap Scan on "Sale" sa (actual time=0.025..0.025 rows=0 loops=1)
                          Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                          Buffers: shared hit=3
                          ->  Bitmap Index Scan on "Sale_accountId_status_createdAt_idx" (actual time=0.015..0.015 rows=0 loops=1)
                                Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                Buffers: shared hit=3
              ->  Index Scan using "SaleItem_saleId_accountId_idx" on "SaleItem" si (never executed)
                    Index Cond: (("saleId" = sa.id) AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
  ->  Hash (actual time=0.078..0.080 rows=0 loops=1)
        Buckets: 1024  Batches: 1  Memory Usage: 8kB
        Buffers: shared hit=2
        ->  GroupAggregate (actual time=0.076..0.078 rows=0 loops=1)
              Group Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date), sri."variantId"
              Buffers: shared hit=2
              ->  Sort (actual time=0.074..0.076 rows=0 loops=1)
                    Sort Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date), sri."variantId"
                    Sort Method: quicksort  Memory: 25kB
                    Buffers: shared hit=2
                    ->  Nested Loop (actual time=0.061..0.063 rows=0 loops=1)
                          Buffers: shared hit=2
                          ->  Nested Loop (actual time=0.061..0.062 rows=0 loops=1)
                                Buffers: shared hit=2
                                ->  Nested Loop (actual time=0.060..0.061 rows=0 loops=1)
                                      Buffers: shared hit=2
                                      ->  Nested Loop (actual time=0.060..0.061 rows=0 loops=1)
                                            Buffers: shared hit=2
                                            ->  CTE Scan on b b_1 (actual time=0.010..0.011 rows=1 loops=1)
                                            ->  Bitmap Heap Scan on "SaleReturn" sr (actual time=0.044..0.044 rows=0 loops=1)
                                                  Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                                                  Buffers: shared hit=2
                                                  ->  Bitmap Index Scan on "SaleReturn_accountId_createdAt_idx" (actual time=0.018..0.018 rows=0 loops=1)
                                                        Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                                                        Buffers: shared hit=2
                                      ->  Index Scan using "SaleReturnItem_saleId_accountId_idx" on "SaleReturnItem" sri (never executed)
                                            Index Cond: (("saleId" = sr."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                            Filter: ("returnId" = sr.id)
                                ->  Index Scan using "SaleItem_id_saleId_variantId_accountId_key" on "SaleItem" si_1 (never executed)
                                      Index Cond: ((id = sri."saleItemId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                          ->  Index Scan using "Sale_id_accountId_key" on "Sale" os (never executed)
                                Index Cond: ((id = sri."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                Filter: (status = 'COMPLETED'::"SaleStatus")
Planning:
  Buffers: shared hit=88
Planning Time: 4.971 ms
Execution Time: 0.479 ms
```
```
WITH b AS (SELECT (($1::date)::timestamp AT TIME ZONE $2) AS start_at, ((($3::date)::timestamp + make_interval(mins => $4::int)) AT TIME ZONE $5) AS end_at), s  …
Sort (actual time=0.120..0.125 rows=0 loops=1)
  Sort Key: (COALESCE(s.h, ((EXTRACT(hour FROM (sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text)))::integer)))
  Sort Method: quicksort  Memory: 25kB
  Buffers: shared hit=5
  CTE b
    ->  Result (actual time=0.001..0.002 rows=1 loops=1)
  CTE s
    ->  Nested Loop (actual time=0.024..0.025 rows=0 loops=1)
          Buffers: shared hit=3
          ->  CTE Scan on b b_1 (actual time=0.001..0.002 rows=1 loops=1)
          ->  Bitmap Heap Scan on "Sale" sa (actual time=0.021..0.022 rows=0 loops=1)
                Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                Buffers: shared hit=3
                ->  Bitmap Index Scan on "Sale_accountId_status_createdAt_idx" (actual time=0.010..0.010 rows=0 loops=1)
                      Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                      Buffers: shared hit=3
  ->  Hash Full Join (actual time=0.111..0.114 rows=0 loops=1)
        Hash Cond: (s.h = ((EXTRACT(hour FROM (sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text)))::integer))
        Buffers: shared hit=5
        ->  HashAggregate (actual time=0.028..0.028 rows=0 loops=1)
              Group Key: s.h
              Batches: 1  Memory Usage: 40kB
              Buffers: shared hit=3
              ->  CTE Scan on s (actual time=0.024..0.025 rows=0 loops=1)
                    Buffers: shared hit=3
        ->  Hash (actual time=0.061..0.064 rows=0 loops=1)
              Buckets: 1024  Batches: 1  Memory Usage: 8kB
              Buffers: shared hit=2
              ->  GroupAggregate (actual time=0.060..0.062 rows=0 loops=1)
                    Group Key: ((EXTRACT(hour FROM (sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text)))::integer)
                    Buffers: shared hit=2
                    ->  Sort (actual time=0.059..0.061 rows=0 loops=1)
                          Sort Key: ((EXTRACT(hour FROM (sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text)))::integer)
                          Sort Method: quicksort  Memory: 25kB
                          Buffers: shared hit=2
                          ->  Nested Loop (actual time=0.053..0.054 rows=0 loops=1)
                                Buffers: shared hit=2
                                ->  Nested Loop (actual time=0.052..0.053 rows=0 loops=1)
                                      Buffers: shared hit=2
                                      ->  Nested Loop (actual time=0.052..0.053 rows=0 loops=1)
                                            Buffers: shared hit=2
                                            ->  Nested Loop (actual time=0.051..0.052 rows=0 loops=1)
                                                  Buffers: shared hit=2
                                                  ->  CTE Scan on b (actual time=0.005..0.006 rows=1 loops=1)
                                                  ->  Bitmap Heap Scan on "SaleReturn" sr (actual time=0.043..0.043 rows=0 loops=1)
                                                        Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                                        Buffers: shared hit=2
                                                        ->  Bitmap Index Scan on "SaleReturn_accountId_createdAt_idx" (actual time=0.014..0.014 rows=0 loops=1)
                                                              Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                                              Buffers: shared hit=2
                                            ->  Index Scan using "SaleReturnItem_saleId_accountId_idx" on "SaleReturnItem" sri (never executed)
                                                  Index Cond: (("saleId" = sr."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                                  Filter: ("returnId" = sr.id)
                                      ->  Index Only Scan using "SaleItem_id_saleId_variantId_accountId_key" on "SaleItem" si (never executed)
                                            Index Cond: ((id = sri."saleItemId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                            Heap Fetches: 0
                                ->  Index Scan using "Sale_id_accountId_key" on "Sale" os (never executed)
                                      Index Cond: ((id = sri."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                      Filter: (status = 'COMPLETED'::"SaleStatus")
Planning:
  Buffers: shared hit=70
Planning Time: 4.173 ms
Execution Time: 0.317 ms
```

### daily (past day)

```
 SELECT "date"::text AS d, SUM("salesTotal")::text AS sales, SUM("costTotal")::text AS cost, SUM("invoiceCount")::int AS invoices, SUM("piecesSold")::int AS pie …
GroupAggregate (actual time=0.055..0.055 rows=1 loops=1)
  Group Key: date
  Buffers: shared hit=4
  ->  Index Scan using "DailySalesRollup_accountId_date_idx" on "DailySalesRollup" (actual time=0.035..0.035 rows=1 loops=1)
        Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (date >= '2026-09-24'::date) AND (date <= '2026-09-24'::date))
        Filter: ("storeId" = ANY ('{604b41aa-05eb-4bc1-b0ef-6cfdefa3b503}'::uuid[]))
        Buffers: shared hit=4
Planning:
  Buffers: shared hit=127
Planning Time: 3.721 ms
Execution Time: 0.103 ms
```
```
 SELECT "userId"::text AS u, SUM("salesTotal")::text AS sales, SUM("costTotal")::text AS cost, SUM("invoiceCount")::int AS n FROM "DailyStaffRollup" WHERE "acco …
GroupAggregate (actual time=0.061..0.063 rows=2 loops=1)
  Group Key: "userId"
  Buffers: shared hit=4
  ->  Sort (actual time=0.052..0.053 rows=2 loops=1)
        Sort Key: "userId"
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=4
        ->  Index Scan using "DailyStaffRollup_pkey" on "DailyStaffRollup" (actual time=0.040..0.042 rows=2 loops=1)
              Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("storeId" = ANY ('{604b41aa-05eb-4bc1-b0ef-6cfdefa3b503}'::uuid[])) AND (date >= '2026-09-24'::date) AND (date <= '2026-09-24'::date))
              Buffers: shared hit=4
Planning:
  Buffers: shared hit=97
Planning Time: 6.897 ms
Execution Time: 0.097 ms
```
```
 SELECT "variantId"::text AS v, SUM("quantity")::int AS qty, SUM("salesTotal")::text AS sales, SUM("costTotal")::text AS cost FROM "DailyProductRollup" WHERE "a …
GroupAggregate (actual time=0.060..0.084 rows=23 loops=1)
  Group Key: "variantId"
  Buffers: shared hit=5
  ->  Sort (actual time=0.051..0.053 rows=23 loops=1)
        Sort Key: "variantId"
        Sort Method: quicksort  Memory: 26kB
        Buffers: shared hit=5
        ->  Index Scan using "DailyProductRollup_pkey" on "DailyProductRollup" (actual time=0.036..0.042 rows=23 loops=1)
              Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("storeId" = ANY ('{604b41aa-05eb-4bc1-b0ef-6cfdefa3b503}'::uuid[])) AND (date >= '2026-09-24'::date) AND (date <= '2026-09-24'::date))
              Buffers: shared hit=5
Planning:
  Buffers: shared hit=100
Planning Time: 5.005 ms
Execution Time: 0.150 ms
```
```
WITH b AS (SELECT (($1::date)::timestamp AT TIME ZONE $2) AS start_at, (($3::date + 1)::timestamp AT TIME ZONE $4) AS end_at), s AS ( SELECT sa."id", sa."soldBy …
Sort (actual time=0.193..0.196 rows=11 loops=1)
  Sort Key: (COALESCE(s.h, ((EXTRACT(hour FROM (sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text)))::integer)))
  Sort Method: quicksort  Memory: 25kB
  Buffers: shared hit=7
  CTE b
    ->  Result (actual time=0.001..0.001 rows=1 loops=1)
  CTE s
    ->  Nested Loop (actual time=0.058..0.100 rows=33 loops=1)
          Buffers: shared hit=5
          ->  CTE Scan on b b_1 (actual time=0.002..0.002 rows=1 loops=1)
          ->  Bitmap Heap Scan on "Sale" sa (actual time=0.039..0.053 rows=33 loops=1)
                Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                Heap Blocks: exact=2
                Buffers: shared hit=5
                ->  Bitmap Index Scan on "Sale_accountId_status_createdAt_idx" (actual time=0.021..0.021 rows=33 loops=1)
                      Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                      Buffers: shared hit=3
  ->  Hash Full Join (actual time=0.173..0.185 rows=11 loops=1)
        Hash Cond: (s.h = ((EXTRACT(hour FROM (sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text)))::integer))
        Buffers: shared hit=7
        ->  HashAggregate (actual time=0.130..0.134 rows=11 loops=1)
              Group Key: s.h
              Batches: 1  Memory Usage: 40kB
              Buffers: shared hit=5
              ->  CTE Scan on s (actual time=0.059..0.112 rows=33 loops=1)
                    Buffers: shared hit=5
        ->  Hash (actual time=0.034..0.036 rows=0 loops=1)
              Buckets: 1024  Batches: 1  Memory Usage: 8kB
              Buffers: shared hit=2
              ->  GroupAggregate (actual time=0.034..0.035 rows=0 loops=1)
                    Group Key: ((EXTRACT(hour FROM (sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text)))::integer)
                    Buffers: shared hit=2
                    ->  Sort (actual time=0.033..0.034 rows=0 loops=1)
                          Sort Key: ((EXTRACT(hour FROM (sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text)))::integer)
                          Sort Method: quicksort  Memory: 25kB
                          Buffers: shared hit=2
                          ->  Nested Loop (actual time=0.028..0.029 rows=0 loops=1)
                                Buffers: shared hit=2
                                ->  Nested Loop (actual time=0.028..0.028 rows=0 loops=1)
                                      Buffers: shared hit=2
                                      ->  Nested Loop (actual time=0.027..0.028 rows=0 loops=1)
                                            Buffers: shared hit=2
                                            ->  Nested Loop (actual time=0.027..0.028 rows=0 loops=1)
                                                  Buffers: shared hit=2
                                                  ->  CTE Scan on b (actual time=0.003..0.003 rows=1 loops=1)
                                                  ->  Bitmap Heap Scan on "SaleReturn" sr (actual time=0.023..0.023 rows=0 loops=1)
                                                        Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                                        Buffers: shared hit=2
                                                        ->  Bitmap Index Scan on "SaleReturn_accountId_createdAt_idx" (actual time=0.007..0.007 rows=0 loops=1)
                                                              Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                                              Buffers: shared hit=2
                                            ->  Index Scan using "SaleReturnItem_saleId_accountId_idx" on "SaleReturnItem" sri (never executed)
                                                  Index Cond: (("saleId" = sr."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                                  Filter: ("returnId" = sr.id)
                                      ->  Index Only Scan using "SaleItem_id_saleId_variantId_accountId_key" on "SaleItem" si (never executed)
                                            Index Cond: ((id = sri."saleItemId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                            Heap Fetches: 0
                                ->  Index Scan using "Sale_id_accountId_key" on "Sale" os (never executed)
                                      Index Cond: ((id = sri."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                      Filter: (status = 'COMPLETED'::"SaleStatus")
Planning:
  Buffers: shared hit=70
Planning Time: 2.107 ms
Execution Time: 0.307 ms
```
```
SELECT "public"."ProductVariant"."id", "public"."ProductVariant"."color", "public"."ProductVariant"."size", "public"."ProductVariant"."productId", "public"."Pro …
Bitmap Heap Scan on "ProductVariant" (actual time=0.142..0.146 rows=23 loops=1)
  Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (id = ANY ('{175c27c6-7d80-4df2-97f7-e4e1f2792c3a,20691f67-e463-4761-9ffe-52ef217f9fcc,22c9040f-e23f-4377-aa04-7a371a11d1b6,3020f1c6-f429-4501-a3d5-6535e39c3ba7,3579a3e2-023a-4c97-83a3-1227e22e6d49,46cafcb4-621b-470d-8e2e-a32272fe52e8,51062291-1259-4a78-b6bc-95965c0dc7fb,645c6396-c5fe-4ecc-add3-805fe427f8c0,68651824-0e0a-4a90-918b-e303ef74a3c0,71bd4b5f-3619-4fc3-b572-34cf600f7d71,763c6096-35f7-4355-8251-0c5fb37b7af5,80dcefdb-e09f-462a-b431-0074de29bee9,80ff6e0a-12a3-4d24-a430-7f3a116453d1,988449cf-b614-4a7c-adbc-a8e2215666c5,abab7f4d-107d-4b1c-8e72-10cea2209509,adb8a3db-19b8-4f62-930a-d0e9a6582884,c8b36d78-ed39-46c2-b403-9a3262b22379,d26cf8e8-7821-40af-90aa-f9ddf6b85b26,dd33753a-907c-4eed-9646-31b98c0b8876,e94cbc30-f42c-4182-84a9-943f6657f917,ed3ae286-a843-4400-a128-6ab5a8cf5d17,f36b1b90-d512-42b1-bed2-78b1acc01eb3,fa3d28c3-23cd-471e-b9ec-35079174a015}'::uuid[])))
  Heap Blocks: exact=1
  Buffers: shared hit=31
  ->  BitmapAnd (actual time=0.121..0.121 rows=0 loops=1)
        Buffers: shared hit=30
        ->  Bitmap Index Scan on "ProductVariant_accountId_barcode_key" (actual time=0.021..0.021 rows=24 loops=1)
              Index Cond: ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid)
              Buffers: shared hit=2
        ->  Bitmap Index Scan on "ProductVariant_pkey" (actual time=0.099..0.099 rows=23 loops=1)
              Index Cond: (id = ANY ('{175c27c6-7d80-4df2-97f7-e4e1f2792c3a,20691f67-e463-4761-9ffe-52ef217f9fcc,22c9040f-e23f-4377-aa04-7a371a11d1b6,3020f1c6-f429-4501-a3d5-6535e39c3ba7,3579a3e2-023a-4c97-83a3-1227e22e6d49,46cafcb4-621b-470d-8e2e-a32272fe52e8,51062291-1259-4a78-b6bc-95965c0dc7fb,645c6396-c5fe-4ecc-add3-805fe427f8c0,68651824-0e0a-4a90-918b-e303ef74a3c0,71bd4b5f-3619-4fc3-b572-34cf600f7d71,763c6096-35f7-4355-8251-0c5fb37b7af5,80dcefdb-e09f-462a-b431-0074de29bee9,80ff6e0a-12a3-4d24-a430-7f3a116453d1,988449cf-b614-4a7c-adbc-a8e2215666c5,abab7f4d-107d-4b1c-8e72-10cea2209509,adb8a3db-19b8-4f62-930a-d0e9a6582884,c8b36d78-ed39-46c2-b403-9a3262b22379,d26cf8e8-7821-40af-90aa-f9ddf6b85b26,dd33753a-907c-4eed-9646-31b98c0b8876,e94cbc30-f42c-4182-84a9-943f6657f917,ed3ae286-a843-4400-a128-6ab5a8cf5d17,f36b1b90-d512-42b1-bed2-78b1acc01eb3,fa3d28c3-23cd-471e-b9ec-35079174a015}'::uuid[]))
              Buffers: shared hit=28
Planning:
  Buffers: shared hit=168
Planning Time: 9.323 ms
Execution Time: 0.167 ms
```

### weekly

```
 SELECT "date"::text AS d, SUM("salesTotal")::text AS sales, SUM("costTotal")::text AS cost, SUM("invoiceCount")::int AS invoices, SUM("piecesSold")::int AS pie …
GroupAggregate (actual time=0.118..0.150 rows=7 loops=1)
  Group Key: date
  Buffers: shared hit=5
  ->  Sort (actual time=0.101..0.103 rows=7 loops=1)
        Sort Key: date
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=5
        ->  Index Scan using "DailySalesRollup_pkey" on "DailySalesRollup" (actual time=0.083..0.090 rows=7 loops=1)
              Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("storeId" = ANY ('{604b41aa-05eb-4bc1-b0ef-6cfdefa3b503}'::uuid[])) AND (date >= '2026-08-31'::date) AND (date <= '2026-09-06'::date))
              Buffers: shared hit=5
Planning Time: 0.256 ms
Execution Time: 0.256 ms
```
```
 SELECT "userId"::text AS u, SUM("salesTotal")::text AS sales, SUM("costTotal")::text AS cost, SUM("invoiceCount")::int AS n FROM "DailyStaffRollup" WHERE "acco …
GroupAggregate (actual time=0.063..0.068 rows=2 loops=1)
  Group Key: "userId"
  Buffers: shared hit=4
  ->  Sort (actual time=0.050..0.051 rows=14 loops=1)
        Sort Key: "userId"
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=4
        ->  Index Scan using "DailyStaffRollup_pkey" on "DailyStaffRollup" (actual time=0.034..0.039 rows=14 loops=1)
              Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("storeId" = ANY ('{604b41aa-05eb-4bc1-b0ef-6cfdefa3b503}'::uuid[])) AND (date >= '2026-08-31'::date) AND (date <= '2026-09-06'::date))
              Buffers: shared hit=4
Planning Time: 0.254 ms
Execution Time: 0.112 ms
```
```
 SELECT "variantId"::text AS v, SUM("quantity")::int AS qty, SUM("salesTotal")::text AS sales, SUM("costTotal")::text AS cost FROM "DailyProductRollup" WHERE "a …
GroupAggregate (actual time=0.216..0.294 rows=24 loops=1)
  Group Key: "variantId"
  Buffers: shared hit=31
  ->  Sort (actual time=0.204..0.212 rows=161 loops=1)
        Sort Key: "variantId"
        Sort Method: quicksort  Memory: 32kB
        Buffers: shared hit=31
        ->  Index Scan using "DailyProductRollup_pkey" on "DailyProductRollup" (actual time=0.057..0.143 rows=161 loops=1)
              Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("storeId" = ANY ('{604b41aa-05eb-4bc1-b0ef-6cfdefa3b503}'::uuid[])) AND (date >= '2026-08-31'::date) AND (date <= '2026-09-06'::date))
              Buffers: shared hit=31
Planning Time: 0.139 ms
Execution Time: 0.324 ms
```
```
SELECT "public"."ProductVariant"."id", "public"."ProductVariant"."color", "public"."ProductVariant"."size", "public"."ProductVariant"."productId", "public"."Pro …
Bitmap Heap Scan on "ProductVariant" (actual time=0.084..0.089 rows=24 loops=1)
  Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (id = ANY ('{175c27c6-7d80-4df2-97f7-e4e1f2792c3a,20691f67-e463-4761-9ffe-52ef217f9fcc,22c9040f-e23f-4377-aa04-7a371a11d1b6,3020f1c6-f429-4501-a3d5-6535e39c3ba7,34f7090a-34d3-435a-b593-e51c62543de2,3579a3e2-023a-4c97-83a3-1227e22e6d49,46cafcb4-621b-470d-8e2e-a32272fe52e8,51062291-1259-4a78-b6bc-95965c0dc7fb,645c6396-c5fe-4ecc-add3-805fe427f8c0,68651824-0e0a-4a90-918b-e303ef74a3c0,71bd4b5f-3619-4fc3-b572-34cf600f7d71,763c6096-35f7-4355-8251-0c5fb37b7af5,80dcefdb-e09f-462a-b431-0074de29bee9,80ff6e0a-12a3-4d24-a430-7f3a116453d1,988449cf-b614-4a7c-adbc-a8e2215666c5,abab7f4d-107d-4b1c-8e72-10cea2209509,adb8a3db-19b8-4f62-930a-d0e9a6582884,c8b36d78-ed39-46c2-b403-9a3262b22379,d26cf8e8-7821-40af-90aa-f9ddf6b85b26,dd33753a-907c-4eed-9646-31b98c0b8876,e94cbc30-f42c-4182-84a9-943f6657f917,ed3ae286-a843-4400-a128-6ab5a8cf5d17,f36b1b90-d512-42b1-bed2-78b1acc01eb3,fa3d28c3-23cd-471e-b9ec-35079174a015}'::uuid[])))
  Heap Blocks: exact=1
  Buffers: shared hit=31
  ->  BitmapAnd (actual time=0.070..0.071 rows=0 loops=1)
        Buffers: shared hit=30
        ->  Bitmap Index Scan on "ProductVariant_accountId_barcode_key" (actual time=0.011..0.011 rows=24 loops=1)
              Index Cond: ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid)
              Buffers: shared hit=2
        ->  Bitmap Index Scan on "ProductVariant_pkey" (actual time=0.057..0.058 rows=24 loops=1)
              Index Cond: (id = ANY ('{175c27c6-7d80-4df2-97f7-e4e1f2792c3a,20691f67-e463-4761-9ffe-52ef217f9fcc,22c9040f-e23f-4377-aa04-7a371a11d1b6,3020f1c6-f429-4501-a3d5-6535e39c3ba7,34f7090a-34d3-435a-b593-e51c62543de2,3579a3e2-023a-4c97-83a3-1227e22e6d49,46cafcb4-621b-470d-8e2e-a32272fe52e8,51062291-1259-4a78-b6bc-95965c0dc7fb,645c6396-c5fe-4ecc-add3-805fe427f8c0,68651824-0e0a-4a90-918b-e303ef74a3c0,71bd4b5f-3619-4fc3-b572-34cf600f7d71,763c6096-35f7-4355-8251-0c5fb37b7af5,80dcefdb-e09f-462a-b431-0074de29bee9,80ff6e0a-12a3-4d24-a430-7f3a116453d1,988449cf-b614-4a7c-adbc-a8e2215666c5,abab7f4d-107d-4b1c-8e72-10cea2209509,adb8a3db-19b8-4f62-930a-d0e9a6582884,c8b36d78-ed39-46c2-b403-9a3262b22379,d26cf8e8-7821-40af-90aa-f9ddf6b85b26,dd33753a-907c-4eed-9646-31b98c0b8876,e94cbc30-f42c-4182-84a9-943f6657f917,ed3ae286-a843-4400-a128-6ab5a8cf5d17,f36b1b90-d512-42b1-bed2-78b1acc01eb3,fa3d28c3-23cd-471e-b9ec-35079174a015}'::uuid[]))
              Buffers: shared hit=28
Planning Time: 0.194 ms
Execution Time: 0.112 ms
```

### monthly (current)

```
 SELECT "date"::text AS d, SUM("salesTotal")::text AS sales, SUM("costTotal")::text AS cost, SUM("invoiceCount")::int AS invoices, SUM("piecesSold")::int AS pie …
GroupAggregate (actual time=0.048..0.052 rows=2 loops=1)
  Group Key: date
  Buffers: shared hit=5
  ->  Sort (actual time=0.037..0.038 rows=2 loops=1)
        Sort Key: date
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=5
        ->  Index Scan using "DailySalesRollup_pkey" on "DailySalesRollup" (actual time=0.017..0.031 rows=2 loops=1)
              Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("storeId" = ANY ('{604b41aa-05eb-4bc1-b0ef-6cfdefa3b503}'::uuid[])) AND (date >= '2026-11-01'::date) AND (date <= '2026-11-02'::date))
              Buffers: shared hit=5
Planning Time: 0.166 ms
Execution Time: 0.090 ms
```
```
 SELECT "userId"::text AS u, SUM("salesTotal")::text AS sales, SUM("costTotal")::text AS cost, SUM("invoiceCount")::int AS n FROM "DailyStaffRollup" WHERE "acco …
GroupAggregate (actual time=0.075..0.078 rows=2 loops=1)
  Group Key: "userId"
  Buffers: shared hit=4
  ->  Sort (actual time=0.062..0.062 rows=2 loops=1)
        Sort Key: "userId"
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=4
        ->  Index Scan using "DailyStaffRollup_pkey" on "DailyStaffRollup" (actual time=0.049..0.051 rows=2 loops=1)
              Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("storeId" = ANY ('{604b41aa-05eb-4bc1-b0ef-6cfdefa3b503}'::uuid[])) AND (date >= '2026-11-01'::date) AND (date <= '2026-11-02'::date))
              Buffers: shared hit=4
Planning Time: 0.195 ms
Execution Time: 0.113 ms
```
```
 SELECT "variantId"::text AS v, SUM("quantity")::int AS qty, SUM("salesTotal")::text AS sales, SUM("costTotal")::text AS cost FROM "DailyProductRollup" WHERE "a …
GroupAggregate (actual time=0.077..0.124 rows=23 loops=1)
  Group Key: "variantId"
  Buffers: shared hit=5
  ->  Sort (actual time=0.068..0.070 rows=23 loops=1)
        Sort Key: "variantId"
        Sort Method: quicksort  Memory: 26kB
        Buffers: shared hit=5
        ->  Index Scan using "DailyProductRollup_pkey" on "DailyProductRollup" (actual time=0.052..0.057 rows=23 loops=1)
              Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("storeId" = ANY ('{604b41aa-05eb-4bc1-b0ef-6cfdefa3b503}'::uuid[])) AND (date >= '2026-11-01'::date) AND (date <= '2026-11-02'::date))
              Buffers: shared hit=5
Planning Time: 0.213 ms
Execution Time: 0.160 ms
```
```
WITH b AS (SELECT (($1::date)::timestamp AT TIME ZONE $2) AS start_at, ((($3::date)::timestamp + make_interval(mins => $4::int)) AT TIME ZONE $5) AS end_at), s  …
Merge Full Join (actual time=0.050..0.053 rows=0 loops=1)
  Merge Cond: (s.d = (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date))
  Buffers: shared hit=5
  CTE b
    ->  Result (actual time=0.001..0.001 rows=1 loops=1)
  CTE s
    ->  Nested Loop (actual time=0.026..0.026 rows=0 loops=1)
          Buffers: shared hit=3
          ->  CTE Scan on b b_1 (actual time=0.002..0.002 rows=1 loops=1)
          ->  Bitmap Heap Scan on "Sale" sa (actual time=0.023..0.023 rows=0 loops=1)
                Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                Buffers: shared hit=3
                ->  Bitmap Index Scan on "Sale_accountId_status_createdAt_idx" (actual time=0.013..0.013 rows=0 loops=1)
                      Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                      Buffers: shared hit=3
  ->  Merge Left Join (actual time=0.033..0.034 rows=0 loops=1)
        Merge Cond: (s.d = s_1.d)
        Buffers: shared hit=3
        ->  Sort (actual time=0.033..0.033 rows=0 loops=1)
              Sort Key: s.d
              Sort Method: quicksort  Memory: 25kB
              Buffers: shared hit=3
              ->  HashAggregate (actual time=0.029..0.029 rows=0 loops=1)
                    Group Key: s.d
                    Batches: 1  Memory Usage: 40kB
                    Buffers: shared hit=3
                    ->  CTE Scan on s (actual time=0.027..0.027 rows=0 loops=1)
                          Buffers: shared hit=3
        ->  GroupAggregate (never executed)
              Group Key: s_1.d
              ->  Sort (never executed)
                    Sort Key: s_1.d
                    ->  Nested Loop (never executed)
                          ->  CTE Scan on s s_1 (never executed)
                          ->  Index Scan using "SaleItem_saleId_accountId_idx" on "SaleItem" si (never executed)
                                Index Cond: (("saleId" = s_1.id) AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
  ->  GroupAggregate (actual time=0.017..0.017 rows=0 loops=1)
        Group Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date)
        Buffers: shared hit=2
        ->  Sort (actual time=0.016..0.017 rows=0 loops=1)
              Sort Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date), sr.id
              Sort Method: quicksort  Memory: 25kB
              Buffers: shared hit=2
              ->  Nested Loop (actual time=0.012..0.013 rows=0 loops=1)
                    Buffers: shared hit=2
                    ->  Nested Loop (actual time=0.012..0.013 rows=0 loops=1)
                          Buffers: shared hit=2
                          ->  Nested Loop (actual time=0.012..0.013 rows=0 loops=1)
                                Buffers: shared hit=2
                                ->  Nested Loop (actual time=0.012..0.012 rows=0 loops=1)
                                      Buffers: shared hit=2
                                      ->  CTE Scan on b (actual time=0.000..0.001 rows=1 loops=1)
                                      ->  Bitmap Heap Scan on "SaleReturn" sr (actual time=0.011..0.011 rows=0 loops=1)
                                            Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                            Buffers: shared hit=2
                                            ->  Bitmap Index Scan on "SaleReturn_accountId_createdAt_idx" (actual time=0.004..0.004 rows=0 loops=1)
                                                  Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                                  Buffers: shared hit=2
                                ->  Index Scan using "SaleReturnItem_saleId_accountId_idx" on "SaleReturnItem" sri (never executed)
                                      Index Cond: (("saleId" = sr."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                      Filter: ("returnId" = sr.id)
                          ->  Index Scan using "SaleItem_id_saleId_variantId_accountId_key" on "SaleItem" si_1 (never executed)
                                Index Cond: ((id = sri."saleItemId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                    ->  Index Scan using "Sale_id_accountId_key" on "Sale" os (never executed)
                          Index Cond: ((id = sri."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                          Filter: (status = 'COMPLETED'::"SaleStatus")
Planning:
  Buffers: shared hit=78
Planning Time: 2.484 ms
Execution Time: 0.201 ms
```
```
WITH b AS (SELECT (($1::date)::timestamp AT TIME ZONE $2) AS start_at, (($3::date + 1)::timestamp AT TIME ZONE $4) AS end_at), s AS ( SELECT sa."id", sa."soldBy …
Merge Full Join (actual time=0.048..0.050 rows=0 loops=1)
  Merge Cond: (s.d = (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date))
  Buffers: shared hit=5
  CTE b
    ->  Result (actual time=0.001..0.001 rows=1 loops=1)
  CTE s
    ->  Nested Loop (actual time=0.023..0.024 rows=0 loops=1)
          Buffers: shared hit=3
          ->  CTE Scan on b b_1 (actual time=0.002..0.002 rows=1 loops=1)
          ->  Bitmap Heap Scan on "Sale" sa (actual time=0.020..0.020 rows=0 loops=1)
                Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                Buffers: shared hit=3
                ->  Bitmap Index Scan on "Sale_accountId_status_createdAt_idx" (actual time=0.008..0.008 rows=0 loops=1)
                      Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                      Buffers: shared hit=3
  ->  Merge Left Join (actual time=0.030..0.031 rows=0 loops=1)
        Merge Cond: (s.d = s_1.d)
        Buffers: shared hit=3
        ->  Sort (actual time=0.030..0.030 rows=0 loops=1)
              Sort Key: s.d
              Sort Method: quicksort  Memory: 25kB
              Buffers: shared hit=3
              ->  HashAggregate (actual time=0.026..0.026 rows=0 loops=1)
                    Group Key: s.d
                    Batches: 1  Memory Usage: 40kB
                    Buffers: shared hit=3
                    ->  CTE Scan on s (actual time=0.024..0.024 rows=0 loops=1)
                          Buffers: shared hit=3
        ->  GroupAggregate (never executed)
              Group Key: s_1.d
              ->  Sort (never executed)
                    Sort Key: s_1.d
                    ->  Nested Loop (never executed)
                          ->  CTE Scan on s s_1 (never executed)
                          ->  Index Scan using "SaleItem_saleId_accountId_idx" on "SaleItem" si (never executed)
                                Index Cond: (("saleId" = s_1.id) AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
  ->  GroupAggregate (actual time=0.017..0.018 rows=0 loops=1)
        Group Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date)
        Buffers: shared hit=2
        ->  Sort (actual time=0.017..0.017 rows=0 loops=1)
              Sort Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date), sr.id
              Sort Method: quicksort  Memory: 25kB
              Buffers: shared hit=2
              ->  Nested Loop (actual time=0.013..0.014 rows=0 loops=1)
                    Buffers: shared hit=2
                    ->  Nested Loop (actual time=0.013..0.013 rows=0 loops=1)
                          Buffers: shared hit=2
                          ->  Nested Loop (actual time=0.013..0.013 rows=0 loops=1)
                                Buffers: shared hit=2
                                ->  Nested Loop (actual time=0.013..0.013 rows=0 loops=1)
                                      Buffers: shared hit=2
                                      ->  CTE Scan on b (actual time=0.000..0.001 rows=1 loops=1)
                                      ->  Bitmap Heap Scan on "SaleReturn" sr (actual time=0.011..0.011 rows=0 loops=1)
                                            Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                            Buffers: shared hit=2
                                            ->  Bitmap Index Scan on "SaleReturn_accountId_createdAt_idx" (actual time=0.004..0.004 rows=0 loops=1)
                                                  Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                                  Buffers: shared hit=2
                                ->  Index Scan using "SaleReturnItem_saleId_accountId_idx" on "SaleReturnItem" sri (never executed)
                                      Index Cond: (("saleId" = sr."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                      Filter: ("returnId" = sr.id)
                          ->  Index Scan using "SaleItem_id_saleId_variantId_accountId_key" on "SaleItem" si_1 (never executed)
                                Index Cond: ((id = sri."saleItemId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                    ->  Index Scan using "Sale_id_accountId_key" on "Sale" os (never executed)
                          Index Cond: ((id = sri."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                          Filter: (status = 'COMPLETED'::"SaleStatus")
Planning:
  Buffers: shared hit=78
Planning Time: 2.353 ms
Execution Time: 0.210 ms
```
```
WITH b AS (SELECT (($1::date)::timestamp AT TIME ZONE $2) AS start_at, (($3::date + 1)::timestamp AT TIME ZONE $4) AS end_at), s AS ( SELECT sa."id", sa."soldBy …
Merge Full Join (actual time=0.049..0.051 rows=0 loops=1)
  Merge Cond: ((s.d = (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date)) AND (s."soldById" = os."soldById"))
  Buffers: shared hit=5
  CTE b
    ->  Result (actual time=0.001..0.001 rows=1 loops=1)
  CTE s
    ->  Nested Loop (actual time=0.023..0.023 rows=0 loops=1)
          Buffers: shared hit=3
          ->  CTE Scan on b b_1 (actual time=0.002..0.003 rows=1 loops=1)
          ->  Bitmap Heap Scan on "Sale" sa (actual time=0.019..0.019 rows=0 loops=1)
                Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                Buffers: shared hit=3
                ->  Bitmap Index Scan on "Sale_accountId_status_createdAt_idx" (actual time=0.009..0.009 rows=0 loops=1)
                      Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                      Buffers: shared hit=3
  ->  Merge Left Join (actual time=0.031..0.032 rows=0 loops=1)
        Merge Cond: ((s.d = s_1.d) AND (s."soldById" = s_1."soldById"))
        Buffers: shared hit=3
        ->  Sort (actual time=0.031..0.031 rows=0 loops=1)
              Sort Key: s.d, s."soldById"
              Sort Method: quicksort  Memory: 25kB
              Buffers: shared hit=3
              ->  HashAggregate (actual time=0.026..0.027 rows=0 loops=1)
                    Group Key: s.d, s."soldById"
                    Batches: 1  Memory Usage: 37kB
                    Buffers: shared hit=3
                    ->  CTE Scan on s (actual time=0.024..0.024 rows=0 loops=1)
                          Buffers: shared hit=3
        ->  GroupAggregate (never executed)
              Group Key: s_1.d, s_1."soldById"
              ->  Sort (never executed)
                    Sort Key: s_1.d, s_1."soldById"
                    ->  Nested Loop (never executed)
                          ->  CTE Scan on s s_1 (never executed)
                          ->  Index Scan using "SaleItem_saleId_accountId_idx" on "SaleItem" si (never executed)
                                Index Cond: (("saleId" = s_1.id) AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
  ->  GroupAggregate (actual time=0.017..0.018 rows=0 loops=1)
        Group Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date), os."soldById"
        Buffers: shared hit=2
        ->  Sort (actual time=0.017..0.017 rows=0 loops=1)
              Sort Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date), os."soldById"
              Sort Method: quicksort  Memory: 25kB
              Buffers: shared hit=2
              ->  Nested Loop (actual time=0.013..0.013 rows=0 loops=1)
                    Buffers: shared hit=2
                    ->  Nested Loop (actual time=0.013..0.013 rows=0 loops=1)
                          Buffers: shared hit=2
                          ->  Nested Loop (actual time=0.012..0.013 rows=0 loops=1)
                                Buffers: shared hit=2
                                ->  Nested Loop (actual time=0.012..0.013 rows=0 loops=1)
                                      Buffers: shared hit=2
                                      ->  CTE Scan on b (actual time=0.000..0.001 rows=1 loops=1)
                                      ->  Bitmap Heap Scan on "SaleReturn" sr (actual time=0.011..0.011 rows=0 loops=1)
                                            Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                            Buffers: shared hit=2
                                            ->  Bitmap Index Scan on "SaleReturn_accountId_createdAt_idx" (actual time=0.004..0.004 rows=0 loops=1)
                                                  Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                                  Buffers: shared hit=2
                                ->  Index Scan using "SaleReturnItem_saleId_accountId_idx" on "SaleReturnItem" sri (never executed)
                                      Index Cond: (("saleId" = sr."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                      Filter: ("returnId" = sr.id)
                          ->  Index Scan using "SaleItem_id_saleId_variantId_accountId_key" on "SaleItem" si_1 (never executed)
                                Index Cond: ((id = sri."saleItemId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                    ->  Index Scan using "Sale_id_accountId_key" on "Sale" os (never executed)
                          Index Cond: ((id = sri."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                          Filter: (status = 'COMPLETED'::"SaleStatus")
Planning:
  Buffers: shared hit=78
Planning Time: 2.466 ms
Execution Time: 0.237 ms
```
```
WITH b AS (SELECT (($1::date)::timestamp AT TIME ZONE $2) AS start_at, (($3::date + 1)::timestamp AT TIME ZONE $4) AS end_at), s AS ( SELECT sa."id", sa."soldBy …
Hash Full Join (actual time=0.073..0.076 rows=0 loops=1)
  Hash Cond: (((((sa."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date) = (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date)) AND (si."variantId" = sri."variantId"))
  Buffers: shared hit=5
  CTE b
    ->  Result (actual time=0.001..0.001 rows=1 loops=1)
  ->  HashAggregate (actual time=0.023..0.024 rows=0 loops=1)
        Group Key: ((sa."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date, si."variantId"
        Batches: 1  Memory Usage: 121kB
        Buffers: shared hit=3
        ->  Nested Loop (actual time=0.013..0.014 rows=0 loops=1)
              Buffers: shared hit=3
              ->  Nested Loop (actual time=0.013..0.014 rows=0 loops=1)
                    Buffers: shared hit=3
                    ->  CTE Scan on b (actual time=0.000..0.001 rows=1 loops=1)
                    ->  Bitmap Heap Scan on "Sale" sa (actual time=0.012..0.012 rows=0 loops=1)
                          Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                          Buffers: shared hit=3
                          ->  Bitmap Index Scan on "Sale_accountId_status_createdAt_idx" (actual time=0.006..0.006 rows=0 loops=1)
                                Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                Buffers: shared hit=3
              ->  Index Scan using "SaleItem_saleId_accountId_idx" on "SaleItem" si (never executed)
                    Index Cond: (("saleId" = sa.id) AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
  ->  Hash (actual time=0.032..0.033 rows=0 loops=1)
        Buckets: 1024  Batches: 1  Memory Usage: 8kB
        Buffers: shared hit=2
        ->  GroupAggregate (actual time=0.032..0.032 rows=0 loops=1)
              Group Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date), sri."variantId"
              Buffers: shared hit=2
              ->  Sort (actual time=0.031..0.032 rows=0 loops=1)
                    Sort Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date), sri."variantId"
                    Sort Method: quicksort  Memory: 25kB
                    Buffers: shared hit=2
                    ->  Nested Loop (actual time=0.026..0.027 rows=0 loops=1)
                          Buffers: shared hit=2
                          ->  Nested Loop (actual time=0.026..0.026 rows=0 loops=1)
                                Buffers: shared hit=2
                                ->  Nested Loop (actual time=0.025..0.026 rows=0 loops=1)
                                      Buffers: shared hit=2
                                      ->  Nested Loop (actual time=0.025..0.026 rows=0 loops=1)
                                            Buffers: shared hit=2
                                            ->  CTE Scan on b b_1 (actual time=0.003..0.004 rows=1 loops=1)
                                            ->  Bitmap Heap Scan on "SaleReturn" sr (actual time=0.020..0.020 rows=0 loops=1)
                                                  Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                                                  Buffers: shared hit=2
                                                  ->  Bitmap Index Scan on "SaleReturn_accountId_createdAt_idx" (actual time=0.007..0.007 rows=0 loops=1)
                                                        Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                                                        Buffers: shared hit=2
                                      ->  Index Scan using "SaleReturnItem_saleId_accountId_idx" on "SaleReturnItem" sri (never executed)
                                            Index Cond: (("saleId" = sr."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                            Filter: ("returnId" = sr.id)
                                ->  Index Scan using "SaleItem_id_saleId_variantId_accountId_key" on "SaleItem" si_1 (never executed)
                                      Index Cond: ((id = sri."saleItemId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                          ->  Index Scan using "Sale_id_accountId_key" on "Sale" os (never executed)
                                Index Cond: ((id = sri."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                Filter: (status = 'COMPLETED'::"SaleStatus")
Planning:
  Buffers: shared hit=88
Planning Time: 3.215 ms
Execution Time: 0.209 ms
```
```
WITH b AS (SELECT (($1::date)::timestamp AT TIME ZONE $2) AS start_at, (($3::date + 1)::timestamp AT TIME ZONE $4) AS end_at), s AS ( SELECT sa."id", sa."soldBy …
Sort (actual time=0.058..0.061 rows=0 loops=1)
  Sort Key: (COALESCE(s.h, ((EXTRACT(hour FROM (sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text)))::integer)))
  Sort Method: quicksort  Memory: 25kB
  Buffers: shared hit=5
  CTE b
    ->  Result (actual time=0.001..0.001 rows=1 loops=1)
  CTE s
    ->  Nested Loop (actual time=0.014..0.014 rows=0 loops=1)
          Buffers: shared hit=3
          ->  CTE Scan on b b_1 (actual time=0.000..0.001 rows=1 loops=1)
          ->  Bitmap Heap Scan on "Sale" sa (actual time=0.013..0.013 rows=0 loops=1)
                Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                Buffers: shared hit=3
                ->  Bitmap Index Scan on "Sale_accountId_status_createdAt_idx" (actual time=0.006..0.006 rows=0 loops=1)
                      Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                      Buffers: shared hit=3
  ->  Hash Full Join (actual time=0.054..0.056 rows=0 loops=1)
        Hash Cond: (s.h = ((EXTRACT(hour FROM (sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text)))::integer))
        Buffers: shared hit=5
        ->  HashAggregate (actual time=0.016..0.016 rows=0 loops=1)
              Group Key: s.h
              Batches: 1  Memory Usage: 40kB
              Buffers: shared hit=3
              ->  CTE Scan on s (actual time=0.014..0.014 rows=0 loops=1)
                    Buffers: shared hit=3
        ->  Hash (actual time=0.026..0.027 rows=0 loops=1)
              Buckets: 1024  Batches: 1  Memory Usage: 8kB
              Buffers: shared hit=2
              ->  GroupAggregate (actual time=0.026..0.027 rows=0 loops=1)
                    Group Key: ((EXTRACT(hour FROM (sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text)))::integer)
                    Buffers: shared hit=2
                    ->  Sort (actual time=0.025..0.026 rows=0 loops=1)
                          Sort Key: ((EXTRACT(hour FROM (sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text)))::integer)
                          Sort Method: quicksort  Memory: 25kB
                          Buffers: shared hit=2
                          ->  Nested Loop (actual time=0.022..0.023 rows=0 loops=1)
                                Buffers: shared hit=2
                                ->  Nested Loop (actual time=0.022..0.023 rows=0 loops=1)
                                      Buffers: shared hit=2
                                      ->  Nested Loop (actual time=0.022..0.022 rows=0 loops=1)
                                            Buffers: shared hit=2
                                            ->  Nested Loop (actual time=0.022..0.022 rows=0 loops=1)
                                                  Buffers: shared hit=2
                                                  ->  CTE Scan on b (actual time=0.003..0.003 rows=1 loops=1)
                                                  ->  Bitmap Heap Scan on "SaleReturn" sr (actual time=0.017..0.018 rows=0 loops=1)
                                                        Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                                        Buffers: shared hit=2
                                                        ->  Bitmap Index Scan on "SaleReturn_accountId_createdAt_idx" (actual time=0.006..0.006 rows=0 loops=1)
                                                              Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                                              Buffers: shared hit=2
                                            ->  Index Scan using "SaleReturnItem_saleId_accountId_idx" on "SaleReturnItem" sri (never executed)
                                                  Index Cond: (("saleId" = sr."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                                  Filter: ("returnId" = sr.id)
                                      ->  Index Only Scan using "SaleItem_id_saleId_variantId_accountId_key" on "SaleItem" si (never executed)
                                            Index Cond: ((id = sri."saleItemId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                            Heap Fetches: 0
                                ->  Index Scan using "Sale_id_accountId_key" on "Sale" os (never executed)
                                      Index Cond: ((id = sri."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                      Filter: (status = 'COMPLETED'::"SaleStatus")
Planning:
  Buffers: shared hit=70
Planning Time: 2.093 ms
Execution Time: 0.171 ms
```
```
WITH b AS (SELECT (($1::date)::timestamp AT TIME ZONE $2) AS start_at, ((($3::date)::timestamp + make_interval(mins => $4::int)) AT TIME ZONE $5) AS end_at), s  …
Merge Full Join (actual time=0.084..0.087 rows=0 loops=1)
  Merge Cond: ((s.d = (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date)) AND (s."soldById" = os."soldById"))
  Buffers: shared hit=5
  CTE b
    ->  Result (actual time=0.001..0.001 rows=1 loops=1)
  CTE s
    ->  Nested Loop (actual time=0.050..0.050 rows=0 loops=1)
          Buffers: shared hit=3
          ->  CTE Scan on b b_1 (actual time=0.002..0.003 rows=1 loops=1)
          ->  Bitmap Heap Scan on "Sale" sa (actual time=0.045..0.045 rows=0 loops=1)
                Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                Buffers: shared hit=3
                ->  Bitmap Index Scan on "Sale_accountId_status_createdAt_idx" (actual time=0.028..0.028 rows=0 loops=1)
                      Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                      Buffers: shared hit=3
  ->  Merge Left Join (actual time=0.059..0.059 rows=0 loops=1)
        Merge Cond: ((s.d = s_1.d) AND (s."soldById" = s_1."soldById"))
        Buffers: shared hit=3
        ->  Sort (actual time=0.058..0.058 rows=0 loops=1)
              Sort Key: s.d, s."soldById"
              Sort Method: quicksort  Memory: 25kB
              Buffers: shared hit=3
              ->  HashAggregate (actual time=0.053..0.053 rows=0 loops=1)
                    Group Key: s.d, s."soldById"
                    Batches: 1  Memory Usage: 37kB
                    Buffers: shared hit=3
                    ->  CTE Scan on s (actual time=0.051..0.051 rows=0 loops=1)
                          Buffers: shared hit=3
        ->  GroupAggregate (never executed)
              Group Key: s_1.d, s_1."soldById"
              ->  Sort (never executed)
                    Sort Key: s_1.d, s_1."soldById"
                    ->  Nested Loop (never executed)
                          ->  CTE Scan on s s_1 (never executed)
                          ->  Index Scan using "SaleItem_saleId_accountId_idx" on "SaleItem" si (never executed)
                                Index Cond: (("saleId" = s_1.id) AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
  ->  GroupAggregate (actual time=0.025..0.026 rows=0 loops=1)
        Group Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date), os."soldById"
        Buffers: shared hit=2
        ->  Sort (actual time=0.025..0.026 rows=0 loops=1)
              Sort Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date), os."soldById"
              Sort Method: quicksort  Memory: 25kB
              Buffers: shared hit=2
              ->  Nested Loop (actual time=0.020..0.021 rows=0 loops=1)
                    Buffers: shared hit=2
                    ->  Nested Loop (actual time=0.020..0.020 rows=0 loops=1)
                          Buffers: shared hit=2
                          ->  Nested Loop (actual time=0.019..0.020 rows=0 loops=1)
                                Buffers: shared hit=2
                                ->  Nested Loop (actual time=0.019..0.020 rows=0 loops=1)
                                      Buffers: shared hit=2
                                      ->  CTE Scan on b (actual time=0.000..0.001 rows=1 loops=1)
                                      ->  Bitmap Heap Scan on "SaleReturn" sr (actual time=0.018..0.018 rows=0 loops=1)
                                            Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                            Buffers: shared hit=2
                                            ->  Bitmap Index Scan on "SaleReturn_accountId_createdAt_idx" (actual time=0.009..0.009 rows=0 loops=1)
                                                  Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                                  Buffers: shared hit=2
                                ->  Index Scan using "SaleReturnItem_saleId_accountId_idx" on "SaleReturnItem" sri (never executed)
                                      Index Cond: (("saleId" = sr."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                      Filter: ("returnId" = sr.id)
                          ->  Index Scan using "SaleItem_id_saleId_variantId_accountId_key" on "SaleItem" si_1 (never executed)
                                Index Cond: ((id = sri."saleItemId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                    ->  Index Scan using "Sale_id_accountId_key" on "Sale" os (never executed)
                          Index Cond: ((id = sri."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                          Filter: (status = 'COMPLETED'::"SaleStatus")
Planning:
  Buffers: shared hit=78
Planning Time: 2.932 ms
Execution Time: 0.301 ms
```
```
WITH b AS (SELECT (($1::date)::timestamp AT TIME ZONE $2) AS start_at, ((($3::date)::timestamp + make_interval(mins => $4::int)) AT TIME ZONE $5) AS end_at), s  …
Hash Full Join (actual time=0.110..0.113 rows=0 loops=1)
  Hash Cond: (((((sa."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date) = (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date)) AND (si."variantId" = sri."variantId"))
  Buffers: shared hit=5
  CTE b
    ->  Result (actual time=0.001..0.002 rows=1 loops=1)
  ->  HashAggregate (actual time=0.036..0.037 rows=0 loops=1)
        Group Key: ((sa."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date, si."variantId"
        Batches: 1  Memory Usage: 121kB
        Buffers: shared hit=3
        ->  Nested Loop (actual time=0.023..0.024 rows=0 loops=1)
              Buffers: shared hit=3
              ->  Nested Loop (actual time=0.023..0.024 rows=0 loops=1)
                    Buffers: shared hit=3
                    ->  CTE Scan on b (actual time=0.001..0.001 rows=1 loops=1)
                    ->  Bitmap Heap Scan on "Sale" sa (actual time=0.021..0.022 rows=0 loops=1)
                          Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                          Buffers: shared hit=3
                          ->  Bitmap Index Scan on "Sale_accountId_status_createdAt_idx" (actual time=0.012..0.012 rows=0 loops=1)
                                Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                Buffers: shared hit=3
              ->  Index Scan using "SaleItem_saleId_accountId_idx" on "SaleItem" si (never executed)
                    Index Cond: (("saleId" = sa.id) AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
  ->  Hash (actual time=0.052..0.054 rows=0 loops=1)
        Buckets: 1024  Batches: 1  Memory Usage: 8kB
        Buffers: shared hit=2
        ->  GroupAggregate (actual time=0.052..0.053 rows=0 loops=1)
              Group Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date), sri."variantId"
              Buffers: shared hit=2
              ->  Sort (actual time=0.051..0.052 rows=0 loops=1)
                    Sort Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date), sri."variantId"
                    Sort Method: quicksort  Memory: 25kB
                    Buffers: shared hit=2
                    ->  Nested Loop (actual time=0.044..0.045 rows=0 loops=1)
                          Buffers: shared hit=2
                          ->  Nested Loop (actual time=0.044..0.045 rows=0 loops=1)
                                Buffers: shared hit=2
                                ->  Nested Loop (actual time=0.044..0.044 rows=0 loops=1)
                                      Buffers: shared hit=2
                                      ->  Nested Loop (actual time=0.043..0.044 rows=0 loops=1)
                                            Buffers: shared hit=2
                                            ->  CTE Scan on b b_1 (actual time=0.004..0.005 rows=1 loops=1)
                                            ->  Bitmap Heap Scan on "SaleReturn" sr (actual time=0.037..0.037 rows=0 loops=1)
                                                  Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                                                  Buffers: shared hit=2
                                                  ->  Bitmap Index Scan on "SaleReturn_accountId_createdAt_idx" (actual time=0.013..0.013 rows=0 loops=1)
                                                        Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                                                        Buffers: shared hit=2
                                      ->  Index Scan using "SaleReturnItem_saleId_accountId_idx" on "SaleReturnItem" sri (never executed)
                                            Index Cond: (("saleId" = sr."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                            Filter: ("returnId" = sr.id)
                                ->  Index Scan using "SaleItem_id_saleId_variantId_accountId_key" on "SaleItem" si_1 (never executed)
                                      Index Cond: ((id = sri."saleItemId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                          ->  Index Scan using "Sale_id_accountId_key" on "Sale" os (never executed)
                                Index Cond: ((id = sri."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                Filter: (status = 'COMPLETED'::"SaleStatus")
Planning:
  Buffers: shared hit=88
Planning Time: 4.658 ms
Execution Time: 0.332 ms
```
```
WITH b AS (SELECT (($1::date)::timestamp AT TIME ZONE $2) AS start_at, ((($3::date)::timestamp + make_interval(mins => $4::int)) AT TIME ZONE $5) AS end_at), s  …
Sort (actual time=0.137..0.141 rows=0 loops=1)
  Sort Key: (COALESCE(s.h, ((EXTRACT(hour FROM (sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text)))::integer)))
  Sort Method: quicksort  Memory: 25kB
  Buffers: shared hit=5
  CTE b
    ->  Result (actual time=0.001..0.002 rows=1 loops=1)
  CTE s
    ->  Nested Loop (actual time=0.057..0.057 rows=0 loops=1)
          Buffers: shared hit=3
          ->  CTE Scan on b b_1 (actual time=0.001..0.001 rows=1 loops=1)
          ->  Bitmap Heap Scan on "Sale" sa (actual time=0.054..0.054 rows=0 loops=1)
                Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                Buffers: shared hit=3
                ->  Bitmap Index Scan on "Sale_accountId_status_createdAt_idx" (actual time=0.033..0.033 rows=0 loops=1)
                      Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                      Buffers: shared hit=3
  ->  Hash Full Join (actual time=0.131..0.133 rows=0 loops=1)
        Hash Cond: (s.h = ((EXTRACT(hour FROM (sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text)))::integer))
        Buffers: shared hit=5
        ->  HashAggregate (actual time=0.060..0.060 rows=0 loops=1)
              Group Key: s.h
              Batches: 1  Memory Usage: 40kB
              Buffers: shared hit=3
              ->  CTE Scan on s (actual time=0.057..0.057 rows=0 loops=1)
                    Buffers: shared hit=3
        ->  Hash (actual time=0.054..0.056 rows=0 loops=1)
              Buckets: 1024  Batches: 1  Memory Usage: 8kB
              Buffers: shared hit=2
              ->  GroupAggregate (actual time=0.053..0.055 rows=0 loops=1)
                    Group Key: ((EXTRACT(hour FROM (sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text)))::integer)
                    Buffers: shared hit=2
                    ->  Sort (actual time=0.052..0.053 rows=0 loops=1)
                          Sort Key: ((EXTRACT(hour FROM (sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text)))::integer)
                          Sort Method: quicksort  Memory: 25kB
                          Buffers: shared hit=2
                          ->  Nested Loop (actual time=0.048..0.049 rows=0 loops=1)
                                Buffers: shared hit=2
                                ->  Nested Loop (actual time=0.047..0.048 rows=0 loops=1)
                                      Buffers: shared hit=2
                                      ->  Nested Loop (actual time=0.047..0.048 rows=0 loops=1)
                                            Buffers: shared hit=2
                                            ->  Nested Loop (actual time=0.047..0.047 rows=0 loops=1)
                                                  Buffers: shared hit=2
                                                  ->  CTE Scan on b (actual time=0.005..0.006 rows=1 loops=1)
                                                  ->  Bitmap Heap Scan on "SaleReturn" sr (actual time=0.039..0.039 rows=0 loops=1)
                                                        Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                                        Buffers: shared hit=2
                                                        ->  Bitmap Index Scan on "SaleReturn_accountId_createdAt_idx" (actual time=0.012..0.012 rows=0 loops=1)
                                                              Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                                              Buffers: shared hit=2
                                            ->  Index Scan using "SaleReturnItem_saleId_accountId_idx" on "SaleReturnItem" sri (never executed)
                                                  Index Cond: (("saleId" = sr."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                                  Filter: ("returnId" = sr.id)
                                      ->  Index Only Scan using "SaleItem_id_saleId_variantId_accountId_key" on "SaleItem" si (never executed)
                                            Index Cond: ((id = sri."saleItemId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                            Heap Fetches: 0
                                ->  Index Scan using "Sale_id_accountId_key" on "Sale" os (never executed)
                                      Index Cond: ((id = sri."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                      Filter: (status = 'COMPLETED'::"SaleStatus")
Planning:
  Buffers: shared hit=70
Planning Time: 3.550 ms
Execution Time: 0.320 ms
```
```
SELECT "public"."ProductVariant"."id", "public"."ProductVariant"."color", "public"."ProductVariant"."size", "public"."ProductVariant"."productId", "public"."Pro …
Bitmap Heap Scan on "ProductVariant" (actual time=0.065..0.068 rows=23 loops=1)
  Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (id = ANY ('{175c27c6-7d80-4df2-97f7-e4e1f2792c3a,20691f67-e463-4761-9ffe-52ef217f9fcc,22c9040f-e23f-4377-aa04-7a371a11d1b6,34f7090a-34d3-435a-b593-e51c62543de2,3579a3e2-023a-4c97-83a3-1227e22e6d49,46cafcb4-621b-470d-8e2e-a32272fe52e8,51062291-1259-4a78-b6bc-95965c0dc7fb,645c6396-c5fe-4ecc-add3-805fe427f8c0,68651824-0e0a-4a90-918b-e303ef74a3c0,71bd4b5f-3619-4fc3-b572-34cf600f7d71,763c6096-35f7-4355-8251-0c5fb37b7af5,80dcefdb-e09f-462a-b431-0074de29bee9,80ff6e0a-12a3-4d24-a430-7f3a116453d1,988449cf-b614-4a7c-adbc-a8e2215666c5,abab7f4d-107d-4b1c-8e72-10cea2209509,adb8a3db-19b8-4f62-930a-d0e9a6582884,c8b36d78-ed39-46c2-b403-9a3262b22379,d26cf8e8-7821-40af-90aa-f9ddf6b85b26,dd33753a-907c-4eed-9646-31b98c0b8876,e94cbc30-f42c-4182-84a9-943f6657f917,ed3ae286-a843-4400-a128-6ab5a8cf5d17,f36b1b90-d512-42b1-bed2-78b1acc01eb3,fa3d28c3-23cd-471e-b9ec-35079174a015}'::uuid[])))
  Heap Blocks: exact=1
  Buffers: shared hit=31
  ->  BitmapAnd (actual time=0.053..0.054 rows=0 loops=1)
        Buffers: shared hit=30
        ->  Bitmap Index Scan on "ProductVariant_accountId_barcode_key" (actual time=0.010..0.010 rows=24 loops=1)
              Index Cond: ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid)
              Buffers: shared hit=2
        ->  Bitmap Index Scan on "ProductVariant_pkey" (actual time=0.042..0.042 rows=23 loops=1)
              Index Cond: (id = ANY ('{175c27c6-7d80-4df2-97f7-e4e1f2792c3a,20691f67-e463-4761-9ffe-52ef217f9fcc,22c9040f-e23f-4377-aa04-7a371a11d1b6,34f7090a-34d3-435a-b593-e51c62543de2,3579a3e2-023a-4c97-83a3-1227e22e6d49,46cafcb4-621b-470d-8e2e-a32272fe52e8,51062291-1259-4a78-b6bc-95965c0dc7fb,645c6396-c5fe-4ecc-add3-805fe427f8c0,68651824-0e0a-4a90-918b-e303ef74a3c0,71bd4b5f-3619-4fc3-b572-34cf600f7d71,763c6096-35f7-4355-8251-0c5fb37b7af5,80dcefdb-e09f-462a-b431-0074de29bee9,80ff6e0a-12a3-4d24-a430-7f3a116453d1,988449cf-b614-4a7c-adbc-a8e2215666c5,abab7f4d-107d-4b1c-8e72-10cea2209509,adb8a3db-19b8-4f62-930a-d0e9a6582884,c8b36d78-ed39-46c2-b403-9a3262b22379,d26cf8e8-7821-40af-90aa-f9ddf6b85b26,dd33753a-907c-4eed-9646-31b98c0b8876,e94cbc30-f42c-4182-84a9-943f6657f917,ed3ae286-a843-4400-a128-6ab5a8cf5d17,f36b1b90-d512-42b1-bed2-78b1acc01eb3,fa3d28c3-23cd-471e-b9ec-35079174a015}'::uuid[]))
              Buffers: shared hit=28
Planning Time: 0.179 ms
Execution Time: 0.100 ms
```
```
SELECT "public"."ProductVariant"."id", "public"."ProductVariant"."color", "public"."ProductVariant"."size", "public"."ProductVariant"."currentStock", "public"." …
Nested Loop (actual time=0.054..0.082 rows=24 loops=1)
  Buffers: shared hit=15
  ->  Bitmap Heap Scan on "Product" j0 (actual time=0.037..0.038 rows=4 loops=1)
        Recheck Cond: ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid)
        Filter: "isActive"
        Heap Blocks: exact=1
        Buffers: shared hit=3
        ->  Bitmap Index Scan on "Product_accountId_creationOperationId_key" (actual time=0.019..0.019 rows=4 loops=1)
              Index Cond: ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid)
              Buffers: shared hit=2
  ->  Index Scan using "ProductVariant_productId_accountId_idx" on "ProductVariant" (actual time=0.008..0.010 rows=6 loops=4)
        Index Cond: (("productId" = j0.id) AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
        Filter: ("isActive" AND ("currentStock" > 0))
        Buffers: shared hit=12
Planning:
  Buffers: shared hit=213
Planning Time: 8.547 ms
Execution Time: 0.106 ms
```

### yearly

```
 SELECT to_char("date", 'YYYY-MM') AS d, SUM("salesTotal")::text AS sales, SUM("costTotal")::text AS cost, SUM("invoiceCount")::int AS invoices, SUM("piecesSold …
GroupAggregate (actual time=1.301..1.500 rows=11 loops=1)
  Group Key: (to_char((date)::timestamp with time zone, 'YYYY-MM'::text))
  Buffers: shared hit=14
  ->  Sort (actual time=1.267..1.283 rows=306 loops=1)
        Sort Key: (to_char((date)::timestamp with time zone, 'YYYY-MM'::text))
        Sort Method: quicksort  Memory: 49kB
        Buffers: shared hit=14
        ->  Index Scan using "DailySalesRollup_pkey" on "DailySalesRollup" (actual time=0.867..1.135 rows=306 loops=1)
              Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("storeId" = ANY ('{604b41aa-05eb-4bc1-b0ef-6cfdefa3b503}'::uuid[])) AND (date >= '2026-01-01'::date) AND (date <= '2026-11-02'::date))
              Buffers: shared hit=11
Planning:
  Buffers: shared hit=5
Planning Time: 0.189 ms
Execution Time: 1.559 ms
```
```
WITH b AS (SELECT (($1::date)::timestamp AT TIME ZONE $2) AS start_at, (($3::date + 1)::timestamp AT TIME ZONE $4) AS end_at), s AS ( SELECT sa."id", sa."soldBy …
Merge Full Join (actual time=0.052..0.055 rows=0 loops=1)
  Merge Cond: (s.d = (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date))
  Buffers: shared hit=5
  CTE b
    ->  Result (actual time=0.001..0.001 rows=1 loops=1)
  CTE s
    ->  Nested Loop (actual time=0.027..0.028 rows=0 loops=1)
          Buffers: shared hit=3
          ->  CTE Scan on b b_1 (actual time=0.002..0.003 rows=1 loops=1)
          ->  Bitmap Heap Scan on "Sale" sa (actual time=0.023..0.024 rows=0 loops=1)
                Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                Buffers: shared hit=3
                ->  Bitmap Index Scan on "Sale_accountId_status_createdAt_idx" (actual time=0.009..0.009 rows=0 loops=1)
                      Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                      Buffers: shared hit=3
  ->  Merge Left Join (actual time=0.036..0.036 rows=0 loops=1)
        Merge Cond: (s.d = s_1.d)
        Buffers: shared hit=3
        ->  Sort (actual time=0.035..0.035 rows=0 loops=1)
              Sort Key: s.d
              Sort Method: quicksort  Memory: 25kB
              Buffers: shared hit=3
              ->  HashAggregate (actual time=0.031..0.031 rows=0 loops=1)
                    Group Key: s.d
                    Batches: 1  Memory Usage: 40kB
                    Buffers: shared hit=3
                    ->  CTE Scan on s (actual time=0.028..0.028 rows=0 loops=1)
                          Buffers: shared hit=3
        ->  GroupAggregate (never executed)
              Group Key: s_1.d
              ->  Sort (never executed)
                    Sort Key: s_1.d
                    ->  Nested Loop (never executed)
                          ->  CTE Scan on s s_1 (never executed)
                          ->  Index Scan using "SaleItem_saleId_accountId_idx" on "SaleItem" si (never executed)
                                Index Cond: (("saleId" = s_1.id) AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
  ->  GroupAggregate (actual time=0.016..0.017 rows=0 loops=1)
        Group Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date)
        Buffers: shared hit=2
        ->  Sort (actual time=0.016..0.016 rows=0 loops=1)
              Sort Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date), sr.id
              Sort Method: quicksort  Memory: 25kB
              Buffers: shared hit=2
              ->  Nested Loop (actual time=0.012..0.013 rows=0 loops=1)
                    Buffers: shared hit=2
                    ->  Nested Loop (actual time=0.012..0.012 rows=0 loops=1)
                          Buffers: shared hit=2
                          ->  Nested Loop (actual time=0.012..0.012 rows=0 loops=1)
                                Buffers: shared hit=2
                                ->  Nested Loop (actual time=0.011..0.012 rows=0 loops=1)
                                      Buffers: shared hit=2
                                      ->  CTE Scan on b (actual time=0.000..0.001 rows=1 loops=1)
                                      ->  Bitmap Heap Scan on "SaleReturn" sr (actual time=0.010..0.010 rows=0 loops=1)
                                            Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                            Buffers: shared hit=2
                                            ->  Bitmap Index Scan on "SaleReturn_accountId_createdAt_idx" (actual time=0.005..0.005 rows=0 loops=1)
                                                  Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                                  Buffers: shared hit=2
                                ->  Index Scan using "SaleReturnItem_saleId_accountId_idx" on "SaleReturnItem" sri (never executed)
                                      Index Cond: (("saleId" = sr."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                      Filter: ("returnId" = sr.id)
                          ->  Index Scan using "SaleItem_id_saleId_variantId_accountId_key" on "SaleItem" si_1 (never executed)
                                Index Cond: ((id = sri."saleItemId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                    ->  Index Scan using "Sale_id_accountId_key" on "Sale" os (never executed)
                          Index Cond: ((id = sri."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                          Filter: (status = 'COMPLETED'::"SaleStatus")
Planning:
  Buffers: shared hit=78
Planning Time: 2.683 ms
Execution Time: 0.269 ms
```
```
WITH b AS (SELECT (($1::date)::timestamp AT TIME ZONE $2) AS start_at, (($3::date + 1)::timestamp AT TIME ZONE $4) AS end_at), s AS ( SELECT sa."id", sa."soldBy …
Merge Full Join (actual time=0.052..0.055 rows=0 loops=1)
  Merge Cond: ((s.d = (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date)) AND (s."soldById" = os."soldById"))
  Buffers: shared hit=5
  CTE b
    ->  Result (actual time=0.001..0.001 rows=1 loops=1)
  CTE s
    ->  Nested Loop (actual time=0.024..0.025 rows=0 loops=1)
          Buffers: shared hit=3
          ->  CTE Scan on b b_1 (actual time=0.002..0.003 rows=1 loops=1)
          ->  Bitmap Heap Scan on "Sale" sa (actual time=0.020..0.020 rows=0 loops=1)
                Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                Buffers: shared hit=3
                ->  Bitmap Index Scan on "Sale_accountId_status_createdAt_idx" (actual time=0.009..0.009 rows=0 loops=1)
                      Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                      Buffers: shared hit=3
  ->  Merge Left Join (actual time=0.033..0.034 rows=0 loops=1)
        Merge Cond: ((s.d = s_1.d) AND (s."soldById" = s_1."soldById"))
        Buffers: shared hit=3
        ->  Sort (actual time=0.033..0.033 rows=0 loops=1)
              Sort Key: s.d, s."soldById"
              Sort Method: quicksort  Memory: 25kB
              Buffers: shared hit=3
              ->  HashAggregate (actual time=0.028..0.028 rows=0 loops=1)
                    Group Key: s.d, s."soldById"
                    Batches: 1  Memory Usage: 37kB
                    Buffers: shared hit=3
                    ->  CTE Scan on s (actual time=0.025..0.025 rows=0 loops=1)
                          Buffers: shared hit=3
        ->  GroupAggregate (never executed)
              Group Key: s_1.d, s_1."soldById"
              ->  Sort (never executed)
                    Sort Key: s_1.d, s_1."soldById"
                    ->  Nested Loop (never executed)
                          ->  CTE Scan on s s_1 (never executed)
                          ->  Index Scan using "SaleItem_saleId_accountId_idx" on "SaleItem" si (never executed)
                                Index Cond: (("saleId" = s_1.id) AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
  ->  GroupAggregate (actual time=0.018..0.019 rows=0 loops=1)
        Group Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date), os."soldById"
        Buffers: shared hit=2
        ->  Sort (actual time=0.018..0.019 rows=0 loops=1)
              Sort Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date), os."soldById"
              Sort Method: quicksort  Memory: 25kB
              Buffers: shared hit=2
              ->  Nested Loop (actual time=0.014..0.015 rows=0 loops=1)
                    Buffers: shared hit=2
                    ->  Nested Loop (actual time=0.014..0.014 rows=0 loops=1)
                          Buffers: shared hit=2
                          ->  Nested Loop (actual time=0.013..0.014 rows=0 loops=1)
                                Buffers: shared hit=2
                                ->  Nested Loop (actual time=0.013..0.014 rows=0 loops=1)
                                      Buffers: shared hit=2
                                      ->  CTE Scan on b (actual time=0.000..0.001 rows=1 loops=1)
                                      ->  Bitmap Heap Scan on "SaleReturn" sr (actual time=0.012..0.012 rows=0 loops=1)
                                            Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                            Buffers: shared hit=2
                                            ->  Bitmap Index Scan on "SaleReturn_accountId_createdAt_idx" (actual time=0.004..0.004 rows=0 loops=1)
                                                  Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                                  Buffers: shared hit=2
                                ->  Index Scan using "SaleReturnItem_saleId_accountId_idx" on "SaleReturnItem" sri (never executed)
                                      Index Cond: (("saleId" = sr."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                      Filter: ("returnId" = sr.id)
                          ->  Index Scan using "SaleItem_id_saleId_variantId_accountId_key" on "SaleItem" si_1 (never executed)
                                Index Cond: ((id = sri."saleItemId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                    ->  Index Scan using "Sale_id_accountId_key" on "Sale" os (never executed)
                          Index Cond: ((id = sri."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                          Filter: (status = 'COMPLETED'::"SaleStatus")
Planning:
  Buffers: shared hit=78
Planning Time: 2.660 ms
Execution Time: 0.268 ms
```
```
WITH b AS (SELECT (($1::date)::timestamp AT TIME ZONE $2) AS start_at, (($3::date + 1)::timestamp AT TIME ZONE $4) AS end_at), s AS ( SELECT sa."id", sa."soldBy …
Hash Full Join (actual time=0.066..0.069 rows=0 loops=1)
  Hash Cond: (((((sa."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date) = (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date)) AND (si."variantId" = sri."variantId"))
  Buffers: shared hit=5
  CTE b
    ->  Result (actual time=0.001..0.001 rows=1 loops=1)
  ->  HashAggregate (actual time=0.025..0.026 rows=0 loops=1)
        Group Key: ((sa."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date, si."variantId"
        Batches: 1  Memory Usage: 121kB
        Buffers: shared hit=3
        ->  Nested Loop (actual time=0.015..0.016 rows=0 loops=1)
              Buffers: shared hit=3
              ->  Nested Loop (actual time=0.015..0.016 rows=0 loops=1)
                    Buffers: shared hit=3
                    ->  CTE Scan on b (actual time=0.000..0.001 rows=1 loops=1)
                    ->  Bitmap Heap Scan on "Sale" sa (actual time=0.014..0.014 rows=0 loops=1)
                          Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                          Buffers: shared hit=3
                          ->  Bitmap Index Scan on "Sale_accountId_status_createdAt_idx" (actual time=0.009..0.009 rows=0 loops=1)
                                Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                Buffers: shared hit=3
              ->  Index Scan using "SaleItem_saleId_accountId_idx" on "SaleItem" si (never executed)
                    Index Cond: (("saleId" = sa.id) AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
  ->  Hash (actual time=0.032..0.033 rows=0 loops=1)
        Buckets: 1024  Batches: 1  Memory Usage: 8kB
        Buffers: shared hit=2
        ->  GroupAggregate (actual time=0.031..0.032 rows=0 loops=1)
              Group Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date), sri."variantId"
              Buffers: shared hit=2
              ->  Sort (actual time=0.030..0.031 rows=0 loops=1)
                    Sort Key: (((sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text))::date), sri."variantId"
                    Sort Method: quicksort  Memory: 25kB
                    Buffers: shared hit=2
                    ->  Nested Loop (actual time=0.025..0.025 rows=0 loops=1)
                          Buffers: shared hit=2
                          ->  Nested Loop (actual time=0.025..0.025 rows=0 loops=1)
                                Buffers: shared hit=2
                                ->  Nested Loop (actual time=0.024..0.025 rows=0 loops=1)
                                      Buffers: shared hit=2
                                      ->  Nested Loop (actual time=0.024..0.025 rows=0 loops=1)
                                            Buffers: shared hit=2
                                            ->  CTE Scan on b b_1 (actual time=0.003..0.004 rows=1 loops=1)
                                            ->  Bitmap Heap Scan on "SaleReturn" sr (actual time=0.019..0.019 rows=0 loops=1)
                                                  Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                                                  Buffers: shared hit=2
                                                  ->  Bitmap Index Scan on "SaleReturn_accountId_createdAt_idx" (actual time=0.007..0.007 rows=0 loops=1)
                                                        Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                                                        Buffers: shared hit=2
                                      ->  Index Scan using "SaleReturnItem_saleId_accountId_idx" on "SaleReturnItem" sri (never executed)
                                            Index Cond: (("saleId" = sr."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                            Filter: ("returnId" = sr.id)
                                ->  Index Scan using "SaleItem_id_saleId_variantId_accountId_key" on "SaleItem" si_1 (never executed)
                                      Index Cond: ((id = sri."saleItemId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                          ->  Index Scan using "Sale_id_accountId_key" on "Sale" os (never executed)
                                Index Cond: ((id = sri."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                Filter: (status = 'COMPLETED'::"SaleStatus")
Planning:
  Buffers: shared hit=88
Planning Time: 2.839 ms
Execution Time: 0.232 ms
```
```
WITH b AS (SELECT (($1::date)::timestamp AT TIME ZONE $2) AS start_at, (($3::date + 1)::timestamp AT TIME ZONE $4) AS end_at), s AS ( SELECT sa."id", sa."soldBy …
Sort (actual time=0.059..0.062 rows=0 loops=1)
  Sort Key: (COALESCE(s.h, ((EXTRACT(hour FROM (sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text)))::integer)))
  Sort Method: quicksort  Memory: 25kB
  Buffers: shared hit=5
  CTE b
    ->  Result (actual time=0.001..0.001 rows=1 loops=1)
  CTE s
    ->  Nested Loop (actual time=0.014..0.014 rows=0 loops=1)
          Buffers: shared hit=3
          ->  CTE Scan on b b_1 (actual time=0.000..0.001 rows=1 loops=1)
          ->  Bitmap Heap Scan on "Sale" sa (actual time=0.013..0.013 rows=0 loops=1)
                Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                Buffers: shared hit=3
                ->  Bitmap Index Scan on "Sale_accountId_status_createdAt_idx" (actual time=0.006..0.006 rows=0 loops=1)
                      Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND (status = 'COMPLETED'::"SaleStatus") AND ("createdAt" >= b_1.start_at) AND ("createdAt" < b_1.end_at))
                      Buffers: shared hit=3
  ->  Hash Full Join (actual time=0.055..0.056 rows=0 loops=1)
        Hash Cond: (s.h = ((EXTRACT(hour FROM (sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text)))::integer))
        Buffers: shared hit=5
        ->  HashAggregate (actual time=0.016..0.016 rows=0 loops=1)
              Group Key: s.h
              Batches: 1  Memory Usage: 40kB
              Buffers: shared hit=3
              ->  CTE Scan on s (actual time=0.014..0.014 rows=0 loops=1)
                    Buffers: shared hit=3
        ->  Hash (actual time=0.027..0.029 rows=0 loops=1)
              Buckets: 1024  Batches: 1  Memory Usage: 8kB
              Buffers: shared hit=2
              ->  GroupAggregate (actual time=0.027..0.028 rows=0 loops=1)
                    Group Key: ((EXTRACT(hour FROM (sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text)))::integer)
                    Buffers: shared hit=2
                    ->  Sort (actual time=0.026..0.027 rows=0 loops=1)
                          Sort Key: ((EXTRACT(hour FROM (sr."createdAt" AT TIME ZONE 'Asia/Beirut'::text)))::integer)
                          Sort Method: quicksort  Memory: 25kB
                          Buffers: shared hit=2
                          ->  Nested Loop (actual time=0.023..0.024 rows=0 loops=1)
                                Buffers: shared hit=2
                                ->  Nested Loop (actual time=0.023..0.024 rows=0 loops=1)
                                      Buffers: shared hit=2
                                      ->  Nested Loop (actual time=0.023..0.023 rows=0 loops=1)
                                            Buffers: shared hit=2
                                            ->  Nested Loop (actual time=0.023..0.023 rows=0 loops=1)
                                                  Buffers: shared hit=2
                                                  ->  CTE Scan on b (actual time=0.003..0.003 rows=1 loops=1)
                                                  ->  Bitmap Heap Scan on "SaleReturn" sr (actual time=0.018..0.018 rows=0 loops=1)
                                                        Recheck Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                                        Buffers: shared hit=2
                                                        ->  Bitmap Index Scan on "SaleReturn_accountId_createdAt_idx" (actual time=0.006..0.006 rows=0 loops=1)
                                                              Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= b.start_at) AND ("createdAt" < b.end_at))
                                                              Buffers: shared hit=2
                                            ->  Index Scan using "SaleReturnItem_saleId_accountId_idx" on "SaleReturnItem" sri (never executed)
                                                  Index Cond: (("saleId" = sr."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                                  Filter: ("returnId" = sr.id)
                                      ->  Index Only Scan using "SaleItem_id_saleId_variantId_accountId_key" on "SaleItem" si (never executed)
                                            Index Cond: ((id = sri."saleItemId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                            Heap Fetches: 0
                                ->  Index Scan using "Sale_id_accountId_key" on "Sale" os (never executed)
                                      Index Cond: ((id = sri."saleId") AND ("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid))
                                      Filter: (status = 'COMPLETED'::"SaleStatus")
Planning:
  Buffers: shared hit=70
Planning Time: 2.189 ms
Execution Time: 0.170 ms
```

### invoices

```
 SELECT s."id"::text AS id, s."receiptNumber" AS number, s."createdAt" AS created_at, (SELECT COALESCE(SUM(si."quantity"), 0)::int FROM "SaleItem" si WHERE si." …
Limit (actual time=0.110..0.362 rows=11 loops=1)
  Buffers: shared hit=55
  ->  Index Scan using "Sale_accountId_createdAt_id_idx" on "Sale" s (actual time=0.108..0.358 rows=11 loops=1)
        Index Cond: (("accountId" = '099a4ca5-3e46-4559-98c5-e03306707fa6'::uuid) AND ("createdAt" >= '2026-10-30 22:00:00+00'::timestamp with time zone) AND ("createdAt" < '2026-10-31 22:00:00+00'::timestamp with time zone))
        Buffers: shared hit=55
        SubPlan 1
          ->  Aggregate (actual time=0.022..0.022 rows=1 loops=11)
                Buffers: shared hit=45
                ->  Index Scan using "SaleItem_saleId_accountId_idx" on "SaleItem" si (actual time=0.019..0.020 rows=3 loops=11)
                      Index Cond: (("saleId" = s.id) AND ("accountId" = s."accountId"))
                      Buffers: shared hit=45
Planning:
  Buffers: shared hit=27
Planning Time: 0.653 ms
Execution Time: 0.424 ms
```
