# Product Types v2 active vocabulary — implementation and audit

STATUS: PASS

User-authorized activation following the imported kit integration. The existing
architecture, schema and project instructions were reviewed; no relevant architecture
conflict or database change was needed. This report supersedes the candidate-only
runtime behavior documented in PRODUCT_TYPES_INTEGRATION.md.

## Audit findings and activation counts

Three earlier restrictions prevented activation: the parser classified new aliases
as seed-review clarification evidence; the matcher required the same literal phrase
in the catalog name; and the legacy ProductType union represented only 15 concepts.
The raw source flags were provenance, not a reason to reject explicitly authorized
language vocabulary. They remain unchanged, along with the original JSON bytes.

Every one of the 2,909 records was classified using the shared runtime normalizer,
preserved source ambiguity relationships, other dictionary domains and legacy context.

| Measure | Result |
| --- | ---: |
| Imported concepts / groups | 343 / 17 |
| Imported alias records | 2,909 |
| Activated alias records | 2,906 |
| Active unambiguous records | 2,792 |
| Active context-dependent records | 114 |
| Blocked unsafe records | 3 |
| Unique active normalized keys | 2,851 |
| Normalized duplicate pairs | 1 |
| Supported source concepts | 343 |
| Concepts with active Arabic and Latin-script equivalents | 343 |
| Unsupported source concepts | 0 |
| Source ambiguity relationships retained | 55 |
| Runtime context collision keys retained | 56 |
| Legacy canonical IDs retained / exact compatibility mappings | 15 / 14 |

Counts refer to records, not distinct spellings or lookup keys. The duplicate pair
`جاكيت جلد` / `جاکيت جلد` remains two original LEATHER_JACKET records under one key.
All source IDs retain their exact spelling, including MODest_TUNIC. The 329 concepts
without a legacy mapping are now usable typed identities; they are not coerced into
unrelated broad categories. Arabic/Latin equivalence is measured from active aliases;
French and Arabizi examples also exercise the same exact pipeline.

Every blocked record:

| Source ID | Alias | Reason |
| --- | --- | --- |
| BODYSUIT | بدي | WANT conversational expression collision |
| BODYSUIT | bdi | WANT conversational expression collision |
| BODYSUIT | baddi | WANT conversational expression collision |

These three remain stored in source provenance but never produce product-type tokens.
They still work as existing conversational expressions. No source record was deleted.

## Dictionary, parser and matching implementation

`activeProductTypes` is an immutable registry built once per backend process. It
overlays imported aliases on the source index, preserving legacy context and aliases.
Indexes and alias results are private/frozen; unknown input is not cached indefinitely.
It uses the existing NFKC, Arabic letter/diacritic, digit, case and whitespace
normalization, exact lookup and whole-token longest-phrase matching. No fuzzy or
substring product matching was added. Unverified spellings outside the authorized
seed remain suggestions or unknown. The original seed's reviewStatus remains
seed_review as provenance; registry authorization is user_authorized_vocabulary.

Parser changes are additive: `sourceProductType?: ParsedAttribute<SourceProductTypeId>`
supports every source ID while the existing eight attributes and legacy ProductType
API remain intact. Unambiguous aliases resolve directly; context-dependent aliases
keep null values and typed alternatives. Span evidence preserves phrase boundaries
and original source provenance. The old requiresCatalogEvidence flag is retained
as false for compatibility: ordinary real catalog proof is still required, but
same-spelling seed review no longer gates recognition. Full garment phrases own
their lexical spans, including No Show Socks / بلا أكمام and two piece set; those
phrases do not become cancellation or a requested quantity. Outside a recognized
phrase, negation and ambiguous bare numbers still require clarification.

The matcher normalizes actual authenticated tenant Product.name and Category.name
through the same source concepts. Definite concepts become identity atoms. An
ambiguous request may narrow only against independently definite catalog name or
category evidence; the same ambiguous spelling alone does not choose a meaning.
Category evidence is labeled category_name in the response. No taxonomy hierarchy,
audience column, material column or invented variant is assumed.

Unknown brand/model words must still be supported in their spoken order, and actual
name atoms must be covered. Generic type equivalence cannot erase Classic, Polo,
Oversized or unknown brands. Explicit descriptors remain constraints: the shared
qualified-alias helper preserves WOOL from كنزة صوف, verifies it against actual
name evidence, and leaves an unqualified Sweater catalog name incomplete for that
request. Product/variant uniqueness, explicit color/size/quantity, current Decimal
selling price, current stock, catalog coverage limits and confirmation remain required.
Price or stock is never a meaning/variant tiebreaker.

## Ambiguity handling

بودي preserves BABY_ONESIE/BODYSUIT; كولون preserves LEGGINGS/TIGHTS; كيلوت
preserves MEN_BRIEFS/PANTIES; robe preserves DRESS/ROBE_HOME. All 55 imported
relationships are tested for recognition and safe non-selection. Existing كنزة
context also remains SWEATER/TOP rather than being overwritten by a source singleton.
Polo remains a product/collar overlap and جينز a product/material overlap. Explicit
collar/fabric contexts do not create a product identity. Multiple plausible real
variants return AMBIGUOUS; inadequate evidence returns INCOMPLETE, never a first-entry
choice. Parser ambiguity stays visible even when the catalog independently narrows it.

## Before / after examples (mock catalogs only)

All complete examples below include black, XL and an explicit quantity of two.

| Request → actual catalog name | Earlier behavior | Active behavior |
| --- | --- | --- |
| chemise → Shirt | INCOMPLETE: missing literal seed proof | MATCHED: SHIRT concept |
| بودي → Bodysuit | INCOMPLETE: missing literal seed proof | MATCHED: independent BODYSUIT name evidence |
| robe → Dress | INCOMPLETE: missing literal seed proof | MATCHED: independent DRESS name evidence |
| بنطلون كارغو → Cargo pants | Passive unmapped concept | MATCHED: CARGO_PANTS concept |
| بودي → بودي, category Baby onesie | No active source identity | MATCHED: independent category proof |
| robe → robe, generic category | Literal-only path could choose one variant | INCOMPLETE: meaning still ambiguous |
| robe → Dress AND House robe | Passive source review | AMBIGUOUS: two supported real meanings |
| chemise → Shirt Cedar, no spoken Cedar | Unverified name | INCOMPLETE: model still missing |

`t chirt orange kt3ten` retains the earlier T_SHIRT / ORANGE / quantity 2 result;
size remains missing. That alias fix predates this activation and is not credited
to the imported seed. XL, XXL, XXXL, size 32, bare 32 and explicit 32 pieces remain
distinct under the existing context grammar.

## Runtime artifact and Lab contract

The normal backend build now copies only seed/ambiguity JSON into
dist/resources/voice-sales. Compiled loading prefers these packaged copies; source
and test modules use repository resources. The isolated-artifact test copies only
compiled vocabulary modules and these resources into a synthetic directory with no
source/resources fallback or .env, verifies byte equality, and loads all 343 concepts.
There is no manual tenant upload, approval, database insert or model training.

The development-only Text Matching Lab displays Clothing concept and typed alternatives.
Its response projection accepts the optional source field, validates identifiers,
strips unallowlisted metadata and continues accepting older responses without it.
The Lab remains absent from the production frontend bundle. POS/navigation/checkout
are unchanged.

## Validation

Final local checks:

| Check | Result |
| --- | --- |
| Full backend regression | 1,436 passed / 0 failed |
| Normalization + legacy dictionary | 199 passed |
| Parser | 216 passed |
| Catalog matcher + authorization/API | 88 passed |
| Original source integration/integrity | 80 passed |
| Active registry, exhaustive aliases/concepts and ambiguity flow | 412 passed |
| Other backend regression | 441 passed |
| Full frontend regression, including Lab projection/rendering | 364 passed / 0 failed |
| Backend typecheck / build | PASS / PASS |
| Standalone compiled resource artifact test | 1 passed / 0 failed |
| Frontend ESLint / Vite production build | PASS / PASS |

Every imported alias record is looked up and retains its source ID. Every active
record is parsed; every unambiguous record goes through cross-script mocked catalog
matching (with any separately requested material also supplied in actual fixture
name evidence). All context relationships are tested for safe non-selection. All
343 concepts have an unambiguous tested catalog label. Independently selected safety
cases cover brand/model distinction, missing attributes, explicit quantities,
numeric sizes, multiple items, tenant isolation, role authorization, financial
allowlisting, stock/price freshness, rate limits, zero-write mocks and confirmation.
No backend lint script or frontend TypeScript check exists in the current manifests.

Local informative performance: cold dictionary import 186.45 ms, warm parser median
0.467 ms / p95 0.807 ms after 50 warmups over 500 requests; 1,000 distinct-product
synthetic catalog matcher median 84.81 ms over eight measured runs. The prior report
recorded 136.81 ms / 0.254 ms / 74.48 ms. Those are historical observations, not a
controlled benchmark comparison: workload and machine scheduling differ. Activation
adds source scanning and proof work; indexes/resources load only once, and per-request
profiles are reused across variants. Stock/price are never cached across requests.

## Files created or modified in this activation

Created:
- backend/src/voice-sales/product-type-registry.ts
- backend/src/voice-sales/product-type-activation.test.ts
- backend/src/voice-sales/PRODUCT_TYPES_ACTIVATION.md
- backend/scripts/copy-voice-dictionary-resources.mjs
- backend/scripts/verify-voice-dictionary-artifact.mjs

Modified:
- backend/package.json
- backend/src/voice-sales/index.ts
- backend/src/voice-sales/product-type-source.ts
- backend/src/voice-sales/product-type-source.types.ts
- backend/src/voice-sales/parser.types.ts
- backend/src/voice-sales/parser.ts
- backend/src/voice-sales/catalog-matcher.ts
- backend/src/voice-sales/parser.test.ts
- backend/src/voice-sales/matching.test.ts
- backend/src/voice-sales/README.md
- backend/src/voice-sales/PARSER.md
- backend/src/voice-sales/MATCHING.md
- backend/src/voice-sales/PRODUCT_TYPES_INTEGRATION.md (marked historical)
- frontend/src/features/voice-sales/text-matching-flow.js
- frontend/src/features/voice-sales/text-matching-flow.test.js
- frontend/src/features/voice-sales/text-matching-ui.test.js
- frontend/src/pages/app/TextMatchingLabPage.jsx

Original seed, ambiguity and smoke resources, source-ID union, schema, catalog reader,
matching service authorization and all unrelated working-tree edits are preserved.

## Security and remaining limits

Tests use mocked catalog rows and localhost HTTP servers; real tenant Supabase
catalog behavior is unverified. No database connection, migration, schema change,
production write, stock/accounting/Entry/checkout/POS modification, ElevenLabs,
recording, correction learning, Railway change, deployment or commit was performed.
No credentials were printed or included in audit output. The protected PDF was never inspected or touched.

The source vocabulary remains language metadata, not evidence a store owns a product.
Unrecognized brands/models are not transliterated or guessed. Ambiguous aliases need
adequate catalog evidence; unsupported numeric sizes, complex negation, alternatives
and multi-item sentences keep the existing limitations. Catalog limits and changing
stock/price retain the existing safe advisory behavior. MATCHED always requires user
confirmation and cannot execute a sale. Activation is complete; further live catalog
acceptance testing or parser expansion requires a separate authorized phase.
