# Quantities Dictionary v2 integration

STATUS: PASS — local implementation, audited source resources and regression checks.

## Architecture and source audit

AGENTS.md, ARCHITECTURE.md, the Prisma schema and the existing Dictionary, Parser,
Matcher, read-only catalog reader, POS quantity contract and development Lab were
inspected. No directly relevant architectural conflict was found.

ProductVariant.currentStock is authoritative. SaleItem.quantity counts sellable
ProductVariant units, with the existing POS ceiling of 1,000,000. The schema has no
packaging/BOM, pieces-per-SKU, length or weight conversion fields. Costs and prices
remain Decimal. Account resolution, roles and financial response allowlists remain
unchanged.

The actual extracted `SAAS2_Quantities_Dictionary_Integration_Kit` was used. All 17
manifest file hashes and byte sizes were verified. All nine CSV exports were
compared row-by-row and column-by-column with the seed. Illustrative TS was not
executed or copied into production. Runtime resources are immutable, hash-verified
and indexed once per process. The original raw aliases, IDs, provenance, policies,
review statuses and 61 ambiguity flags are retained.

## Coverage and activation policy

| Source domain | Concepts | Alias records | Context-gated recognition | Conflicting records |
| --- | ---: | ---: | ---: | ---: |
| Numeric values | 1,006 | 1,533 | 1,533 | 0 |
| Units | 23 | 361 | 361 | 6 |
| Direct phrases | — | 312 | 312 | 0 |
| Modifiers | 24 | 220 | 220 | 4 |
| Total | — | 2,426 | 2,426 | 10 |

2,416 records are lexically unambiguous within their own source group. All 2,426
remain conditional for interpretation; none is an unconditionally authorized
standalone stock count. Ten conflicting records remain recognized alternatives,
not deferred or silently selected. There are zero lexically blocked source rows.
Unresolved packaging, metadata, numeric syntax and advisory expressions are
**blocked from exact quantity selection**, even though their vocabulary is active.
Source `review_generated`/regional flags remain visible; this is not certification
of a spoken dialect corpus. One exact supplementary grammar alias, `approx`, is
supported separately; it is not counted as a source record. Legacy aliases such as
`kt3ten` remain available through the unchanged legacy dictionary.

The runtime audit found four keys differing from source normalization and 141
records with overlaps across existing dictionaries or quantity subdomains. The
complete row-level ledger is in [QUANTITIES_AUDIT.json](./QUANTITIES_AUDIT.json).
Product Types (343 concepts), Colors (307), Sizes (671) and the original Quantity
dictionary (17 canonical values) remain intact.

| Collision | Retained meanings | Handling |
| --- | --- | --- |
| lot / lots | BUNDLE, LOT | Unit alternatives; no SKU conversion |
| شوال | BAG, SACK | Unit alternatives; no SKU conversion |
| just | EXACT, ONLY | Unresolved modifier alternatives |
| من | RANGE, OF | Connector unless range context exists; range remains advisory |

Cross-kind meanings such as تشكيلة (LOT/ASSORTED) are also preserved in unit and
modifier evidence. Source-normalized collision relationships are included in the
audit alongside runtime collisions; array ordering never chooses a sale amount.

## Parser and matcher behavior

Shared NFKC, Arabic letter/diacritic normalization, case folding, digit and
whitespace rules are reused. Matching uses exact whole tokens and longest phrases.
XL/XXL/XXXL, W/L, age and bra labels remain separate from quantities. Original
punctuation guards prevent decimal, signed, range, time and identifier amounts
from becoming positive stock counts after normalization. Original character spans
and normalized token spans are retained, including Arabic/Persian digits and
directional controls removed by normalization.

Optional `quantityIntent` exposes status, intent, orderUnits, unitId/alternatives,
resolvedPieces, needsCatalogMetadata, exactness, modifiers, evidence and reasons.
Existing `attributes.quantity` keeps its JSON contract; its TypeScript value type
is widened from 17 literals to a validated integer number. Exact numeric grammar
supports 1–1,000,000 without inventing new dictionary concepts or variants.

Explicit PIECE phrases and count labels resolve sellable-variant units under the
existing POS convention. Bare digits and number words without that evidence remain
unresolved. This intentionally replaces the old unsafe standalone-word behavior
(e.g. `two` used to resolve to 2 without order context). Unclaimed number words in
brand/model names remain literal name constraints. WANT alone cannot prove that
a following number word is not part of a product name.

PAIR is never multiplied by two. DOZEN/half-dozen/quarter-dozen, containers, weight
and length never become stock counts without independently verified SKU metadata.
Source physical-piece estimates are retained only in the immutable vocabulary,
not treated as resolved sellable counts. Variable packages remain INCOMPLETE.
Named sets and `3-pack Socks`/`3 Pack Socks` do not independently create a requested
quantity. A separately explicit PIECE count refers to whole sellable SKUs under
the existing inventory convention, never to decomposed package contents.

Approx/min/max/range/allocation/add/remove/multiplier intent is advisory. Conflicts,
zero, negative, fractional and excessive PIECE counts never become exact checkout
quantities. Unsupported input is blocked before catalog reads. The pure matcher
also refuses unresolved quantity intent. MATCHED remains a confirmation-required
preview; no Cart, checkout, stock reservation or sale action is added.

The Lab displays a whitelisted quantity-unit summary, without raw source records
or financial extras. Its optional projection accepts legacy responses, rejects
contradictory quantities and unresolved MATCHED responses, and remains excluded
from the production frontend bundle.

## Examples before/after

| Input | Previous foundation | Integrated result |
| --- | --- | --- |
| Tshirt black XL 38 pcs | Unsupported unit phrase / unresolved count | quantity 38; MATCHED in compatible mock catalog |
| Tshirt black size 32 38 pieces | 38 outside old numeric vocabulary | size 32, quantity 38; NOT_FOUND when only XL exists |
| Tshirt black XL 2 pairs | No pair reasoning | orderUnits 2, PAIR, stock quantity null; INCOMPLETE |
| Tshirt black XL about 10 pieces | Approximation lacked quantity-intent handling | approximate intent; exact quantity null; INCOMPLETE |
| Tshirt black XL one two pieces | Existing conflict safeguard | retained conflict; AMBIGUOUS; no catalog reads |
| Tshirt black XL two | Bare word could become 2 | unresolved quantity; INCOMPLETE |
| 3-pack Socks two pieces | Descriptor not part of quantity-unit analysis | literal package-name constraint; 2 whole sellable SKUs in compatible fixture |

Examples use synthetic catalogs. No product, variant, price, stock or tenant is
invented or taken from an untrusted request account identifier.

## Source case reconciliation and tests

All 65 seed cases have policy assertions and a recorded parser result. **29 agree
literally with every source expectation; 36 have documented semantic exceptions.**
65/65 policy PASS does not mean 65/65 literal seed agreement.

Exceptions mainly concern physical-piece conversions for dozens/packages,
advisory amounts represented as exact pieces in the source, descriptors treated as
implicit orders, and bare numbers. Full source expectations, actual intent, parser
status, differing fields and reasons for every case are in QUANTITIES_AUDIT.json.
No assertion forces an unsupported packaging conversion just to satisfy a fixture.

Final local checks:

- Full backend: **5,545/5,545**, 123 suites, no skipped tests.
- Full frontend: **373/373**, including Lab SSR and production bundle exclusion.
- Every 1,533 number alias, 361 unit alias, 312 direct phrase and 220 modifier alias
  has an exact lookup/provenance/audit test and a parser evaluation.
- All 65 source fixtures; source shape corruption, all five collision groups,
  multilingual counts, compact forms, original spans, contradictory cues,
  quantities vs sizes, identifier/price/stock guards, packages and unknown names.
- Existing Product Types/Colors/Sizes regressions, including all 10,448 size aliases.
- OWNER and WAREHOUSE API fixtures: trusted tenant scope, no cost leakage, current
  Decimal prices/stock, insufficient stock, confirmation and zero writes.
- Backend typecheck, frontend ESLint, backend build and frontend build: PASS.
- Standalone compiled backend artifact: PASS, with byte-identical copied resources
  and no repository source resources or .env dependency.
- Scoped diff/whitespace review: PASS.

Backend has no configured lint script; frontend has no TypeScript configuration
under the current JSX architecture. Checks ran on Node **24.21.0** available
locally. The declared production Node 22 runtime was not verified in this task.
Backend build runs the existing environment-free Prisma **generate** step; it
does not run migrations or connect to a database.

## Performance and remaining limits

Measured on the local machine, after indexing: parser mean **2.24 ms**, p95
**3.20 ms** (300 samples); mocked 1,000-variant matching mean **31.29 ms**, p95
**39.87 ms** (30 samples). Cold import of **all** voice dictionaries averages
**1.10 seconds** (five fresh processes). Added runtime quantity resource bytes:
**1,010,042**. See [QUANTITIES_PERFORMANCE.json](./QUANTITIES_PERFORMANCE.json).

There is no controlled before-change benchmark, so these measurements do not
quantify incremental overhead. Indexes are built once per process; mutable stock
and prices remain freshly read per matching request. Measurements exclude real
database/network latency.

Live Supabase catalog matching: **NOT VERIFIED**. All integration examples use
test doubles; no production database was accessed. Regional/generated alias
quality still benefits from retailer validation. General morphology, unknown
brand transliteration, multi-line orders and complete context handling of all 61
review flags remain outside this integration. The flags are preserved metadata,
not a claim that 61 contextual grammar rules were implemented.

No database/schema/migration, checkout/inventory/accounting, Railway, deployment,
commit, audio provider, microphone or secret changes were made. The protected PDF
was not inspected or touched. Next proposed phase: review observed language
ambiguities with retailers and design explicit unit clarification in the preview
flow; any packaging schema or POS changes require separate authorization.

## Files created

- `backend/src/voice-sales/quantity-source.types.ts`
- `backend/src/voice-sales/quantity-source.ts`
- `backend/src/voice-sales/quantity-parser.ts`
- `backend/src/voice-sales/quantity-source.test.ts`
- `backend/src/voice-sales/QUANTITIES_ACTIVATION.md`
- `backend/src/voice-sales/QUANTITIES_AUDIT.json`
- `backend/src/voice-sales/QUANTITIES_PERFORMANCE.json`
- `backend/resources/voice-sales/quantities.seed.json`
- `backend/resources/voice-sales/quantities.source-collisions.json`
- `backend/resources/voice-sales/quantities.smoke.json`
- `backend/resources/voice-sales/quantities.manifest.json`
- `backend/scripts/audit-voice-quantities.mjs`
- `backend/scripts/benchmark-voice-quantities.mjs`

## Existing files modified

- `backend/src/voice-sales/index.ts`
- `backend/src/voice-sales/parser.types.ts`
- `backend/src/voice-sales/parser.ts`
- `backend/src/voice-sales/parser.test.ts`
- `backend/src/voice-sales/size-parser.ts`
- `backend/src/voice-sales/catalog-matcher.ts`
- `backend/src/voice-sales/matching.test.ts`
- `backend/src/voice-sales/README.md`
- `backend/src/voice-sales/PARSER.md`
- `backend/src/voice-sales/MATCHING.md`
- `backend/package.json`
- `backend/scripts/copy-voice-dictionary-resources.mjs`
- `backend/scripts/verify-voice-dictionary-artifact.mjs`
- `frontend/src/features/voice-sales/text-matching-flow.js`
- `frontend/src/features/voice-sales/text-matching-flow.test.js`
- `frontend/src/features/voice-sales/text-matching-ui.test.js`
- `frontend/src/pages/app/TextMatchingLabPage.jsx`

Existing unrelated working-tree changes were retained. Ignored local test logs,
compiled artifacts and the generated Prisma client are normal check outputs,
not database or deployment changes.
