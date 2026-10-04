# Inventory hardening — Phase 4 receipt recovery outcome model

Date: 2026-10-04. This report covers Phase 4 only. Phase 5 has not started.

## 1. Current recovery problem confirmed

The previous receipt client had three outcomes in practice: success, a small
hard-coded set of rejected errors, and everything else. This left confirmed
`PRODUCT_NOT_FOUND` and `VARIANT_NOT_FOUND` responses pending forever. Session,
account and role failures were not normalized to existing application routing.
An idempotency conflict displayed the same generic Retry action even though the
same key/payload was guaranteed to conflict again. Any retained record disabled
New product and Receive stock globally.

Save-only creation also inherited receipt-specific recovery text. The frozen
request and UUID were already preserved correctly, but no durable outcome status
explained why the record remained pending after reload.

## 2. Final outcome table

| Outcome | Trigger/status/code | Pending record | User message/action | Same UUID retained? | May a new operation begin? |
| --- | --- | --- | --- | --- | --- |
| Committed/replay | Valid HTTP 201 or replay 200 | Removed after authoritative response | Success; refresh stock and show saved Product/receipt | Replay uses the original UUID | Yes |
| Correctable rejection | Confirmed 4xx other than auth/account/conflict/terminal target, including 422 and inactive/limit validation | Removed | Explain the rejected details and let the user correct them | No retry is required; corrected submission gets a new UUID | Yes |
| Authentication pause | 401 or `SESSION_REQUIRED` | Preserved and marked `authentication_pause` | Sign in through the existing login path, then retry the original Product save/receiving request | Yes | No, until resolved |
| Account/role pause | Relevant 403 account state or `ROLE_FORBIDDEN` | Preserved and marked `account_pause` | Existing account-review route for inactive Account; role guidance without a retry loop | Yes | No, until access is restored and the original is resolved |
| Idempotency conflict | `RECEIPT_IDEMPOTENCY_CONFLICT` | Preserved and marked `idempotency_conflict` | Review saved operation details; OWNER may check the authoritative original result and open receipt history | Stored UUID remains evidence; conflicting POST is not retried | No |
| Terminal invalid target | `PRODUCT_NOT_FOUND` or `VARIANT_NOT_FOUND` | Removed after confirmed response | Explain that Product/option is unavailable, refresh Inventory, start corrected work | No repeated retry | Yes |
| Uncertain | Network interruption, timeout, 5xx, malformed success response | Preserved and marked `uncertain` | Retry the original Product save/receiving request | Yes, with the exact frozen payload | No, until resolved |

`preservePending` and `retrySameOperation` are explicit result properties. The
shared outcome constants are `committed`, `correctable_rejection`,
`terminal_rejection`, `authentication_pause`, `account_pause`,
`idempotency_conflict` and `uncertain`.

## 3. Files changed

- `frontend/src/features/inventory/stock-receipt-outcome.js` — shared outcome
  constants and preservation/retry policy.
- `frontend/src/features/inventory/stock-receipt-flow.js` — classification,
  user-facing mapping and authoritative operation lookup.
- `frontend/src/features/inventory/stock-receipt-recovery.js` — validates and
  persists recovery outcome metadata.
- `frontend/src/app/operation-recovery.js` — annotates an operation without
  changing its frozen request fields.
- `frontend/src/features/inventory/StockReceiptForm.jsx` — applies outcome policy
  during the initial submit.
- `frontend/src/features/inventory/ReceiptPresentation.jsx` — outcome-specific
  recovery UI and save-only/receiving language.
- `frontend/src/pages/app/InventoryPage.jsx` — retry/check/redirect/settlement
  and global-block behavior.
- `frontend/src/features/inventory/stock-receipt-flow.test.js` — focused Phase 4
  flow/storage tests.
- `scripts/products-ui.test.mjs` — Phase 4 browser scenarios and fixtures.
- `docs/inventory-phase-4-recovery-outcome-model-2026-10-04.md` — this report.

## 4. stock-receipt-flow changes

`submitReceipt` derives whether the frozen request is a Product save or a
receiving request, assigns exactly one outcome, and returns consistent policy
fields. Confirmed 4xx responses no longer fall into an ambiguous bucket.
Technical response/key messages were replaced with object, outcome and next-step
copy.

`checkReceiptOperation` uses the existing OWNER-only
`GET /api/inventory/receipts/by-operation/:key` endpoint. A valid lookup settles
the conflicting local record with the backend's original committed result. A
failed lookup remains a reviewable conflict and never becomes a POST retry.

## 5. Recovery-storage changes

Pending records may now include only this additional metadata:

```text
recovery: { outcome, code, message, updatedAt }
```

The operation ID, path, payload and creation time are retained unchanged.
Annotation occurs under the existing metadata lock and dispatches the existing
cross-tab recovery event. Validation rejects unknown outcome metadata. No token,
header or new cost field is stored. WAREHOUSE recovery presentation continues
to omit cost, and WAREHOUSE save-only payloads contain no receipt cost.

## 6. InventoryPage blocking changes

The conservative `pending.length > 0` block remains. It now applies only while
an operation genuinely needs resolution:

- uncertain, auth/account pause and conflict remain blocking;
- committed/replay, confirmed correctable rejection and terminal target failure
  settle the record and release the block;
- Product/option not-found also refreshes the Inventory list;
- successful retry/check clears prior recovery feedback.

No parallel receipt is permitted while an unresolved operation exists.

## 7. Auth/account-state behavior

401/session expiry preserves and marks the exact operation before routing to the
existing `/login` path. Relevant inactive Account responses do the same before
the existing `/pending-approval` path. On return to an active authenticated
Inventory page, the banner exposes retry of the original operation. A role
failure does not offer a repeated retry while the same unauthorized role is
active; if the user's current profile is later OWNER, retry becomes available.

No second authentication mechanism was introduced.

## 8. Idempotency conflict behavior

Conflict is a distinct pending state. It shows saved operation details and no
generic “Retry original request” button. OWNER receives **Check original result**,
which performs the existing read-only operation lookup. Receiving conflicts can
also open Receipt history. WAREHOUSE receives guidance to ask an Owner and never
receives cost-sensitive recovery data.

The client neither discards the record nor invents a committed result when the
lookup cannot confirm one.

## 9. Terminal not-found behavior

`PRODUCT_NOT_FOUND` and `VARIANT_NOT_FOUND` are confirmed terminal outcomes.
The operation is removed, the stale receiving flow closes, Inventory refreshes,
and New product/Receive stock become available. Repeated submission of the same
frozen invalid target is not offered.

## 10. Uncertain network/5xx behavior

Network exceptions, timeout exceptions, 5xx responses and malformed success
bodies preserve the record and block new receiving. Retry sends the original
path, frozen payload and UUID. A successful replay settles the record and does
not create a second business effect.

## 11. Save-only recovery behavior

Save Product Only now uses:

- “Product save awaiting confirmation”
- “Retry original product save”
- “Another tab is confirming this product save”
- “The product details were not accepted”

It does not claim that a receipt was intended or saved. Save-only uncertainty,
confirmed rejection and authentication pause have focused flow coverage; the
browser suite verifies uncertainty/reload/exact replay and confirmed rejection.

## 12. Copy changes

Touched technical phrases such as “response was invalid” and “key belongs to
different details” were replaced. Receipt-history malformed-response copy now
says it could not load and gives a refresh action. Receiving and Product-save
messages remain separate throughout submission and recovery.

## 13. Tests added/updated

Flow/storage coverage now includes:

- new success and replay success;
- 422 validation, inactive Product/option and stock-limit rejection;
- Product/option not-found;
- session expiry, four inactive Account codes and role-forbidden pause;
- idempotency conflict and authoritative lookup success/failure;
- network, timeout, 5xx and malformed-success uncertainty;
- exact UUID/payload replay;
- save-only uncertainty, rejection and auth copy;
- immutable recovery annotation and local configuration rejection.

Existing WAREHOUSE recovery-summary coverage confirms that exact cost arithmetic
is shown only to OWNER. Browser coverage adds auth redirect preservation,
Product/option terminal release, conflict review without POST loop, save-only
uncertainty/exact replay and save-only rejection language. The existing lost
response browser test was updated to the new explicit action label.

## 14. Frontend unit result

261 tests passed in 42 suites; 0 failed, skipped or cancelled.

## 15. Browser result

79 tests passed; 0 failed, skipped or cancelled. The full offline browser suite
ran after the Phase 4 changes.

## 16. ESLint result

`npm.cmd run lint --workspace client`: passed.

## 17. Vite build result

`npm.cmd run build --workspace client`: passed. Vite transformed 128 modules and
completed the production build.

## 18. Backend test result

Backend code, Prisma schema, migrations and API contracts were not changed in
Phase 4, so the backend suite was not rerun. The incoming verified baseline is
440/440 backend tests and the completed Phase 2 PostgreSQL suite.

## 19. git diff --check result

Passed. Git reported only the working tree's existing LF/CRLF conversion
warnings; no whitespace error was reported.

## 20. Remaining limitations

- Recovery remains same-browser/local-storage based. Lost browser storage or a
  device change can lose the operation UUID; Phase 4 does not claim device-safe
  exactly-once UX.
- A conflict the existing lookup cannot confirm remains deliberately blocked for
  manual review.
- Login/account restoration uses existing application routing; no automatic
  return-location framework was added.
- Receipt identity snapshots, database immutability, opening-cost eligibility,
  cursor history, independent filter sources, payload architecture and legacy
  retirement remain Phases 5–10.

## 21. Git diff stat

The working tree was already intentionally dirty and most Inventory files were
untracked from earlier authorized phases, so Git cannot produce a trustworthy
Phase-4-only stat. Phase 4 directly touched nine source/test files (including
one new outcome-policy module) and added this report. The final tracked-tree
stat, which includes earlier phases and excludes untracked files, is:

```text
19 files changed, 799 insertions(+), 252 deletions(-)
```

## 22. Git status

The pre-existing Inventory/backend/Prisma changes remain uncommitted. Phase 4
adds no commit and does not revert or rewrite earlier work. Final short status:

```text
 M ARCHITECTURE.md
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
?? backend/scripts/
?? backend/src/receipts/
?? docs/inventory-current-logic-ui-ux-audit-2026-10-04.md
?? docs/inventory-logic-audit-2026-09-29.md
?? docs/inventory-page-audit-2026-09-29.md
?? docs/inventory-phase-1-p0-hardening-2026-09-29.md
?? docs/inventory-phase-2-postgresql-validation-2026-09-30.md
?? docs/inventory-phase-3-architecture-source-of-truth-2026-10-04.md
?? docs/inventory-phase-4-recovery-outcome-model-2026-10-04.md
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
?? frontend/src/features/inventory/stock-receipt-outcome.js
?? frontend/src/features/inventory/stock-receipt-recovery.js
?? frontend/src/features/products/ProductComponents.jsx
```

## 23. Confirmation

- Phase 4 only.
- Phase 5 was not started.
- No Prisma/schema change.
- No migration created or executed.
- No database execution or business-data mutation.
- No commit.
- No deployment.
- `planing/SaaS2_Clothes_Implementation_Summary.pdf` was not opened or changed.

## Post-phase runtime migration note — 2026-10-04

After Phase 4 was completed, the local frontend exposed HTTP 500 responses for
receipt history and Product setup. A read-only migration-status check confirmed
that the configured Supabase database was missing only
`20260929190000_stock_receipts`. With the user's explicit approval, the additive
migration was applied using `prisma migrate deploy`.

Post-deployment verification passed: all 15 migrations are applied, a read-only
query against `StockReceipt` executed successfully, and local backend `/api/health`
and `/api/ready` both returned HTTP 200. This operational migration was performed
after the Phase 4 code boundary described above; no source-code workaround or
additional schema change was introduced.
