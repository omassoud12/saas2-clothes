# Products and Inventory receiving

## Implemented contracts

Inventory owns new product creation and purchased-stock receiving. Products
keeps catalog/details/editing and links to Inventory with `productId`; its Add
product shortcut opens Inventory creation. The definition form remains reused.
Its new path starts every option at zero. Save product only creates no receipt,
no movement and no purchase cost. Save & receive creates the definition and
receipt in one database transaction. Warehouse can save definitions only.

A receipt covers one product, one common positive Decimal(18,4) purchase cost,
and 1–200 unique options. A quantity is a positive whole number, at most
1,000,000 per option; blank/zero matrix cells add nothing. Inactive products and
options reject receiving. Each receipt item links to exactly one RESTOCK ledger
movement. Stock increments and the latest purchase cost update atomically.
Historical sale snapshots, returns, revenue and existing opening stock are not
rewritten. Receipt history is paginated, backend-authoritative, and hides costs
from Warehouse.

Existing Products +/- controls are count corrections, explained in the UI.
Their new `stock-adjustment` endpoint always records ADJUSTMENT, including when
cost is known. The legacy quick-stock endpoint retains its previous semantics
for older clients. Legacy pending operation IDs remain recoverable. Corrections
remain limited to one piece and use the existing ledger note; a free-text reason
and arbitrary-delta adjustment editor are not added by this contract.

## Database and API

New StockReceipt and StockReceiptItem models use composite tenant/product/variant
foreign keys. Product gains nullable creation-operation/fingerprint fields for
save-only idempotency. Existing rows need no receipt backfill.

- POST `/api/inventory/product-setups`: product, variants, optional receipt.
- POST `/api/inventory/receipts`: productId, shared unitCost, items.
- GET `/api/inventory/receipts?page=1`: 20 receipts per page, bounded page input.
- GET `/api/inventory/receipts/by-operation/:key`: owner recovery lookup.
- POST `/api/products/:productId/variants/:variantId/stock-adjustment`: +/-1.

The receiving POSTs require a UUID Idempotency-Key. Account comes from the
authenticated tenant context. Fingerprints include tenant, actor and normalized
payload. Advisory transaction locks serialize each account/operation key;
product and sorted option row locks protect increments and inactive-state checks.
Same-key/same-payload retries return the original receipt; different payloads
conflict. Receipt response quantities are receipt quantities, not a claim about
current stock after later transactions. Clients refresh stock separately.

## Frontend and recovery

ProductComponents holds identity/option forms, image and catalog presentation.
Inventory adds StockReceiptForm, VariantQuantityMatrix and ReceiptHistory;
flow/recovery modules keep HTTP and immutable recovery records outside pages.
Shared operation storage preserves the established quick-stock keys.

Before sending, a receiving request and UUID are stored under account/user scope.
Web Locks coordinate tabs. Uncertain transport/5xx, authorization and key-conflict
outcomes preserve the original request; users explicitly retry it. Confirmed
validation/domain rejection releases the operation for correction. Storage or
Web Locks failure blocks receiving instead of sending an unprotected request.
The matrix review shows quantity and exact total before the protected POST.

Photo upload follows database success. Upload failure keeps the saved product
and receipt and offers photo-only retry. Reload cannot recover the browser File;
the user can attach it again through Products without repeating receiving.

## Release boundary and limits

The additive migration is prepared, not applied. No database reset, historical
backfill, authenticated live mutation, commit or deployment was performed. The
protected PDF was not accessed.

Deploy order: back up and review the migration; apply it on an explicitly
approved disposable/staging database; verify PostgreSQL concurrent same-key,
different-key and stock-limit races plus rollback and tenant FKs; then apply
the additive migration before deploying the new backend and frontend. Older
clients remain supported. Reverting application code leaves additive data intact.
Do not drop receipt tables to roll back an application release.

PostgreSQL execution/concurrency and production latency remain unverified here.
Service tests use transactional doubles; browser tests intercept APIs. Prisma
schema validation and generated-client compilation verify model wiring, not
execution of migration SQL. Prisma migrate diff returned no SQL in this local
environment; the new additive DDL was authored and reviewed against the schema.
Do not describe it as database-tested. The 200-option service performs bounded
per-option ledger writes; measure transaction latency before claiming a speed
guarantee. Existing image-object orphan cleanup remains a separate follow-up.

All stages are implemented locally; staging/deployment remain separate tasks,
as required by the supplied production prompt. No supplier, FIFO, multi-warehouse,
new movement enum or automatic historical cost backfill was introduced.

## Files and validation

Backend: Prisma schema and new migration; `src/receipts` schema/service/router/tests;
app/index wiring; Products controller/router/service/types and correction test;
package test list. Frontend: InventoryPage and ProductsPage; ProductCreateForm,
ProductComponents, product-flow and stock-recovery; shared operation-recovery;
receiving form/matrix/history/CSS/flow/recovery/tests; package test list.
Stage-one InventoryAuditSections and browser regression changes remain included.
Reports: this document, stage-one report and original Inventory audit.

- Frontend unit checks: 247 passed; ESLint passed; Vite production build passed.
- Backend unit/service checks: 437 passed; generated-client/TypeScript production
  build passed; Prisma schema validation passed.
- Browser checks: full 59-test suite passed after moving creation to Inventory
  and correcting fixture routing; one additional image-failure/photo-only retry
  test passed separately (60 covered browser cases in total).
- `git diff --check` passed. No PostgreSQL migration execution or live load test.

The six stage-one regression probes were demonstrated failing before their
fixes and passing afterward. New receiving tests cover exact cost, rejection,
duplicate combinations, frozen storage, replay conflict, tenant scoping, rollback,
Warehouse cost omission and save-only/new-receipt creation rollback. These are
not PostgreSQL concurrency proofs. Existing sale-before-cost and historical-cost
tests remained passing; no financial snapshot behavior was changed.

Assumptions: one product per batch; shared cost for received options; Owner-only
receiving/corrections; Warehouse zero-stock definitions; retain legacy Restock
and deferred opening-cost tools for old stock. Normal purchase receiving uses
the new batch form, not legacy Restock or count-correction controls.
