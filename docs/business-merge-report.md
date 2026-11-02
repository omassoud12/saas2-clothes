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
