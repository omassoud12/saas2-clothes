# Products Phase 3 ? photo failure isolation and normalized color groups

Date: 2026-09-29. Scope: behavior only; no visual stylesheet changes.

## Changes

A shared product response helper validates the canonical account/product image key before signing. It catches only failures from image-store acquisition/signing, returning imageUrl:null and imageStatus:unavailable for that item. Summary/full catalogs and dedicated details retain their product data. Committed name edits and transactional bulk-price changes return success even when signing fails. Healthy images keep their URLs, and products with no image have imageStatus:none.

The additive optional API field imageStatus accepts none, available or unavailable. Current service responses always provide it; older clients can ignore it and existing response doubles remain compatible. No routes, inputs or authentication contracts changed. Image upload/delete transport errors still follow their existing mutation contract; this change isolates read-URL signing, not storage writes/deletes. Invalid/cross-tenant stored keys remain authorization errors and are never signed or substituted with public URLs.

Catalog and detail placeholders explicitly say Photo unavailable for a server-unavailable image or browser image-load failure. Removing a photo resets its state to none. Existing image refresh/upload controls and accessible names remain intact.

Detail color groups now use NFC normalization, trim and lowercasing, matching backend combination uniqueness. The first normalized readable label is retained. Sizes stay ordered; each variant ID, price and stock remains separate. Blank colors are distinct from a literal custom color named No color; stable variant IDs avoid duplicate React keys when labels coincide.

## Files changed in this phase

- backend/src/products/product.service.ts
- backend/src/products/product.types.ts
- backend/src/products/product.test.ts
- frontend/src/pages/app/ProductsPage.jsx
- frontend/src/app/product-options.js
- frontend/src/app/product-hardening.test.js
- scripts/products-ui.test.mjs
- docs/products-phase-3.patch (isolated application/test diff)

Earlier visual, Phase 1 and Phase 2 edits were preserved and excluded from the isolated patch.

## Validation

- Backend: 428 tests passed, 77 suites, including TypeScript test compilation.
- Frontend: 240 tests passed, 42 suites.
- Added four backend tests: mixed failed/healthy/absent signing, HTTP catalog 200 and committed writes during unavailable storage, canonical-key rejection, and post-commit signer failure with role-safe responses.
- Added one unit test for case/trim/NFC color grouping, blank/custom labels, ordering and preserved stock records.
- Added two offline browser tests for unavailable-photo catalog/detail/edit and one mixed-case color section with independent quantities at 390px.
- Browser full suite: 50 passed, 0 failed (48 retained + 2 new).
- Frontend lint/build and backend typecheck passed. No dependency installation or database generation was needed.
- Controlled pre-fix service probe: the first three new backend tests failed against the original service, then passed with the fix.
- One existing backend assertion explicitly expected pictured details to reject with IMAGE_STORAGE_UNAVAILABLE. It was updated to assert successful data with unavailable image status because its old expectation contradicts the requested Phase 3 behavior. Existing browser assertions/selectors were retained.
- Diff review, whitespace check and isolated patch reverse-check passed.

## Limits and assumptions

All browser API calls are intercepted offline. Backend tests use catalog/database and image-store doubles, including local HTTP fixtures. No real PostgreSQL race benchmark, production mutations, or live R2 service outage was exercised. Per-item isolation is limited to image infrastructure; invalid image keys deliberately remain errors. No historical sale/cost records, tenant authorization rules, pricing transaction semantics, stock recovery behavior, migration, deployment, commit or protected PDF changed.

Stopped after Phase 3. Phase 4 has not started; continuing requires the user's next approval under the phased brief.
