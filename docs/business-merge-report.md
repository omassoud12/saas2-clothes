# Business reports merge — running log

Branch: `business-reports` (from `main`). Spec: `business-reference/saas2-business/docs/API.md`.

## Phase 1 — Audit

- Renamed the dropped-in folder `business -reference/` (with a space) to `business-reference/`, the name
  the task uses. It is not committed (reference material).
- Read the reference and our backend/frontend; wrote `docs/business-merge-gap-report.md`.
- **Decision — local database.** The repository has no local database and `.env` points at production.
  Added `backend/scripts/dev-db.mjs` (embedded PostgreSQL 17.11 in `backend/.dev-db/`, git-ignored,
  localhost only, UTC clock like Supabase, with Supabase's `anon` / `authenticated` / `service_role`
  roles) and `backend/scripts/with-dev-db.mjs` (runs a command with `DATABASE_URL`/`DIRECT_URL` pointing
  at it, refuses non-local hosts). All 16 existing migrations apply cleanly to it.
  Dev dependency: `embedded-postgres`.
- **Decision — stores.** We have one shop per Account. A `Store` table with one default store per account
  keeps the contract (`/api/stores`, `storeId`) without touching Sale rows; see gap report D1.
- **Decision — roles.** OWNER = owner; WAREHOUSE = the non-owner role (null cost/profit, 403 on Yearly).
- **Decision — payment methods.** WHISH_OMT is reported as WHISH; CARD and DEBT are in totals but not in
  the CASH/WHISH split.
- **Decision — money type.** New money columns use `Decimal(18,2)`, not `Decimal(12,2)`: they hold sums of
  our existing `Decimal(18,2)` columns, and an LBP account could overflow 12 digits.

## Phase 2 — Prisma

- Schema + migration `20261102120000_business_reports` (details in the gap report, "Phase 2 — what changed").
- Applied to the local database only; backend typecheck clean; backend tests 13,698 / 13,698 pass.
- **Decision — no cost backfill.** The cost snapshot already exists and Sale/SaleItem are immutable;
  `costComplete: false` covers lines without cost.
- **Decision — migrate diff instead of migrate dev** (shadow database cannot replay the Supabase
  hardening migration).

## Phase 3 — the day function and rollups

- `backend/src/business/day-totals.ts` — the one definition of a day:
  - `computeDays()` raw sales → per-day numbers (4 grouped SQL queries: day totals, staff, variants, hours),
    window `[from 00:00, to+1 00:00)` (or cut at a minute) in the account timezone with `AT TIME ZONE`;
  - `liveDay()` one day from raw sales (REPEATABLE READ, `statement_timeout` 5s), optional cut;
  - `rollupDays()` recompute finished days and replace their rows in the 3 rollup tables in one
    transaction (every day gets a `DailySalesRollup` row, zeros included; never today);
  - `rangeTotals()` finished days from the rollups (missing ones rolled up on first use) + today/cut day live.
- `business-dates.ts` (shop-local date helpers, `shopNow` via Intl), `business-stores.ts` (default store,
  `STORE_FORBIDDEN`), `rollup-jobs.ts` (refresh after void, nightly job with batches, per-account advisory
  lock, one retry, summary log; `msUntilNext` 03:30 Asia/Beirut), `scripts/rollup-backfill.ts`
  (per account and month, resumable, `--force`).
- `sale.service.ts`: optional `afterVoid` hook, called after the void commits; it never fails the void.
- Logger: added `accountId`, `endpoint` and job counters to the allowed log fields (no personal data).
- **Decisions.** Pieces = gross quantity sold (like the mock); money is net of returns made that day
  (refund amount, and quantity × the returned line's cost). A return is attributed to the day it is
  made; a void rewrites the day the sale was made. Cost is rounded half-up to cents per day and per
  breakdown row. CARD and DEBT sales are in totals, not in the CASH/WHISH split.
- **Bug found in production code (fixed in its own commit, `15935d7`).** Running the migrations on a
  real Postgres showed that `Sale_v1_totals_match_check` (`subtotal = totalAmount`, from the first
  migration) was never dropped when discounts were added in `20261101090000`, so every discounted sale
  would be rejected by the database. New migration `20261102100000_allow_discounted_sales` drops it.
  It is not applied to production (this task forbids touching production); see the final report.
- Tests (`day-totals.test.ts`, real Postgres via a throwaway database, skipped when the local server is
  off): voided sale, return the next day, missing cost, closed day, 23:59 / 00:01 Beirut, DST
  (29 Mar 2026), cut "by this time", week from rollups = sum of live days, idempotent rollups, staff and
  products agree, refresh after void, nightly job, 03:30 scheduling. **10 / 10 pass**; full backend suite
  13,708 / 13,708.

## Phase 4 — endpoints

- `backend/src/business/business.routes.ts` (one route file, mounted in `app.ts` at `/api/stores` and
  `/api/business`, wired in `index.ts` with the void hook and the nightly job) and one service per report:
  `daily.service.ts` (daily + invoices), `weekly.service.ts`, `monthly.service.ts`, `yearly.service.ts`,
  shared pieces in `report-common.ts`, owner settings in `business-settings.service.ts`.
- Every total comes from `rangeTotals` / `liveDay` / `dayHours` (no report has its own sales SQL). The
  invoice list is the only other Sale query (keyset on `(createdAt, id)`, no cost, voided included and marked).
- Rules: auth + tenant middleware first; `accountId`, user, role and timezone from the session; foreign or
  unknown `storeId` → 403 `STORE_FORBIDDEN`; hand-written validation (our convention, no zod) with
  422 `VALIDATION_ERROR`; dates not in the future; week = its Monday; `limit` 1..50; cost, profit,
  expenses and stock values `null` for non-owners; Yearly 403 `OWNER_ONLY` for non-owners.
- Live periods: `asOf` = shop time now; Daily compares yesterday and the same weekday last week cut at
  `asOf`; Weekly compares the same days of last week (today's counterpart cut); days to come get
  `forecastSalesTotal` = average of the last 4 finished same weekdays; Monthly compares the same weekdays
  (28 or 35 days back, 364 for last year) while live and whole months when finished; expenses are spread
  over the days of the current month; inventory / slow movers only for the current period.
- Added (not in the reference): `closed` and `costComplete` on Weekly/Monthly too; owner endpoints
  `PUT /api/business/targets`, `GET|POST /api/business/closed-days`, `DELETE /api/business/closed-days/:date`
  so targets and holidays can be set.
- **Decisions.** `byHour` covers 10:00–21:00 widened to the hours that had sales, up to the current hour
  while live. `itemCount` on invoices = pieces. `exchangeRate` is `Account.lbpPerUsd` without trailing
  `.00` (`"89500"`), `null` until set. Variant label `"Black · Size 56"`, `"One size"` without size,
  `"Standard"` without colour. Staff `storeNames` = the account's store name.
- Tests (`business.test.ts`, real local Postgres, fixed clock Mon 19 Oct 2026 17:00 Beirut): owner vs
  staff fields, live "by this time", Weekly days = Daily, week = sum of days, Monthly days = Daily, month
  = sum, Yearly October = Monthly October, return on its day, Yearly 403 for staff, foreign store 403
  (same store name in both accounts), tenant isolation, invoice pages / filters / no cost, validation,
  targets and closed days. **14 / 14 pass**; backend suite 13,722 / 13,722; typecheck clean.

## Phase 6 — frontend

- Ported `business-reference/saas2-business/src` to `frontend/src/features/business/` (api, domain, lib,
  hooks, components/business/{nav,shared,daily,weekly,monthly,yearly}, pages, styles). Semicolons removed
  to match our style; the mock moved behind `import.meta.env.DEV && VITE_USE_MOCK === 'true'` (dynamic
  import, not in the production bundle — checked in `dist/`).
- `api/client.js` now uses our transport (`authenticatedApiRequest` → `src/lib/api-client.js`, Supabase
  session token, abort); same function names (`apiGet`, `apiSend`, `ApiError`).
- `business.css` scoped under `.biz` (every selector, no `!important`), the reference's colour names
  mapped to `src/styles/tokens.css`, plus a reset that keeps the app's global element styles out; 44 px
  tap targets and 16 px inputs (app rules).
- Route `/app/business` (`pages/app/BusinessPage.jsx`, lazy-loaded with recharts in its own chunk) and a
  "Business" nav item for OWNER only (there is no MANAGER role). URL filters kept
  (`?view=&date=&week=&month=&year=&store=&method=&q=`).
- `recharts ^2.15.4` added to the frontend.
- Removed the unused `mapStores` ("Sales by store"); there is no "Order before you run out" section in the
  reference (the "reorder" lists are the "Not selling" dead-stock lists, which stay).
- Fixes needed by our lint rules: `useAsync` and `InvoiceList` no longer set state synchronously in
  effects or write refs during render (results are keyed by their request); unused imports removed; the
  store picker now receives the stores (the reference loaded them but never passed them).
- Old invoices without a receipt number show `#` + the first 8 characters of the id.
- **Not done: the 320 px visual check.** No browser is available in this environment; the CSS is the
  reference's mobile-first file (checked at 320 px by its author), unchanged apart from scoping and tokens.
- **Language.** The module is English and left to right inside the app (`dir="ltr"`); its texts are not
  translated yet. The nav label "Business" is translated.
- Tests: `business-ui.test.js` (mappers on the real backend shape for owner and staff, payments, invoice
  without number, no mock / no `mapStores`, CSS scoped). Frontend 731 tests, 730 pass — the one failure
  is the old `text-matching-ui.test.js:246`, unrelated. ESLint clean, build OK.

## Phase 5 — load

- Report cache (LRU, 30 s live / 10 min finished, dropped per account on rollup/target/closed-day
  changes, checked before any database work, identical concurrent requests built once), `Cache-Control`
  + weak `ETag`/304, 60 requests/min per account (429 + `Retry-After`), 5 s `statement_timeout` on raw-sales
  queries, 10 s per report, `business_report_slow` log above 500 ms (account id + endpoint only).
- Nightly job: batches of 50 accounts, per-account advisory lock, one retry, summary log (Phase 3).
- `scripts/seed-load.ts` (separate local database `saas2_load`, refuses non-local hosts; resumable):
  200 accounts × 365 days → 1,765,870 sales, 3,531,864 lines, 17,000 returns. One store per account (the
  project has no per-sale store). Backfill: 2,252 account-months in 317 s.
- `scripts/bench-business.ts`: EXPLAIN (ANALYZE, BUFFERS) of every captured report query — **no
  sequential scan on any sales table, slowest statement 1.6 ms** — and p50/p95/p99 at a chosen
  concurrency. Optimisations made from the measurements are listed in `docs/business-performance.md`.
- **Targets.** One request at a time, every report is well under its target (p95: daily 89 ms, weekly
  19, monthly 19, yearly 36). At 50 concurrent requests with no cache and every request a different
  period, on this single laptop (API + Postgres + load generator + the developer's dev servers on one
  CPU), p95 is daily 1270 ms, weekly 686, monthly 1073, yearly 880: **only Yearly meets its target; Daily,
  Weekly and Monthly do not** in that worst case. With the cache and the usual periods p50 is ~60 ms.
  Reasons and what would close the gap are in `docs/business-performance.md`.
- Database: pooled `DATABASE_URL` for the API, `DIRECT_URL` for migrations (already so), one Prisma client
  per process, optional `DATABASE_POOL_MAX`. No read replica or Redis exists; RLS is enabled with no
  policies (the API connects as the owner) and isolation is enforced and tested at query level.

## Phase 7 — final checks

1. **Consistency.** `backend/scripts/check-business-consistency.ts` (`npm run check:business`): every day
   of the current month monthly = daily, month = sum of daily, the days of each week = daily, product
   pieces month = sum of daily, yearly current month = monthly. Against a seeded local database:
   14 checks, **"All reports agree."** It also runs against a real API with `BUSINESS_API_URL` and
   `BUSINESS_API_TOKEN` (not run against production: this task forbids touching it). Added to CI
   (`.github/workflows/business-reports.yml`, the first workflow in the repo: backend typecheck, tests on
   the embedded Postgres, the consistency check).
   Writing the check found a real bug: Monthly runs several ranges in parallel and two of them rolled up
   the same missing days at once (unique violation, 500). Fixed with a per-account advisory lock;
   regression test added.
2. **Tests, lint, typecheck, build.** Backend: 13,730 / 13,730 tests, typecheck clean, build OK.
   Frontend: 735 tests, 734 pass — the one failure is the old `text-matching-ui.test.js:246` (fails on
   `main` too, unrelated); ESLint clean; build OK.
3. **Role matrix** (`backend/src/business/business.test.ts`, spec reporter):

   | | OWNER | WAREHOUSE (non-owner) |
   |---|---|---|
   | Daily / Weekly / Monthly sales, invoices, pieces, payments | yes | yes |
   | costTotal, profitTotal, staff/product profit | yes | `null` |
   | Monthly expenses, stock values | yes | `null` |
   | Yearly | yes | 403 `OWNER_ONLY` |
   | Targets / closed days (write) | yes | 403 |

   ```
     ok /api/stores lists the account's own store only
     ok daily (owner): the documented shape, net of the void, with cost and profit
     ok daily (staff): cost, profit and every profit breakdown are null
     ok daily today is live, and yesterday is compared by this time (17:00)
     ok the week of Monday 12 Oct: Monday = the Daily of Monday, and the week = the sum of its days
     ok this week is live: days to come are null with a forecast, last week is cut at 17:00 today
     ok the month: every day = Daily, totals = the sum, and the yearly October = the monthly October
     ok the return lowers the day it is made
     ok yearly is for the owner only
     ok a store of another account is 403, even with the same name; "all" and the own store work
     ok tenant isolation: account B never sees account A's numbers
     ok invoices: newest first, keyset pages, voided marked, method filter, never cost
     ok validation: future dates, bad months and bad weeks are rejected
     ok targets and closed days: the owner sets them and the reports show them
   ok business endpoints
     ok Cache-Control and ETag: a repeated request with If-None-Match gets 304
     ok a per-account rate limit answers 429 with Retry-After
   ok load protection
   ```
4. **Tenant isolation** passes (two accounts with the same store name: the other account's store → 403;
   numbers, invoices and stores never cross).
5. **Performance** — see Phase 5: met for single requests and for Yearly at 50 concurrent; not met for
   uncached Daily/Weekly/Monthly at 50 concurrent on this machine.
6. `docs/business.md` written.

## Summary

### Commits (branch `business-reports`)

| Commit | Phase |
|---|---|
| `fd7b19f` | 1 — gap report, local dev database |
| `8ebbac3` | 2 — schema and migration |
| `15935d7` | fix — discounted sales were rejected by the database (production bug, see below) |
| `29ddc78` | 3 — the day function, rollups, freshness |
| `f0fd412` | 4 — endpoints |
| `d29329d` | 5 — cache, rate limit, time limits |
| `9fd37f8` | 6 — frontend |
| `521ee60` | 7 — consistency check, rollup lock fix, expense category, docs |
| `c31a2c4` | 5 — performance work and results |

92 files, about 8,900 lines added (without the lock file).

### Migrations

- `20261102100000_allow_discounted_sales` — drops `Sale_v1_totals_match_check`.
- `20261102120000_business_reports` — additive (Account.timezone, Expense.category, Store + default store
  per account, SalesTarget, ClosedDay, three rollup tables, one Sale index, RLS/revokes).

Both were applied to the local databases only. **Neither is applied to production.**

### Must know before going live

1. **Production bug (not caused by this task, found by it).** Production already has `20261101090000`
   (discounts) applied but still has `Sale_v1_totals_match_check`, so as soon as the POS code with final
   prices is deployed, every sale below the catalog price fails with a 500. Apply
   `20261102100000_allow_discounted_sales` (`prisma migrate deploy`) together with, or before, the next
   deploy of `main`. It can be cherry-picked to `main` on its own (`15935d7`).
2. After the business migration is applied in production, run the backfill once
   (`npx tsx scripts/rollup-backfill.ts`); otherwise the first report of each month rolls its days up on
   demand (it works, only slower the first time).
3. `.env` points at production: always use `scripts/with-dev-db.mjs` for local work.

### Not done, and why

- **Multi-store.** The project has one shop per account and no store on sales; the API keeps the store
  contract with one default store per account. Real multi-store needs `Sale.storeId`, per-store stock and
  staff/store links.
- **Cost backfill / `costEstimated`.** Not needed (the cost snapshot exists) and not possible (sale lines
  are immutable by design).
- **Performance targets at 50 concurrent without cache** for Daily, Weekly and Monthly on this laptop.
- **320 px visual check** of the Business screens: no browser in this environment.
- **Arabic** for the Business screens (English, left to right for now); screens for targets and closed
  days (API only); Redis, a read replica and per-row RLS policies (not available, or they would change
  how the whole app connects).
- The consistency script was not run against the real API (production must not be touched here).
