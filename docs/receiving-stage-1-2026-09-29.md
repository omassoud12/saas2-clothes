# Receiving implementation — Stage 1: existing behavior stabilization

Date: 2026-09-29. Implements only the first stage of the agreed gated plan.
No receiving schema, API, create-product relocation or visual redesign yet.

## Changes and review decisions

1. **Overlapping price draft:** submitting bulk prices for an option with an open
   editor now asks the user to save or cancel that editor first. It preserves both
   drafts and sends no price request. This deliberately blocks overlap rather than
   silently rewriting an intentional unsaved individual price.
2. **Other-tab stock settlement:** removal of a scoped per-operation storage key
   invalidates the detail request epoch and reloads authoritative product data.
   Pending metadata is still synchronized; product drafts remain in local state.
   UUIDs, storage formats, Web Locks and stock endpoints are unchanged.
3. **Unavailable attached image:** removal/replacement actions use attachment
   status as well as the signed URL. An unavailable URL no longer hides removal.
4. **Image detach/storage failure:** on PRODUCT_IMAGE_DELETE_FAILED, the page reads
   the product while holding its existing mutation guard. If the attachment is
   confirmed absent, the confirmation closes and a message explicitly distinguishes
   successful detach from failed storage cleanup. No deletion retry is issued.
   If read-back fails or a replacement attachment exists, it does not claim removal.
5. **Inventory audit filters:** history/reconciliation retain stable component
   identity. Stock refresh requests their data through refreshVersion, preserving
   selected/applied filters instead of remounting the sections.
6. **Current-cost drafts:** Set cost uses the existing shared dirty-state system.
   Stock refresh/search/pagination cannot silently discard meaningful cost input.
   Cancel asks about that form's own cost, then clears its draft/error; a successful
   save clears its dirty marker before invoking the parent refresh.

No backend response contract changed. No CSS, endpoint, role, stock mutation,
accounting rule, historical snapshot or opening-stock behavior changed.

## Regression evidence

Added six offline browser tests named `receiving stage 1` in the existing harness.
Before application fixes: **0 passed, 6 failed**, reproducing the missing overlap
warning, stale external quantity, missing photo action, stale deletion result,
reset audit filters and silent loss of cost input. After fixes: **6 passed**.

The fixture now supplies empty inventory history/reconciliation responses and a
database-detach-before-storage-failure image scenario. No live R2 or account data
was used. The external-tab test commits through the same fixture backend and checks
quantity 4 -> 5 in the original tab while its unsaved name remains unchanged.

## Validation

- Frontend unit/contract tests: **240 passed, 42 suites, 0 failures**.
- Entire existing-plus-new offline browser harness: **57 passed, 0 failures**.
- Frontend ESLint: passed after moving the detail request ref before the effect
  that now uses it; rules were not weakened.
- Frontend Vite production build: passed, 116 transformed modules.
- `git diff --check`: passed; diff reviewed for scope and request/body preservation.
- Backend tests/Prisma checks: not run because no backend or schema file changed.
- No new dependency, database operation, migration, live mutation, commit or deploy.

## Files changed

- `frontend/src/pages/app/ProductsPage.jsx`
- `frontend/src/pages/app/InventoryPage.jsx`
- `frontend/src/features/inventory/InventoryAuditSections.jsx`
- `scripts/products-ui.test.mjs`
- This report.

Pre-existing untracked `docs/inventory-page-audit-2026-09-29.md` was preserved.
No protected PDF access occurred. Generated frontend build output remains ignored.

## Remaining limits and follow-ups

- **Object storage cleanup is not fixed by the UI change.** The existing backend
  can leave an unreferenced object after detach. A durable cleanup design remains
  separate work; this stage reports the outcome truthfully and does not pretend
  PostgreSQL/R2 have a distributed transaction. Blindly deleting the canonical key
  on a later retry could delete a replacement image and was intentionally avoided.
- Audit product selectors still use current catalog-page choices. Independent
  searchable selectors need their own implementation; preserved filter state does
  not make the choices tenant-wide.
- Restock's existing unresolved intent is still dialog-local. Persistent recovery
  for receiving belongs to the later agreed stage; this stage does not claim to
  protect legacy Restock across reload.
- Browser tests use fixtures, not production concurrency/load/security checks.
- Earlier fixed draft confirmation/busy/recovery/grouping behaviors passed the
  existing browser suite rather than being reimplemented.

## Gate

Update: the user's later instruction authorized all remaining stages without
further gates. The implementation and release limits are documented in
`inventory-receiving-implementation-2026-09-29.md`. The text below records the
original stage-one stopping point, not the current approval state.

Stage 1 is complete within these stated limits. Stop here per the user's agreed
one-stage-at-a-time plan. Next stage is a **design note only** reviewing receipt
fields/constraints, transaction locks, API/replay behavior and legacy contracts.
Do not write receipt migrations or implement that stage before approval.
