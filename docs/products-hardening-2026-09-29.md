# Products correctness and sale-before-cost completion — 2026-09-29

Implementation is complete locally. No deployment, database migration application,
production mutation, live duplicate-data query, or historical backfill was performed.
The original audit remains an accurate record of the pre-change implementation.

1. **Root cause:** Sale rejected null `lastPurchaseCost`; SaleItem required a cost;
   movement validation rejected null; financial aggregation assumed all costs known.
2. **Policy:** valid active stock can sell with unknown purchase cost. Existing
   stock, authorization and positive sale-price rules still apply.
3. **Representation:** `SaleItem.unitCostAtSale` is nullable Decimal. Unknown is
   null, never a guessed or zero purchase cost.
4. **Reports:** backend-owned COMPLETE/INCOMPLETE. Any applicable unknown sale,
   return or void cost makes all six COGS/profit totals null. Revenue and expenses
   remain exact. Mixed known costs are not presented as total COGS.
5. **History:** Option 1, immutable snapshots. Setting the current purchase basis
   later affects future sales only; earlier null snapshots stay null.
6. **Lifecycle:** Return/Void restore stock using the original nullable snapshot;
   replacement Sales independently snapshot current known/null cost. Transactions
   and historical reference/quantity checks remain.
7. **OWNER:** separate sellability and Cost pending; the pending indicator links
   to Inventory. Cost can be initialized for eligible pending stock even after
   selling out, without rewriting ledger or sales history.
8. **WAREHOUSE:** no purchase cost, cost completeness or profit fields/controls.
   Server authorization and serialization remain authoritative.
9. **Recovery:** unresolved UUID/direction/variant/timestamp persisted under
   account/user/product scope before sending. Storage failure blocks mutation.
   No automatic mutation on reload. Confirmation removes resolved metadata;
   requests older than 30 days retain their UUID and require review messaging.
10. **Reload:** committed response-loss followed by reload and explicit Retry
    same update reuses the UUID and does not add another piece in browser fixtures.
11. **Bulk price:** OWNER selects up to 200 active options, reviews current prices
    and confirms. One transaction and updateMany; stale/foreign targets reject
    the whole update. Individual exceptions survive unless explicitly selected.
12. **Combinations:** NFC/trim/case normalized color and size enforced on setup,
    add and edit, under a tenant-qualified Product lock; frontend checks assist.
13. **Existing duplicates:** live data audit NOT RUN. No database uniqueness
    constraint or destructive merge added; existing records are preserved.
14. **Drafts:** meaningful creation, product, variant, photo and price drafts warn
    before internal navigation, Back and unload. Browser Back cancellation
    preserves the fixture draft. Native unload warning was verified; browser
    automation does not prove every browser's native cancellation behavior.
15. **Summary:** active prices and active physical stock are primary; inactive
    physical stock/counts are separate. Product inactivity also removes options
    from the active summary. Price readiness is shown separately on details.
16. **Stock feedback:** affected option shows Updating; its controls serialize.
    Other option stock controls remain usable. Uncertain outcomes offer explicit
    same-request retry. Zero-stock, stock-limit and key-conflict errors are mapped.
17. **Payload:** synthetic 12 products × 200 options: 477,597 to 3,317 JSON bytes
    (99.31% reduction). Optional `view=summary` preserves existing full-list clients.
    Summary still reads narrow option rows; no real query-plan/network latency
    claim. Benchmark artifact records all fixture sizes and local timing limits.
18. **Sizes:** XS, S, M, L, XL, XXL, 3XL, 4XL, then deterministic custom sizes.
    Database ordering also has an ID tie-breaker.
19. **UI:** compact sparse groups, readable labels, collapsed compact photo action,
    current +/− copy, SKU-only optional details and corrected missing-price states.
20. **Responsive:** fixture flows at 390/768/1024/1366/1440 pixels; no horizontal
    overflow in covered cases. Screenshots inspected for stock cards, bulk flow,
    pending cost and incomplete reports. Arbitrarily many options still scroll.
21. **Schema:** new migration makes SaleItem cost and six DailyReport values
    nullable, adds constrained costStatus and null-safe movement validation.
    Existing migrations and historical snapshots were not rewritten. Apply this
    migration before running the matching backend; it was NOT applied here.
22. **Files:** Products controller/routes/schema/service/types/tests; Prisma schema
    and new migration; Sales/Returns services/types/tests and lifecycle tests;
    financial engine/types/cache/report tests; React Products/create/confirmation,
    navigation/dirty/recovery/options/helpers/tests/styles; Inventory/Reports/
    Dashboard and finance/money helpers; browser/benchmark scripts; architecture
    and scoped Products documentation. See commit file list for exact paths.
23. **Focused frontend:** option ordering/readiness/recovery, duplicate validation,
    inactive summaries and incomplete financial contracts passed. Final pending-cost
    and WAREHOUSE browser rerun: 6 passed after the Inventory link addition.
24. **Focused backend:** product/restock/image/lifecycle/financial coverage passed;
    full suite includes nullable snapshots, rollbacks, tenant and role boundaries,
    duplicate locks, bulk target rejection and immutable future-cost behavior.
25. **Frontend total:** 234 passed, 42 suites; full browser fixture suite 33 passed.
26. **Backend total:** 424 passed, 76 suites.
27. **Checks:** frontend ESLint/build and backend typecheck/build passed. Frontend
    is the existing JSX application and has no independent typecheck script;
    backend has no separate ESLint script. Test TypeScript compilation passed.
28. **Prisma:** offline schema validation and client generation passed using
    prisma.generate.config.ts. No database connection/migration execution required.
29. **Review:** scoped secret scan, role serialization/route review and whitespace
    diff check performed. Tests use doubles/fixtures; no live PostgreSQL migration
    or concurrency benchmark, production load test or authenticated upload.
30. **Protected PDF:** excluded from reads, edits and staging. Its contents and
    tracking state were deliberately not inspected; no untrack/revert/recommit.
31. **Commit:** exact requested title; hash supplied in the completion response
    if repository write permission permits committing.
32. **Limits:** deployment/migration rollout and optional read-only existing-data
    audit remain operational follow-ups. No unresolved financial-policy ambiguity;
    unknown historical profit intentionally remains unavailable permanently under
    immutable Option 1. Five-second live write latency is not guaranteed resolved.
