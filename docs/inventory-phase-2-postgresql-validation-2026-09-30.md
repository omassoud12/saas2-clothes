# Inventory hardening — Phase 2 real PostgreSQL validation

Date: 2026-09-30. This report covers only Phase 2 from the Inventory logic
hardening plan. Phase 3 has not started.

## Result

The receipt path now passes the required migration, database-contract,
rollback, concurrency and bounded performance checks on a disposable local
PostgreSQL 18.4 database. The test run found two real PostgreSQL/Prisma issues
that the transaction doubles did not expose. Both were corrected and covered
by regression checks:

1. `pg_advisory_xact_lock` returned PostgreSQL `void`, which the Prisma adapter
   could not deserialize. The lock query now calls the same transaction-scoped
   advisory lock as a table function and returns a supported text projection.
2. Prisma's 15-second interactive-transaction timeout did not cancel a query
   already waiting on a PostgreSQL lock. Each receiving transaction now sets a
   transaction-local 14-second `lock_timeout`, so lock contention fails before
   the Prisma transaction budget and all writes roll back.

The Phase 1 movement design also passed the real database constraint: every
receipt item creates one linked RESTOCK movement with a deterministic UUIDv5
idempotency key and SHA-256 request fingerprint. Legacy Restock retains its
existing operation key/fingerprint behavior.

## Approved disposable target and safety controls

- Target: `saas2_phase2` on a new local PostgreSQL 18.4 cluster bound only to
  `127.0.0.1:55432`.
- Data directory: a Phase 2-specific directory under the current user's Temp
  folder.
- Authentication: local test cluster with trust authentication; it was never
  reachable beyond loopback.
- The test harness rejects every non-loopback `PHASE2_DATABASE_URL` before
  connecting.
- The bootstrap script names only the local port and disposable
  `saas2_phase2` database.
- No value from `backend/.env` was used. No managed, staging or production
  database was contacted.
- The cluster was stopped after validation. Its data directory, extracted
  binaries, downloaded archive and abandoned setup artifacts were removed.
- The official Microsoft Visual C++ 2015–2022 x64 runtime was installed because
  the PostgreSQL binary distribution required it. This shared system runtime
  was left installed.

The PostgreSQL archive's computed SHA-512 integrity matched the integrity
published for `@embedded-postgres/windows-x64@18.4.0-beta.17` before extraction.

## Migration execution

The ordered migration chain was applied to the disposable database. The first
attempt correctly stopped at the Supabase boundary migration because a plain
PostgreSQL installation did not contain the expected `anon` and
`authenticated` roles. The disposable database was recreated, those two
NOLOGIN compatibility roles were created locally, and the full ordered chain
then applied cleanly.

- Migration records: 15
- Successfully applied: 15
- Rolled back migration records: 0
- Receipt migration: `20260929190000_stock_receipts` applied
- Existing RESTOCK constraint migration:
  `20260917110700_prepare_restock_cost_and_idempotency` applied first

This was migration execution on the disposable local database only. No
migration was run against a shared or deployed environment.

## Real database checks

All 23 harness checks passed:

1. One-item receipt, stock increment and linked RESTOCK contract.
2. Multi-item receipt, exact four-decimal cost and one movement per item.
3. Same key/same payload returns the original result; changed payload conflicts.
4. Forced receipt-item insert failure rolls back receipt, movement, stock and
   latest purchase cost.
5. Forced new-product receipt failure also rolls back the product and options.
6. Save Product Only replays one zero-stock definition and creates no receipt or
   movement.
7. Tenant/product/option composite foreign keys reject cross-tenant links.
8. Inactive Product and inactive option reject receiving.
9. Integer stock upper bounds reject overflow.
10. Purchase cost and receipt totals retain Decimal(18,4) precision.
11. Legacy single-option Restock still writes once and replays safely.
12. Two concurrent submissions of the same receipt operation have one business
    effect.
13. Different concurrent receipts on the same option keep both increments.
14. A blocked receipt for one product does not globally serialize another
    product's receipt.
15. Receipt versus Sale on the same option preserves stock and ledger totals.
16. Receipt versus count correction preserves both RESTOCK and ADJUSTMENT.
17. Receipt versus Product deactivation resolves to a consistent serialized
    result.
18. Receipt versus option deactivation resolves to a consistent serialized
    result.
19. Concurrent same-key/different-payload requests produce one effect and one
    idempotency conflict.
20. A 24-option receipt completes and links all rows.
21. A 100-option receipt completes and links all rows.
22. A 200-option receipt completes and links all rows.
23. A receipt waiting on a Product row lock fails around 14 seconds and leaves
    no receipt, item or movement.

Database deadlocks remained `0` before and after the concurrency suite. No lost
updates, duplicate receipts, duplicate receipt items or duplicate movements
were observed.

## Performance probe

Measured receiving-call duration on the disposable local database:

| Options | Receiving call | Full check including assertions |
| ---: | ---: | ---: |
| 24 | 103.206 ms | 127.5 ms |
| 100 | 462.216 ms | 524.7 ms |
| 200 | 790.898 ms | 870.5 ms |

The forced row-lock wait failed and rolled back in 14,040.3 ms. This confirms
that the current 15-second application transaction budget is enforceable for
the tested lock-wait case. Ordinary 200-option receiving stayed under one
second on this local machine.

The exact SQL statement count was not recorded because `pg_stat_statements` was
not configured. Static inspection still shows three per-option write calls
(option update, movement insert and receipt-item insert), in addition to locks,
receipt creation and final reads. Performance numbers are a local bounded probe,
not a production latency guarantee.

## Application validation after the fixes

- Backend tests: 440 passed, 77 suites, 0 failed.
- TypeScript/Prisma production build: passed.
- Prisma schema validation: passed.
- Standalone Phase 2 harness TypeScript check: passed.
- `git diff --check`: passed; existing line-ending warnings only.

The real database suite used Prisma with the PostgreSQL adapter against the
actual migrated database. It did not use a transaction double or intercepted
HTTP response.

## Files changed in Phase 2

- `backend/src/receipts/receipt.service.ts`
  - returns a Prisma-supported value from the advisory-lock query;
  - applies a transaction-local lock timeout before acquiring locks.
- `backend/src/receipts/receipt.test.ts`
  - verifies the lock timeout and non-void advisory-lock query;
  - updates the test fixture for the new setup query.
- `backend/scripts/inventory-phase2-bootstrap.cjs`
  - recreates only the named loopback disposable database and required local
    compatibility roles.
- `backend/scripts/inventory-phase2-postgres.ts`
  - real migration/database/concurrency/performance validation harness with a
    non-loopback refusal guard.
- `docs/inventory-phase-2-postgresql-validation-2026-09-30.md`
  - this report.

Phase 1's receipt identity changes remain part of the same uncommitted working
tree and are documented separately in
`docs/inventory-phase-1-p0-hardening-2026-09-29.md`.

## Remaining limits and observations

- This proves behavior on one disposable PostgreSQL 18.4 instance, not the
  latency or capacity of Railway/Supabase production infrastructure.
- The test database was rebuilt rather than backed up because it contained no
  business data and was created solely for this phase. Rollback was disposal of
  the entire local cluster; that cleanup is complete.
- The `pg` client emitted one deprecation warning during a concurrency run about
  querying an already-busy client. All checks completed correctly. A later
  trace attempt was blocked by a Windows/Node `uv_os_get_passwd` ENOMEM
  environment error after the successful suite. No unsafe application workaround
  was introduced; this remains a tooling diagnostic observation.
- A deployment should still apply migrations before the backend/frontend and
  monitor lock-timeout frequency and receipt duration.

## Change boundary

- No production, staging or other remote database was accessed.
- No production data was reset, copied or changed.
- No commit and no deployment were performed.
- `planing/SaaS2_Clothes_Implementation_Summary.pdf` was not opened or changed.
- Phase 3 was not started.
