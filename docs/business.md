# Business reports

The owner's Daily, Weekly, Monthly and Yearly reports (`/app/business` in the app). The contract is
`business-reference/saas2-business/docs/API.md`; this page says how it works in this project.

## What each report shows

| Report | Shows |
|---|---|
| **Daily** (`GET /api/business/daily?date&storeId`) | Sales (net of the day's returns), cost, gross profit and margin (owner), invoices, pieces, discounts and returns, yesterday and the same weekday last week compared "by this time" while today is live, Cash / Whish for the drawer, sales by employee, products with variants, sales by hour, and the day's invoices (`/daily/invoices`, keyset pages, search by receipt number or customer, Cash/Whish filter, voided marked, never cost). |
| **Weekly** (`/weekly?week&storeId`) | Monday–Sunday: totals, last week on the same days (today's counterpart cut at the same time), weekly target, 7 days with last week and a forecast for days to come, payments, employees, products, and "Not selling" (current week only). |
| **Monthly** (`/monthly?month&storeId`) | Every day of the month, totals with discounts and returns, comparisons on the same weekdays (last month, last year) while live and whole months when finished, last month's total, monthly target, expenses by category spread over the month (owner), payments, employees, products, stock health (current month only). |
| **Yearly** (`/yearly?year&storeId`, owner only) | Per month: sales, cost of goods sold, stock bought (stock receipts), rent, other expenses, invoices; the same months of last year. |

Cost, profit, expenses and stock values are `null` for non-owners (WAREHOUSE); Yearly answers 403 to them.
`GET /api/stores` lists the account's stores (today: one default store per account).

## Where the code is

| Part | Path |
|---|---|
| The one day function | `backend/src/business/day-totals.ts` (`computeDays`, `liveDay`, `dayHours`, `rollupDays`, `rangeTotals`) |
| Reports | `backend/src/business/{daily,weekly,monthly,yearly}.service.ts`, shared parts in `report-common.ts` |
| Routes, cache, rate limit | `backend/src/business/business.routes.ts`, `business-cache.ts` |
| Stores | `backend/src/business/business-stores.ts` |
| Targets and closed days | `backend/src/business/business-settings.service.ts` |
| Rollup freshness | `backend/src/business/rollup-jobs.ts` (after a void, nightly), `backend/scripts/rollup-backfill.ts` |
| Schema | `Store`, `SalesTarget`, `ClosedDay`, `DailySalesRollup`, `DailyProductRollup`, `DailyStaffRollup`, `Account.timezone`, `Expense.category` — migration `20261102120000_business_reports` |
| Frontend | `frontend/src/features/business/` (api, domain/mappers, components, pages, styles), page `frontend/src/pages/app/BusinessPage.jsx` |
| Tests | `backend/src/business/*.test.ts` (real Postgres), `frontend/src/features/business/business-ui.test.js` |
| Consistency check | `backend/scripts/check-business-consistency.ts` |
| Load test / plans | `backend/scripts/seed-load.ts`, `backend/scripts/bench-business.ts`, results in `docs/business-performance.md` |

## One definition of a day

A day is `[date 00:00, date+1 00:00)` in `Account.timezone` (default `Asia/Beirut`), computed by Postgres
with `AT TIME ZONE` (DST safe). It counts completed sales only (a voided sale disappears from the day it
was made), sales are net of the returns made that day (and so is cost), cost is quantity × the unit cost
saved on the sale line (`SaleItem.unitCostAtSale`), `costComplete` is false when a line has no cost.
Every report sums this same function, so a day has the same numbers in Daily, Weekly, Monthly and Yearly.
A day in `ClosedDay` is flagged `closed` everywhere and gets a forecast of 0.

## Rollups and the nightly job

Finished days are read from the rollup tables; today is always computed live from raw sales.

- `rollupDays()` recomputes days from raw sales and replaces their rollup rows in one transaction
  (idempotent, every day gets a row even with zeros, never today). A report that needs a finished day
  without a row rolls it up first.
- After a **void** commits, the sale service calls `afterVoid`: the day the sale was made is rolled up
  again in the background (a failure is logged, the void is never affected) and the account's cached
  reports are dropped.
- Returns are counted on the day they are made, which is today, so they need no recompute.
- **Nightly**, at 03:30 Asia/Beirut, the API process rolls up the last 3 finished days of every account
  with sales, voids or returns in that window: batches of 50 accounts, a per-account
  `pg_try_advisory_xact_lock` so two instances never do the same account at once, one retry for failed
  accounts, and a summary log line (`business_nightly_rollup_finished`).

## Backfill

```bash
# local database
node scripts/with-dev-db.mjs npx tsx scripts/rollup-backfill.ts
# the database in .env (production): only on purpose
npx tsx scripts/rollup-backfill.ts [--account <uuid>] [--from YYYY-MM] [--force]
```

It goes account by account and month by month, skips months that are already complete (resumable), and
`--force` recomputes them.

## How to add an expense, a target or a closed day

- **Expense:** the Expenses page as before. Existing and new expenses are `OTHER` unless the API is given
  a category (`RENT`, `SALARIES`, `ELECTRICITY`, `GENERATOR`, `OTHER`): `POST /api/expenses` with
  `"category": "RENT"`. The month is the month of `expenseDate`.
- **Target (owner):** `PUT /api/business/targets` with
  `{ "period": "WEEK", "periodStart": "2026-11-02", "amount": "17000.00" }` (a Monday for WEEK, the 1st
  for MONTH; `"amount": null` removes it; optional `"storeId"`).
- **Closed day (owner):** `POST /api/business/closed-days` with `{ "date": "2026-11-22", "reason": "Independence Day" }`;
  `GET /api/business/closed-days?from&to`; `DELETE /api/business/closed-days/2026-11-22`.

There are no screens for targets and closed days yet; the API is ready for them.

## Load protection

Per-account rate limit (60 requests a minute, 429 with `Retry-After`), an in-process cache of reports
(30 s for live periods, 10 min for finished ones, dropped for the account when its rollups, targets or
closed days change), `Cache-Control: private` and `ETag`/304, `statement_timeout` 5 s on report
queries, 10 s per report, and `business_report_slow` log lines (account id and endpoint only) above
500 ms. Database settings and measured numbers: `docs/business-performance.md`.

## Local database

`node scripts/dev-db.mjs start` runs a local PostgreSQL 17 (no Docker) in `backend/.dev-db/`;
`node scripts/with-dev-db.mjs <command>` runs a command against it and refuses non-local hosts. The
backend tests that need Postgres create and drop their own database on it and are skipped when it is off.
