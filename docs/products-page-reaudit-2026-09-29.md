# Products page re-audit — 2026-09-29

Scope: catalog, creation, dedicated details, product/variant editing, bulk price,
quick stock and recovery, photos, dirty drafts, responsive layout and related
sale readiness. Baseline: commit b6a38d9, after the separately approved nullable
cost migration. Audit only: no application changes or business-data mutations.

Evidence: source review, fresh existing tests, offline browser flows at 390,
768, 1024, 1366 and 1440 pixels, screenshot inspection, four temporary browser
probes and two direct fixture probes. The temporary script was removed.
Existing unit/service tests use doubles; browser API/auth calls are intercepted.
This is not a production penetration test or PostgreSQL concurrency benchmark.

## Findings ordered by priority

### 1. P1 — Recovery metadata can be overwritten by another page instance

Each mounted Products page loads recovery once into a private Map, then replaces
the complete shared localStorage array on every addition/removal. Two tabs for
the same account/user/product do not merge or synchronize their operations.
An old page's request also continues its storage writes after navigation.

Confirmed helper probe: both tabs read an empty array; A writes unresolved
operation A; B writes its own unresolved B. Storage retains only B. If A had
committed with a lost response, reloading A now loses its recovery UUID. A later
fresh click can change stock again. This is a conditional response-loss recovery
risk; ordinary successful clicks are not demonstrated to double-increment.
The equivalent late-response/remount scenario follows from source review and
was not separately reproduced in browser.

Evidence: frontend/src/pages/app/ProductsPage.jsx:108, :111, :238, :247;
frontend/src/app/stock-recovery.js:18.

Recommendation: persist operations independently and coordinate same-variant
requests across tabs/remounts; serialize shared updates with a suitable lock or
transactional store. A storage-event listener alone does not make writes atomic.
Keep the original UUID and explicit retry; never expire ambiguity into a new key.

### 2. P2 — Same-page actions bypass draft protection

Three browser probes reproduced silent loss without a discard prompt:

- Edit product name, open Deactivate product, then Cancel the dialog: the edit
  form is already cleared; reopening Edit restores the saved name.
- Open a clean product edit and a dirty variant edit; Cancel the product form:
  its handler checks only productDirty but clears both drafts.
- Enter a bulk price, click Apply price to variants again: price and selection
  reset immediately. The dirty navigation guard does not cover this handler.

Variant deactivation similarly clears variantEdit before confirming, by source
review. Internal navigation/Back guards pass their covered tests, but are not a
complete guarantee for every destructive same-page state transition.

Evidence: frontend/src/pages/app/ProductsPage.jsx:361, :362, :364, :383.

Recommendation: preserve drafts while confirmation dialogs are open; each action
must guard exactly the drafts it discards. Cancel product should not clear an
unrelated variant draft. Reopening bulk pricing should preserve or confirm loss.

### 3. P2 — Enabled Save controls can silently do nothing during quick stock

run() returns null while stockInFlight is nonempty. Existing bulk-price controls
and photo upload controls only use busy, so they remain enabled during stock
requests. A browser probe prepared/reviewed a bulk price, started a delayed +,
then clicked enabled Confirm price update. No price API request occurred, no
queued save occurred afterward, and the price form stayed open without a specific
explanation. Photo submission has the same source-level mismatch.

Evidence: frontend/src/pages/app/ProductsPage.jsx:219, :260, :368, :391.

Recommendation: disable affected Save/Confirm controls while stock is pending or
show a clear wait message. Keep unrelated per-variant stock controls usable.

### 4. P2 — Photo-service failure can make the entire catalog unavailable

Summary listing uses Promise.all for signed image URLs; one failure rejects the
whole response. Details also depend on signing. A fixture service probe with an
unavailable image store and one pictured product rejected the entire catalog
with IMAGE_STORAGE_UNAVAILABLE (503), although catalog data itself was readable.

Bulk pricing and product edits construct their image-bearing response after the
database write commits. A subsequent signing failure can therefore report failure
for an already committed change. This post-commit risk is from source review;
no live signing outage or authenticated mutation was triggered.

Evidence: backend/src/products/product.service.ts:95, :144, :238, :281;
backend/src/product-images/r2-product-image-store.ts:126.

Recommendation: isolate optional image failures from catalog availability and
committed-write acknowledgment, with an explicit unavailable-photo state. Keep
canonical tenant key validation; never substitute an unvalidated public URL.

### 5. P2 — Payload improvement does not bound database/detail option work

Catalog JSON is now compact, fixing the previous full-array list response.
However listProductSummaries still fetches all narrow option rows for each listed
product. Product details fetch/render every option, and there is no cumulative
200-option cap: setup and bulk-price requests are capped, individual option
creation is not. Large products can still increase query/render work and the
bulk selection list can be long. No actual production-scale latency was measured.

Evidence: backend/src/products/product.service.ts:44, :144, :290;
frontend/src/pages/app/ProductsPage.jsx:366, :372.

Recommendation: measure real option counts and query plans before choosing
database aggregates or bounded detail fetching. Do not claim that compact JSON
alone fixes the previously reported five-second write latency.

### 6. P3 — Color grouping uses different normalization from uniqueness

Backend uniqueness normalizes NFC, trim and case; details group only by trimmed
display string. Valid options Black / S and black / M appear as separate color
groups even though uniqueness treats them as the same color with different sizes.
This is confirmed by the grouping algorithm; no saved production data was queried.

Evidence: frontend/src/pages/app/ProductsPage.jsx:320;
frontend/src/app/product-options.js:3;
backend/src/products/product.service.ts:210.

Recommendation: group by the normalized color key while preserving a readable
display label. Do not merge variant records or their stock.

### 7. P3 — Dense details remain taller than the requested compact workflow

The simple desktop creation fixture fits comfortably within a 768px viewport.
Details use horizontal size cards and sparse groups are compact. Still, the
16-option/two-color desktop screenshot is about 1,470px tall: repeated Sellable,
Stock, Price and More rows occupy substantial vertical space. The bulk form also
adds significant height on mobile. This is a usability observation, not overflow
or a promise that arbitrary numbers of options can fit one screen.

Evidence: fresh create-1366, compact-colors-1366 and bulk-price-390 screenshots;
frontend/src/pages/app/products.css size-card and bulk-price styles.

Recommendation: consider a compact stock/price matrix per color, with local
expansion for editing/SKU and a summarized bulk-price selector. Preserve readable
text and usable touch targets.

## What passed and what changed since the first audit

- Sale-before-cost code now keeps null historical cost, supports return/void/
  replacement lifecycle and exposes backend-owned incomplete financial totals.
  Later purchase basis does not backfill historical null snapshots.
- The nullable-cost migration was successfully applied and verified in the
  preceding user-authorized task. This re-audit did not reconnect to the database
  or repeat that migration. It did not reproduce the user's unspecified 500 request.
- OWNER cost-pending links to Inventory; WAREHOUSE covered fixtures hide costs,
  financial completeness and OWNER-only pricing/stock controls.
- Single-page/reload explicit same-UUID stock retry passes; zero-stock protection,
  transactional history and per-option Updating feedback pass covered tests.
- Atomic selected bulk pricing, role/tenant checks and normalized duplicate
  prevention pass service tests. Existing production duplicates remain unaudited;
  no database combination-uniqueness constraint or destructive merge was added.
- Active/inactive stock summaries and active-price ranges pass helper tests.
- Standard size order, dedicated route reload, filters/confirmation keyboard
  behavior, image fixture flows and responsive no-overflow checks pass.
- Internal dirty navigation and browser Back pass the covered flows. New probes
  demonstrate that same-page draft-clearing paths still need coverage/fixes.

## Validation and limits

- Frontend: 234 tests passed, 42 suites; ESLint passed.
- Backend: 424 tests passed, 76 suites; test TypeScript compilation passed.
- Existing browser suite: 33 passed across the five viewport widths.
- New temporary browser probes: 4 passed, confirming the three draft-loss paths
  and enabled-but-ignored bulk confirmation during quick stock.
- Direct fixture probes: shared recovery overwrite and catalog photo dependency
  confirmed. These are controlled reproductions, not real multi-tab database races.
- Screenshots visually inspected for simple creation, dense details and mobile
  bulk pricing. Build was not rerun: no application code changed in this audit.
- No production CRUD, live R2 upload, new migrations, data backfills, performance
  guarantees or real PostgreSQL race tests. Protected PDF was not read or changed.
- Only this new report remains as an audit change; no commit/deployment performed.

Suggested order: shared recovery correctness first; then same-page draft loss and
silent busy controls; then image fault isolation; finally measured scaling and
compact color/size UX. Passing existing tests does not erase the new findings.
