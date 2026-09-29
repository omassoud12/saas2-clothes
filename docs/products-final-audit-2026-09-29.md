# Products page ? final audit after Phases 1?4

Date: 2026-09-29. Audit only. No application code or business data was changed.

Scope: catalog, creation, dedicated details, edits, common pricing, stock recovery, images, responsive layout, authorization and related sale readiness. Evidence combines current source review, the current offline browser suite, three additional temporary browser probes, existing backend service/HTTP tests and the Phase 4 screenshots. Fixtures/doubles are not a production security certification, real PostgreSQL concurrency test or live R2 outage.

## Findings, in priority order

### 1. P2 ? Open variant draft can undo a newly applied common price

Reproduced: open Navy/S Edit at $15; change only the color to Blue; apply $27.50 through common pricing; the open variant price field remains $15. Save changes then sends sellingPrice:15.00, silently undoing the common price for that option while saving the color.

The bulk response replaces product data but leaves variantEdit intact. Variant saving serializes the entire draft, including the stale price. Preserving drafts is correct; preserving an old price without conflict handling creates a lost-update path.

Evidence: ProductsPage.jsx:304?324 and product-flow.js:130, :219. Temporary browser probe verified the PATCH body after the successful bulk response.

Recommendation: reconcile untouched price fields with the bulk result, or explicitly block/warn about overlapping drafts before applying common pricing. Preserve intentional unsaved price overrides, and test color-only draft plus common-price update before variant Save. Prefer resolving this first.

### 2. P2 ? Cross-tab recovery resolves, but displayed stock remains stale

Reproduced with two pages in the same browser context: both display stock 4; tab A adds one and displays 5; tab B receives recovery events and its pending operation disappears, but it still displays 4 and its +/- controls become available.

Recovery metadata and original-UUID protection work. The defect is operational display freshness, not a demonstrated duplicate increment or negative stock. Storage/custom-event synchronization updates pendingStock only; another tab's returned variant is not applied or fetched.

Evidence: ProductsPage.jsx:120?126 and :289?294. Temporary browser probe verified one stock request, cleared operation keys, enabled controls and stale Stock4 in the other page.

Recommendation: on external recovery completion, refresh the affected variant/product, or mark its displayed quantity stale until refreshed. Reconcile safely with existing drafts instead of silently replacing form contents.

### 3. P2 ? Stored photo cannot be removed when its signed URL is unavailable

Phase 3 now returns imageStatus:unavailable with imageUrl:null for an attached photo during signing failure. The detail placeholder correctly says Photo unavailable, but Remove image is conditional on imageUrl. Therefore the user loses the removal action during the exact outage state where it may be useful. The upload action also reads Upload image despite an existing attachment.

Evidence: ProductsPage.jsx:412; product.service.ts:95?105. Temporary browser probe used photo-unavailable, opened the photo editor and confirmed there was no Remove image button.

Recommendation: base photo-management availability on attachment state (including unavailable), not whether a temporary signed URL exists. Retain canonical-key validation and avoid exposing private storage keys. This does not negate the working Phase 3 catalog/signing fault isolation.

### 4. P2 ? Image deletion may report failure after the database detach succeeds

The backend clears imageKey, then calls object storage delete. If that call fails, the endpoint reports an error even though the product no longer has the image attached. The frontend retains its previous image because confirmImageRemove updates only on success. Retrying sees no imageKey and returns early, so it does not retry deleting the now-unreferenced object.

Evidence: product.service.ts:492?501 and ProductsPage.jsx:362?369. Existing backend test ?delete clears DB before deleting trusted key; arbitrary key is rejected? intentionally simulates storage-delete failure, asserts PRODUCT_IMAGE_DELETE_FAILED and confirms imageKey was already null. This is a deterministic service-double reproduction, not a live R2 mutation.

Recommendation: define a truthful detach-success/cleanup-pending contract and a safe durable cleanup mechanism, or an equally explicit retry design. Do not claim a distributed database/storage transaction or restore an image blindly. This is separate from Phase 3 read-URL signing isolation.

### 5. P3 ? Large option collections remain an unmeasured scaling concern

Summary catalog responses are compact, but the query still retrieves each listed product's complete option rows to calculate totals/prices. Dedicated details fetch/render all options. Single-option creation does not impose a cumulative product cap, while initial setup and bulk updates are capped at 200 per request.

Evidence: product.service.ts:155?170, :176 and :304?345; ProductsPage.jsx:415?419. Current fixtures exercise ordinary three-option and dense sixteen-option products, not production-scale collections.

Recommendation: measure realistic counts/payloads/query plans before choosing database aggregation, bounded details or a cumulative option policy. No timing result proves this explains earlier five-second writes. No architecture or cap change is authorized by this audit.

## What passed / resolved from earlier audits

- Dedicated details route/reload excludes catalog filters; explicit View product remains usable.
- Drafts survive cancelled/failed deactivation, unrelated clean Cancel, common-price reopening and internal/browser navigation guards in covered tests.
- Stock controls retain durable per-operation UUIDs, safe same-UUID replay, explicit retry, zero protection, metadata-only legacy migration and cross-tab same-variant coordination. Late unmounted completion clears only its own key.
- Unsupported Web Locks intentionally disable quick stock and preserve recovery data; this documented compatibility choice is not a new regression finding.
- Common pricing, normalized combination checks and NFC/trim/case color grouping work in covered service/UI fixtures; grouping does not merge stock records.
- Missing purchase cost is separate from sale readiness. Null-cost sale snapshots and incomplete financial reporting retain the previously tested behavior; later cost entry does not rewrite historical snapshots.
- Read-URL signing failure preserves catalog data and successful name/common-price writes; invalid tenant image keys remain rejected.
- OWNER/WAREHOUSE sensitive-field boundaries and tenant-scoped operations pass existing route/service tests. Backend stock changes and history remain atomic in covered doubles.
- Compact rows, grouped header/photo actions, one filter submit, amber pending links, safe swatches and visible focus remain present. Dense desktop remains 1,134px high. Covered 390/768/1024/1366/1440 flows have no horizontal overflow; mobile price selection expands deliberately.

## Validation

- Frontend: 240 tests passed, 42 suites.
- Backend: 428 tests passed, 77 suites, with TypeScript test compilation.
- Responsive browser suite: 51 passed, 0 failed.
- Three additional temporary audit browser probes passed, confirming findings 1?3. These intentionally assert the current defects; they are evidence of reproduction, not fixes.
- Frontend lint and production build passed.
- Existing phase-4 desktop/mobile screenshots were inspected during the immediately preceding visual review; no new visual change was introduced by this audit.
- Temporary probe script was removed. Only this report was retained; pre-existing uncommitted implementation changes were preserved.

No live authenticated business mutation, migration, deployment, commit, protected PDF access, production load test or live database race was performed. No application change was made. This audit does not certify the absence of all vulnerabilities or race conditions.

Suggested next order: resolve overlapping price drafts; refresh externally changed stock; keep unavailable-photo management accessible; make deletion outcomes truthful; then decide scaling based on measurements.
