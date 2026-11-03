# Owner Dashboard: running report

Branch `owner-dashboard`. Production is never touched: migrations, seeds and tests run on the local
embedded Postgres (`backend/scripts/dev-db.mjs`).

## Phase 1 — Audit

- Gap report: `docs/dashboard-gap-report.md`.
- Decisions:
  - **No Membership table**: `User` is already the account membership (one auth user = one account).
  - **Roles**: `UserRole` stays SUPER_ADMIN / OWNER / WAREHOUSE (DB triggers depend on it). Employees
    get `employeeRole` = MANAGER / CASHIER / WAREHOUSE as the preset; existing employees are WAREHOUSE
    and keep exactly the access they have today.
  - **Names**: `ProductVariant.lastPurchaseCost` is the current unit cost, `SaleItem.unitCostAtSale` the
    snapshot. Money stays `Decimal(18,2)` like the rest of the schema (the spec says 12,2; wider is safe).
  - **Mail**: Supabase Auth sends every mail (invite, reset). No SMTP / Resend is added.
