# Business reports merge — gap report

Phase 1 of the merge of `business-reference/saas2-business` (mock-backed Business reports: Daily, Weekly,
Monthly, Yearly) into this project. The contract is `business-reference/saas2-business/docs/API.md`; the
reference computation is `src/api/mock/mockBusiness.js` (`daySummary`).

What was read: the reference README, API.md, mockBusiness.js, domain/mappers.js and types.js,
server-example/business.routes.ts; our `backend/prisma/schema.prisma` and all 16 migrations, `src/app.ts`,
`src/index.ts`, `src/auth/*` (Supabase JWT → `req.auth = { userId, role, accountId, accountStatus }` via
`createRequireAuth` + `createRequireTenant` + `requireRole`), `src/errors/http-error.ts` and
`src/middleware/error-handler.ts` (errors are `{ "error": { "code", "message" } }`), sales / returns /
exchanges / expenses / receipts / reports services, and the frontend router (`src/App.jsx`, History API,
`app/routes.js`, `app/app-navigation.js`), API client (`src/lib/api-client.js`, Bearer token from the
Supabase session), tokens (`src/styles/tokens.css`) and i18n.

Our conventions that matter here: hand-written validation (no zod), `HttpError(status, code, message)`,
one `create…Dependencies(prisma)` + `create…Router(auth, deps)` per module, Prisma 7 with the generated
client in `src/generated/prisma`, money in `Decimal(18,2)` (cost `Decimal(18,4)`), immutable Sale/SaleItem
rows (database triggers), node:test unit tests with fake dependencies.

There is no local database in this repository and the only database configured in `.env` is the
production one. Phase 1 therefore added a local PostgreSQL 17 (`backend/scripts/dev-db.mjs`, embedded-postgres,
no Docker) and `backend/scripts/with-dev-db.mjs`, which overrides `DATABASE_URL` / `DIRECT_URL` and refuses
any non-local host. All 16 existing migrations apply cleanly to it (after creating Supabase's `anon`,
`authenticated`, `service_role` roles locally).

## A. Data the reports need

| Needed for | Reference expects | Our model.field (exact) | Status | Notes |
|---|---|---|---|---|
| Tenant on every row | `accountId` | `Sale.accountId`, `SaleItem.accountId`, `SaleReturn.accountId`, `SaleReturnItem.accountId`, `Expense.accountId`, `StockReceipt.accountId`, `ProductVariant.accountId` | OK | From `req.auth.accountId` (session), never from the client. |
| Account timezone | `timezone` default `Asia/Beirut` | — | MISSING | Add `Account.timezone String @default("Asia/Beirut")`. |
| USD→LBP rate | `exchangeRate` | `Account.lbpPerUsd Decimal(18,2)?` | DIFFERENT NAME | Returned as `exchangeRate`; `null` until the owner sets it. Sales keep `Sale.lbpRateAtSale`. |
| Report currency | `currency` | `Account.baseCurrency` | OK | |
| Store | `Store { id, name }` | — | MISSING | One shop per Account today. Add `Store` (one default store per account, created for existing accounts in the migration and lazily for new ones). |
| User + role | `OWNER / MANAGER / CASHIER` | `User.role: SUPER_ADMIN / OWNER / WAREHOUSE` | DIFFERENT NAME | OWNER = owner; WAREHOUSE plays the cashier/non-owner role (gets `null` cost/profit, 403 on Yearly). No MANAGER. |
| Staff ↔ store | staff store list | — | MISSING | Single store: every staff member belongs to the default store. `storeNames` = `[default store name]`. |
| Sale: account | `accountId` | `Sale.accountId` | OK | |
| Sale: store | `storeId` | — | MISSING | Not added to Sale (immutable rows, one store per account). Every sale is in the default store. |
| Sale: who sold | `userId` | `Sale.soldById` (+ `sellerNameAtSale`) | DIFFERENT NAME | |
| Sale: time | `createdAt` | `Sale.createdAt Timestamptz(3)` | OK | |
| Sale: voided | voided marker | `Sale.status = VOIDED`, `Sale.voidedAt` | OK | A void removes the sale from its creation day (retroactive), like the mock. |
| Sale: payment method | `CASH`, `WHISH` | `Sale.paymentMethod: CASH / CARD / WHISH_OMT / DEBT` | DIFFERENT NAME | `WHISH_OMT` is reported as `WHISH`. CARD and DEBT stay in sales totals but are not in `paymentSplit` (contract: CASH and WHISH only). |
| Sale: total | `total` | `Sale.totalAmount Decimal(18,2)` | OK | Final amount after discount. |
| Sale: discount total | `discountTotal` | `Sale.discountAmount Decimal(18,2)` | DIFFERENT NAME | |
| Sale: receipt number | `number` | `Sale.receiptNumber Int?` | DIFFERENT NAME | `null` for sales before numbering. Unique `(accountId, receiptNumber)`. |
| Line: variant | `variantId` | `SaleItem.variantId` | OK | |
| Line: quantity | `quantity` | `SaleItem.quantity` | OK | |
| Line: unit sold price | `unitSoldPrice` | `SaleItem.unitSoldPrice Decimal(18,2)`, `SaleItem.lineTotal` | OK | |
| Line: unit cost at sale | snapshot | `SaleItem.unitCostAtSale Decimal(18,4)?` | OK | Already set inside the create-sale transaction from `ProductVariant.lastPurchaseCost`. Null when the variant had no cost → `costComplete: false`. |
| Product name, category | `name`, `category` | `Product.name`, `Category.name` (snapshots `productNameAtSale`, `categoryNameAtSale`) | OK | Reports group by product id with the current name. |
| Variant colour, size | `color`, `size` | `ProductVariant.color`, `.size` (snapshots `colorAtSale`, `sizeAtSale`) | OK | Label "Black · Size 56" / "One size". |
| Stock per store | per store | `ProductVariant.currentStock` (per account) | DIFFERENT (granularity) | One store, so account stock = store stock. |
| Current unit cost | `unitCost` | `ProductVariant.lastPurchaseCost Decimal(18,4)?` | DIFFERENT NAME | Used for stock value and dead-stock money. |
| Returns: date, amount, count | return rows | `SaleReturn.createdAt`, `SaleReturnItem.refundAmount`, count of `SaleReturn` | OK | Attributed to the day the return is made. |
| Returns: linked sale/line | `saleId`, `saleItemId` | `SaleReturnItem.saleId`, `.saleItemId` | OK | |
| Returns: cost of returned goods | qty × line cost | `SaleReturnItem.quantity × SaleItem.unitCostAtSale` | OK | |
| Exchanges | (not in reference) | `Exchange` = one `SaleReturn` + one new `Sale` | OK | Counted as a return plus a sale, no special case. |
| Expenses per month | `RENT / SALARIES / ELECTRICITY / GENERATOR / OTHER` | `Expense { amount, currency, expenseDate, description }` | MISSING (category) | Add `Expense.category ExpenseCategory @default(OTHER)`. Month = month of `expenseDate`. Account-level (no store). |
| Stock purchases per month | `purchasesTotal` | `StockReceiptItem.quantity × unitCost`, `StockReceipt.createdAt` | OK | |
| Sales targets | weekly and monthly per store | — | MISSING | Add `SalesTarget`. |
| Closed days / holidays | per account or store | — | MISSING | Add `ClosedDay`. |
| Daily rollups | precomputed days | `DailyReport` (UTC day, one row per account) | DIFFERENT | `DailyReport` is the existing UTC finance report and stays as is. Add the three rollup tables keyed by shop-local date. |

## B. Rules in API.md and whether our data supports them

| Rule | Supported | How |
|---|---|---|
| Tenant from the session, every query filtered | Yes | `createRequireAuth` + `createRequireTenant`; every SQL has `accountId = $session`. |
| Roles: cost/profit OWNER only; others `null` | Yes | `req.auth.role`; WAREHOUSE gets `null`. Enforced in the service, not the UI. |
| Business day `[date 00:00, date+1 00:00)` in the account timezone | Yes (after adding `Account.timezone`) | `(date::timestamp) AT TIME ZONE tz` in Postgres; DST safe (checked on the local server: 29 Mar 2026 in Beirut is 23 hours). |
| Money as 2-decimal strings | Yes | `Decimal(18,2)` sums → `toFixed(2)`. |
| Errors `{ error: { code, message, details } }` | Yes | Our error handler; `details` omitted (not used by the UI). |
| Store filter, foreign store → 403 | Yes (after `Store`) | `storeId` must be the account's store, else 403 `STORE_FORBIDDEN`. |
| One definition of a day | Yes | One SQL module (`business/day-totals.ts`); every report reads it (rollups for finished days, live SQL for today). |
| Completed only, voided excluded | Yes | `Sale.status = 'COMPLETED'`. |
| Sales net of returns made that day | Yes | Returns in the day window are subtracted (amount and cost). |
| Cost = qty × unit cost at sale | Yes | `SaleItem.unitCostAtSale`; `costComplete=false` when any line in the day has no cost. |
| Closed days $0 everywhere, flagged | Partly | No closed days exist yet. A day in `ClosedDay` is flagged `closed: true` in every report and gets forecast 0. If sales were recorded on a day marked closed they are still counted (we never hide real sales); the flag and the numbers come from the same day function, so reports still agree. |
| One rounding rule (whole percent, half up) | Yes | Percentages are computed in the UI (`pct()`); the API returns money only. |
| Products grouped with variants | Yes | Group by `productId`, variants by `variantId`. |
| Live periods (`live`, `asOf`, "by this time") | Yes | `asOf` from Postgres `now()` in the account timezone; earlier days cut at the same minute. |
| Same-weekday comparisons (4 or 5 weeks back, 52 weeks for last year) | Yes | Date arithmetic on shop-local dates. |
| Forecast = average of last 4 finished same weekdays | Yes | From the day function. |
| Expenses spread evenly over the month | Yes | Month total × (days so far / days in month) for the current month. |
| Inventory only for the current period | Yes | `ProductVariant.currentStock` now. |
| Invoices: cursor on (createdAt, id), never cost | Yes | Keyset pagination. |
| Yearly OWNER only | Yes | 403 for others. |

## C. Indexes on the sales tables

Existing (from `schema.prisma`):

- `Sale`: `(accountId, createdAt)`, `(accountId, status, createdAt)`, `(accountId, paymentMethod, createdAt)`, `(accountId, soldById, createdAt)`, `(accountId, voidedAt)`, unique `(accountId, receiptNumber)`, unique `(accountId, idempotencyKey)`.
- `SaleItem`: `(saleId, accountId)`, `(accountId, variantId, createdAt)`, `(accountId, productId, createdAt)`, `(accountId, categoryId, createdAt)`, `(variantId, productId, accountId)`.
- `SaleReturn`: `(accountId, createdAt)`, `(accountId, saleId, createdAt)`. `SaleReturnItem`: `(accountId, returnId, createdAt)`, `(saleItemId, saleId, variantId, accountId)`.
- `StockReceipt`: `(accountId, createdAt, id)`. `Expense`: `(accountId, expenseDate)`.

"Sales of account X between two timestamps" is served by `Sale (accountId, status, createdAt)` and
`(accountId, createdAt)`; lines by `SaleItem (saleId, accountId)`. `Sale (accountId, storeId, createdAt)`
is not possible without `Sale.storeId` and not needed while each account has one store. The invoice list
(newest first, keyset on `(createdAt, id)`) needs `Sale (accountId, createdAt DESC, id DESC)` — added.
Search by receipt number uses the existing unique `(accountId, receiptNumber)`.

## D. Risks

1. **No multi-store data.** The reference assumes several stores per account. We have one shop per
   Account, no `Sale.storeId` and stock per account. The `Store` table and `storeId` everywhere keep the
   API shape, but every account has exactly one store until a real multi-store feature exists. Adding
   `Sale.storeId` later needs the Sale immutability trigger to allow setting it once.
2. **Two definitions of "day".** The existing `/api/reports` (Reports page and Home) use the UTC day
   (documented in ARCHITECTURE.md). The Business reports use the shop's local day as the contract
   requires. A sale between 00:00 and 02:00/03:00 Beirut time is on different days in the two areas until
   the old reports are moved to the shop day.
3. **Payment methods.** The reference only knows CASH and WHISH; we also have CARD and DEBT. Sales totals
   include them; the drawer split does not. A debt sale counts as a sale on the day it is made.
4. **Cost snapshots.** Already stored; the 3 production sale lines all have a cost. A sale of a variant
   without `lastPurchaseCost` has no cost and marks its day `costComplete: false`. Old rows cannot be
   back-filled: Sale and SaleItem are immutable by trigger (a deliberate architecture rule).
5. **Expense categories.** Existing expenses become `OTHER`; until the owner categorises new ones, rent and
   salaries show as "Other".
6. **Rollups going stale.** A void changes a past day; a late return on an old sale is counted on the
   return day (today), so only voids rewrite the past. Rollups are recomputed after each void, nightly for
   the last 3 days, and can be rebuilt with the backfill script.
7. **No local database in the repo.** Phase 1 added an embedded local Postgres; migrations, seeds and load
   tests run there only. Nothing runs against production.
8. **No Redis, no read replica, no cron.** Caching is in-process; the nightly job runs inside the API
   process with an advisory lock.

## E. Plan (smallest safe changes first)

1. Additive migration only: `Account.timezone`, `Expense.category`, `Store`, `SalesTarget`, `ClosedDay`,
   the three rollup tables, one Sale index; default store for every existing account. No drop, no rename,
   no change to Sale/SaleItem columns or triggers.
2. `business/day-totals.ts`: the one day function (live SQL) + rollup writer + range reader.
3. Endpoints `/api/stores` and `/api/business/*` on top of it only; plus owner endpoints for targets and
   closed days; optional `category` on expense create.
4. Rollup freshness: recompute after a void (after commit, never failing the void), nightly job, backfill.
5. Load hardening: indexes checked with EXPLAIN on a seeded local database, caching, rate limit, timeouts.
6. Frontend: port the UI to `frontend/src/features/business`, route `/app/business`, owner nav item.
7. Consistency script, role matrix, tenant isolation tests, docs.

## Phase 2 — what changed

Migration `backend/prisma/migrations/20261102120000_business_reports/migration.sql` (one transaction,
additive only — checked: no `DROP`, no `RENAME`, no type change, Sale/SaleItem and their triggers untouched):

- `Account.timezone TEXT NOT NULL DEFAULT 'Asia/Beirut'` with a CHECK that Postgres knows the zone.
- `Expense.category "ExpenseCategory" NOT NULL DEFAULT 'OTHER'` (RENT, SALARIES, ELECTRICITY, GENERATOR, OTHER).
- `Store` (+ partial unique index: one `isDefault` store per account). The migration inserts the default
  store of every existing Account (named after the Account).
- `SalesTarget` (WEEK/MONTH, `periodStart` must be a Monday / the 1st; unique per account+store+period+start
  with `NULLS NOT DISTINCT`).
- `ClosedDay` (unique per account+store+date, `NULLS NOT DISTINCT`).
- `DailySalesRollup`, `DailyProductRollup`, `DailyStaffRollup` (primary keys `(accountId, storeId, date[, variantId|userId])`,
  plus `(accountId, date)` indexes and non-negative CHECKs).
- `Sale (accountId, createdAt DESC, id DESC)` for the invoice list.
- RLS enabled and privileges revoked from `anon` / `authenticated` on the new tables, like every other table.
- The two `NULLS NOT DISTINCT` indexes and the partial index are raw SQL (Prisma cannot express them), so
  `prisma migrate diff` lists them as drift; that is expected.

Applied to the local dev database only (`node scripts/with-dev-db.mjs npx prisma migrate deploy`).
`prisma migrate dev` cannot be used in this repository: its shadow database replays
`20260924210000_harden_supabase_database_boundary`, which revokes on `_prisma_migrations` before that
table exists in the shadow. The migration was generated with
`prisma migrate diff --from-config-datasource --to-schema` against the up-to-date local database.

**Cost snapshot backfill — not needed.** `SaleItem.unitCostAtSale` already exists and is set inside the
create-sale transaction. Old rows cannot be updated anyway (SaleItem is immutable by trigger); a day with
a line without cost is reported with `costComplete: false`. No `costEstimated` column and no backfill
script were added (see the merge report).
