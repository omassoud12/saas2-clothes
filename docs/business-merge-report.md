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
