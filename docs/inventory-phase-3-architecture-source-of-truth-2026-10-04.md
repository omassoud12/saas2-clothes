# Inventory hardening — Phase 3 architecture source of truth

Date: 2026-10-04. This report covers only Phase 3 from the Inventory logic
hardening plan. Phase 4 has not started.

## Audit result

`ARCHITECTURE.md` still described the superseded Products-owned setup in which
OWNER creation sent `openingStock: true` and created one unknown-cost opening
piece per option. The current application instead makes Inventory the canonical
definition and receiving workspace:

- Products sends Add product to `/app/inventory?new=1`.
- Products sends Receive stock to `/app/inventory?productId=...`.
- Inventory submits new definitions to
  `POST /api/inventory/product-setups`.
- Inventory submits existing-product deliveries to
  `POST /api/inventory/receipts`.
- Save Product Only creates zero-stock, null-cost options with no receipt or
  movement.
- Products + / - sends one-piece physical corrections through
  `stock-adjustment`, which records ADJUSTMENT.

The older setup, quick-stock and single-option Restock paths still exist. They
are compatibility/secondary paths and were documented instead of removed.

## Architecture changes

`ARCHITECTURE.md` now defines:

1. **Canonical product creation:** Inventory owns new Product and color/size
   definition through idempotent `/api/inventory/product-setups`.
2. **Canonical receiving:** OWNER batch receiving uses one Product, one shared
   Decimal(18,4) cost and 1–200 options through Inventory receipts.
3. **Zero-stock definitions:** Save Product Only creates options at stock zero
   and null cost, with no StockReceipt, StockReceiptItem or InventoryMovement.
4. **OWNER behavior:** may define Products, save only, Save & Receive, receive
   existing Products, use legacy single-option Restock, and correct counts.
5. **WAREHOUSE behavior:** may define and save zero-stock Products, but cannot
   submit receipts, correct counts or receive purchase-cost fields.
6. **Legacy `/api/products/setup`:** retained for older clients, non-canonical
   and non-idempotent.
7. **Opening-piece compatibility:** explicit OWNER `openingStock: true` still
   creates one null-cost piece and an ADJUSTMENT in legacy setup/option creation;
   current Inventory and Products UI do not request it.
8. **Legacy Restock:** the single-option endpoint and UI remain compatible as
   the secondary “Legacy Restock” tool; batch Receive stock is primary.
9. **Stock movements:** batch receipt items link one RESTOCK movement each;
   current Products corrections always write ADJUSTMENT; legacy quick-stock
   preserves its previous conditional semantics.
10. **Purchase cost:** receiving updates the current/latest option cost only;
    unknown cost never becomes zero.
11. **Historical Sale snapshots:** receiving/opening-cost changes never rewrite
    `SaleItem.unitCostAtSale`, including historical null snapshots.
12. **Page responsibilities:** Inventory owns definition/receiving/history/check;
    Products owns catalog/details/editing/pricing/status/images/count correction
    and deep-links receiving back to Inventory.

The multi-tenant entity examples now include StockReceipt and StockReceiptItem,
and role descriptions use the same receiving/count-correction language.

## Source consistency review

The updated architecture was checked against:

- receipt routes, schemas and transactional service;
- Product routes, setup compatibility path, option creation, opening cost,
  stock-adjustment and legacy quick-stock;
- legacy Restock service and idempotency behavior;
- Product, ProductVariant, InventoryMovement, StockReceipt and StockReceiptItem
  Prisma models;
- InventoryPage, StockReceiptForm and InventoryProductPicker;
- ProductsPage navigation and adjustment request flow;
- Phase 1 movement identity and Phase 2 real PostgreSQL validation results.

The documented role gates, endpoints, zero-stock semantics, atomic receipt
effects, movement types, Decimal precision, deep links and compatibility paths
match the reviewed source. Obsolete phrases claiming that the initial Product
form requests opening pieces, that RESTOCK is only a future backend behavior,
or that the current Products controls call quick-stock were removed.

## Validation

- `git diff --check -- ARCHITECTURE.md`: passed; existing line-ending warning
  only.
- Targeted source-to-document searches for endpoints, role guards, receipt
  models, openingStock callers and frontend navigation: passed.
- No runtime tests were rerun because this phase changes documentation only and
  does not change executable code, schema or migrations.

## Files changed in Phase 3

- `ARCHITECTURE.md`
- `docs/inventory-phase-3-architecture-source-of-truth-2026-10-04.md`

## Remaining boundaries

- Compatibility endpoints remain callable; Phase 3 does not deprecate or remove
  them in code.
- Receipt recovery classification remains the Phase 4 scope and was not changed.
- Receipt historical identity, immutability, cursor pagination, filter sources,
  payload measurements and legacy retirement policy remain later phases.

## Confirmation

- No application code or business behavior changed.
- No Prisma schema or migration changed or executed.
- No database or production data was accessed.
- No commit and no deployment were performed.
- `planing/SaaS2_Clothes_Implementation_Summary.pdf` was not opened or changed.
- Phase 4 was not started.
