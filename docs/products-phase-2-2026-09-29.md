# Products Phase 2 ? stock recovery correctness

Date: 2026-09-29. Scope: frontend recovery metadata and coordination only.

## Changes

- Each unresolved operation uses its own account/user/product/UUID localStorage key. Adds and completion delete only that operation; no shared-array rewrite remains.
- A per-variant Web Lock remains held through response handling. Inside it, a short product metadata lock serializes discovery and persistence, preventing cross-tab enumeration/write races without holding up another variant's network request.
- Reads under the lock determine whether a fresh operation is allowed. Explicit retry retains the original UUID and direction; a stale Retry action never becomes a fresh increment. There is no automatic replay or expiry.
- Storage and same-document events refresh mounted recovery controls. A late response after navigation still clears its own key, without updating the unmounted page's UI.
- Legacy arrays remain readable and migrate under the metadata lock. Every record is copied before the legacy key is removed. Partial storage failures retain the legacy source, and repeated migration deduplicates immutable UUID metadata.
- Unsupported Web Locks fail closed: quick +/- and recovery controls show a compatibility message, preserve metadata, and send no stock request. Inventory or a supported browser remains the next action.

## Files

- frontend/src/app/stock-recovery.js
- frontend/src/pages/app/ProductsPage.jsx (recovery state/effect and changeStock only)
- frontend/src/app/product-hardening.test.js
- scripts/products-ui.test.mjs (optional shared browser context and five new Phase 2 tests)
- docs/products-phase-2.patch: isolated Phase 2 application/test diff, excluding earlier visual and Phase 1 work.

Existing routes, accessible names, backend contracts, tenant/role checks, costs, sales and stock movement semantics are unchanged. All browser API responses are fixtures, with external network blocked.

## Validation

- Client unit suite: 239 passed, 42 suites. Six recovery tests cover independent writers and own-key cleanup, scope/privacy, legacy migration, quota failure, unsupported locking, lock contention and conflicting metadata. The previous recovery test was adapted to the replacement per-operation storage API; its scope/privacy/direction/age invariants remain covered.
- Five added offline browser tests cover two real tabs plus reload/original-UUID replay, same-variant in-flight coordination, navigation/late cleanup, unsupported locking and legacy migration/retry.
- Existing single-page retry, reload retry, ordinary increment/decrement, role boundaries and Phase 1 draft/busy-control coverage were retained without changing their selectors or assertions.
- Final browser suite: 48 passed, 0 failed (43 existing + 5 new). Final log: %TEMP%/saas2-phase2-ui-final-verified.log.
- Frontend lint and production build passed. git diff --check passed; isolated patch reverse-check passed on the final diff.
- Controlled probe using the pre-fix helper reproduced both lost-operation failures: two writers retained only one record, and late whole-array cleanup erased the other record.

## Limits and assumptions

- Earlier browser runs exposed existing immediate-count assertions racing initial rendering (catalog navigation and readiness checks). Their selectors/assertions were not weakened; final results are recorded above.
- Web Locks support is required for quick stock. This is deliberately a fail-closed compatibility fallback, not a localStorage lease claimed to be atomic.
- Recovery assumes current-version pages share the same origin and browser storage. Clearing browser storage or using a separate device cannot recover a locally lost UUID; already-open old-version tabs should be reloaded after release.
- No backend/database changes were needed; backend suites were not rerun for this frontend-only phase. No production concurrency benchmark or live authenticated stock mutations were performed.
- No dependency, migration, commit, deployment or protected PDF access occurred. Earlier uncommitted changes were preserved.

Stopped after Phase 2, as requested. Phase 3 (photo fault isolation and normalized color grouping) has not started.
