# Inventory logic hardening — Phase 1 report

Date: 2026-09-29. Scope: Phase 1 only, the receipt-created RESTOCK database
contract. Phase 2 and later phases were not started.

## 1. Exact P0 root cause

The receipt transaction created `InventoryMovement` rows with type `RESTOCK`
but omitted `idempotencyKey` and `requestFingerprint`. Migration
`20260917110700_prepare_restock_cost_and_idempotency` requires both values on
every RESTOCK row and requires non-RESTOCK rows to leave them null. Its partial
unique index also requires RESTOCK keys to be unique within an Account. The
new stock-receipt migration did not change that contract. A real PostgreSQL
insert was therefore expected to fail its RESTOCK idempotency CHECK and roll
back the surrounding receipt transaction.

Legacy Restock's invariant is: one tenant-scoped UUID operation key and one
canonical SHA-256 request fingerprint are stored on its RESTOCK movement; an
identical replay returns the existing effect and changed semantics conflict.

## 2. Final ledger and idempotency design

Receipt-level replay remains authoritative. `StockReceipt.operationId` is the
client's stable UUID, `requestFingerprint` covers tenant, actor, operation kind,
product and normalized receiving details, and the existing advisory transaction
lock serializes the Account/operation pair.

Each receipt item now gives its linked RESTOCK movement:

- a deterministic RFC 4122 UUIDv5 child key, derived from the receipt operation
  UUID namespace plus Account and Variant identity;
- a SHA-256 movement fingerprint covering receipt scope, Account, actor,
  Product, Variant, quantity and canonical four-decimal purchase cost.

The same receipt operation and option always produce the same movement key.
Different options produce different keys. A changed quantity or cost keeps the
logical child key but changes its fingerprint. The receipt replay check occurs
before any stock or movement write, so same-key/same-payload replay creates no
second receipt, increment, movement or item. Same-key/different-payload remains
a receipt-level conflict. `StockReceiptItem.movementId` continues to link the
exact RESTOCK movement created for that item.

## 3. Why this design was chosen

It is the smallest solution that satisfies the already-migrated RESTOCK
constraint and unique index without weakening either. It follows the existing
Exchange pattern for deterministic internal child operation UUIDs, preserves
receipt-level replay, and requires no schema or migration change.

## 4. Alternatives considered

1. Relax or remove RESTOCK idempotency requirements: rejected because it would
   weaken ledger protection and violate the phase contract.
2. Allow null movement keys only when a receipt item points at the movement:
   rejected because the receipt item is inserted after its movement, creating a
   circular constraint/trigger design and a larger database change.
3. Use random per-movement UUIDs: it would pass the CHECK but would not encode a
   stable receipt-item child identity, so deterministic UUIDv5 is stronger.

## 5. Schema changes

None in Phase 1. `schema.prisma` was not changed by this phase.

## 6. Migration changes

None in Phase 1. Existing CHECK constraints, partial unique index, foreign keys,
and migrations remain unchanged. There is no new migration to roll back. An
application rollback would restore the incompatible null movement fields, so
the receiving feature must not be deployed without this application fix.

## 7. Receipt service changes

`receipt.schemas.ts` now derives the deterministic movement UUIDv5 and movement
fingerprint. `receipt.service.ts` writes both values on every receipt-created
RESTOCK movement before creating the linked receipt item. Account and actor
still come from the authenticated service arguments; no client tenant or actor
field was added.

## 8. Legacy Restock compatibility

Legacy Restock code, API, schema, movement fingerprinting and replay behavior
were not changed. Its complete transactional and route test suites remain
passing. Receipt movements use the same database columns and constraints while
keeping receipt replay as their parent operation boundary.

## 9. Tests added or strengthened

Receipt tests now cover:

- deterministic UUIDv5 and SHA-256 movement identity;
- one-item receiving and exact receipt total;
- multi-item receiving with one distinct linked RESTOCK per option;
- movement/item quantity, cost, Variant and movement-ID linkage;
- same-key/same-payload replay with no repeated stock or movement;
- same-key/different-payload and different-actor conflict;
- item failure rolling back receipt, stock, movement and item state;
- new-product plus receipt rollback;
- Save Product Only creating one replayable zero-stock definition without a
  receipt, movement or purchase cost;
- foreign-tenant rejection and WAREHOUSE cost omission.

Existing Restock tests cover legacy replay, concurrency simulation, tenant
isolation, rollback and authorization. These tests use transaction doubles and
do not enforce PostgreSQL CHECK constraints, partial indexes, triggers, foreign
keys or real locks.

## 10. Exact validation results

- Backend unit/service tests: **439 passed, 0 failed**, 77 suites.
- TypeScript production build: passed.
- Prisma Client generation 7.10.0: passed.
- Prisma schema validation: passed.
- `git diff --check`: passed; only existing LF/CRLF conversion warnings were
  printed.

## 11. Migration execution status

**NOT EXECUTED.** No migration command was run and no database was mutated.

## 12. PostgreSQL verification status

PostgreSQL behavior is still unverified. The tests prove application-level
payload construction, replay and rollback behavior in doubles. They do not
prove that the ordered migrations apply or that PostgreSQL enforces the CHECK,
partial unique index, foreign keys, triggers, advisory locks and concurrent
transactions as expected. That belongs to an explicitly approved Phase 2 on a
disposable or staging database.

## 13. Files changed in Phase 1

- `backend/src/receipts/receipt.schemas.ts`
- `backend/src/receipts/receipt.service.ts`
- `backend/src/receipts/receipt.test.ts`
- `docs/inventory-phase-1-p0-hardening-2026-09-29.md`

The receipt directory was already untracked as part of the earlier authorized
Inventory implementation, so Git cannot isolate these Phase 1 edits from that
untracked baseline.

## 14. Git diff stat

At review time, `git diff --stat` reported the pre-existing tracked working-tree
changes as:

```text
18 files changed, 549 insertions(+), 170 deletions(-)
```

Git's tracked diff stat excludes every untracked receipt, frontend and report
file, including all four Phase 1 files listed above. No file was staged merely
to manufacture a larger stat.

## 15. Git status

The working tree remains intentionally dirty from the earlier Inventory work.
Final `git status --short`:

```text
 M backend/package.json
 M backend/prisma/schema.prisma
 M backend/src/app.ts
 M backend/src/index.ts
 M backend/src/products/product.controller.ts
 M backend/src/products/product.routes.ts
 M backend/src/products/product.service.ts
 M backend/src/products/product.test.ts
 M backend/src/products/product.types.ts
 M frontend/package.json
 M frontend/src/features/inventory/InventoryAuditSections.jsx
 M frontend/src/features/products/ProductCreateForm.jsx
 M frontend/src/features/products/product-flow.js
 M frontend/src/features/products/stock-recovery.js
 M frontend/src/index.css
 M frontend/src/pages/app/InventoryPage.jsx
 M frontend/src/pages/app/ProductsPage.jsx
 M scripts/products-ui.test.mjs
?? backend/prisma/migrations/20260929190000_stock_receipts/
?? backend/src/receipts/
?? docs/inventory-logic-audit-2026-09-29.md
?? docs/inventory-page-audit-2026-09-29.md
?? docs/inventory-phase-1-p0-hardening-2026-09-29.md
?? docs/inventory-receiving-implementation-2026-09-29.md
?? docs/inventory-ui-review/
?? docs/inventory-ui-ux-audit-2026-09-29.md
?? docs/receiving-stage-1-2026-09-29.md
?? docs/ux-writing-audit-2026-09-29.md
?? frontend/src/app/operation-recovery.js
?? frontend/src/features/inventory/InventoryProductPicker.jsx
?? frontend/src/features/inventory/ReceiptHistory.jsx
?? frontend/src/features/inventory/ReceiptPresentation.jsx
?? frontend/src/features/inventory/StockReceiptForm.jsx
?? frontend/src/features/inventory/VariantQuantityMatrix.jsx
?? frontend/src/features/inventory/inventory-presentation.js
?? frontend/src/features/inventory/inventory-presentation.test.js
?? frontend/src/features/inventory/receiving.css
?? frontend/src/features/inventory/stock-receipt-flow.js
?? frontend/src/features/inventory/stock-receipt-flow.test.js
?? frontend/src/features/inventory/stock-receipt-recovery.js
?? frontend/src/features/products/ProductComponents.jsx
```

`git diff --cached --stat` was empty: nothing is staged. Nothing was reverted
or committed during this phase.

## 16. Confirmation

- No commit.
- No deploy.
- No migration execution.
- No production or staging database access.
- `planing/SaaS2_Clothes_Implementation_Summary.pdf` was not inspected, opened,
  modified, renamed, deleted, untracked, reverted, or recommitted.
- Phase 2 and all later phases were not started.
