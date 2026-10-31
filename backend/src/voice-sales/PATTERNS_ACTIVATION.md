# Patterns & Prints activation report

STATUS: PASS — local dictionary/parser/catalog/API integration. Live Supabase catalog: **UNVERIFIED**.

## Audited prerequisites and scope

Read AGENTS.md, ARCHITECTURE.md, actual backend/prisma/schema.prisma, existing nine dictionaries, imported registries, parser/span ownership, tenant-scoped catalog reader, matching service/API and development Lab. No directly relevant architectural conflict. Actual Product/Category provide names; ProductVariant provides color/size, Decimal selling price and stock. There is no Pattern/Material/Fit database column.

The current frontend is JSX per ARCHITECTURE.md; it was not converted. This phase is additive to the existing pipeline and does not import the reference standalone parser or Express service.

## Source integrity and coverage

All required files found in SAAS2_Patterns_Prints_Dictionary_Integration_Kit. **21 SHA-256 hashes verified**, including the supplied original archive and exact seed bytes. All seven CSV files validated against source rows/IDs/shared scalar fields. Source foreign keys, declared ambiguity/collision relationships, groups, counts and immutable resources validated; corrupt-resource regression tests fail closed.

Seed hash: 4b74513419dcb04de3203444a6efa6cdc7bb69699015176d5ba06c0a31490050.

| Domain | Concepts | Alias rows | Direct | Context-dependent | Blocked rows |
| --- | ---: | ---: | ---: | ---: | ---: |
| Patterns/prints | 169 | 1219 | 1069 | 150 | 0 |
| Pattern modifiers | 25 | 161 | 0 | 161 | 0 |

All **1,380 source alias rows** were evaluated and remain active, either direct or conditional. Modifiers require a motif target and real catalog proof. All 169 source IDs have separate types; legacy PLAIN/STRIPED/CHECKERED/WAVY identifiers and fields remain compatible. No variant or product is invented.

- plain: 1
- stripes: 12
- checks_plaid: 14
- dots_spots: 9
- floral_botanical: 18
- animal: 14
- geometric: 16
- heritage_ornamental: 20
- abstract_art: 15
- camouflage: 6
- graphics_text: 16
- kids_novelty: 16
- surface_effect: 12

There are **1360 runtime phrase keys**, **13 multi-identity collision keys**, **16 duplicate normalized identity rows**, and **324 normalization differences** from original source keys. Original text/keys/provenance remain unchanged; shared SaaS2 normalization drives every runtime lookup. Duplicates retain source audit rows but deduplicate identities. Collisions expose all alternatives, never first-row selection.

All 23 source ambiguity records are retained. **22 are contextual runtime recognizers**. The source ambiguity phrase **2 → DOT_GENERIC is blocked as unsafe metadata**, because a bare number is not a pattern. It is not one of the 1,380 alias rows. All six source collision relationships remain contextual. One additional contextual feminine alias, مخططة, is grounded in original smoke fixture 32 and does not alter seed counts.

Seed/seed_review and review priorities are source provenance, not independent empirical validation of customer dialect. Conditional aliases remain available; no per-alias Owner approval is required. Exact whole-token/phrase matching uses shared longest-match-first indexing. No fuzzy/substrings determine a complete match.

Cross-domain source row overlaps (rows can overlap more than one domain):

- sizes: 2
- sourceColors: 22
- sourceExpressions: 3
- sourceFitCuts: 5
- sourceMaterials: 11
- sourceNecklines: 4
- sourceProductTypes: 2
- sourceQuantities:modifier_aliases: 1
- sourceQuantities:unit_aliases: 2
- sourceSizes: 10

## Parser and language behavior

Public additive fields: sourcePatternId (typed attribute) and patternCandidates (bounded lexical evidence, role, polarity, attached modifier target). A source candidate cannot bypass existing product/color/size/quantity/material/neckline/fit constraints.

| Input | Outcome |
| --- | --- |
| بدي قميص كاروهات / bdi tshirt karohat | CHECK_GENERIC/Plaid/Tartan/Gingham and applicable source alternatives; no arbitrary winner |
| بدي بلوزة موردة | FLORAL_GENERIC with small/large alternatives; no motif size invented |
| ما بدي منقط بدي مورّد | DOT alternatives excluded; FLORAL alternatives desired; clarification, no affirmative sale or catalog read |
| قميص مخطط بالطول | STRIPE_VERTICAL; no garment size/quantity inferred |
| fustan leopard print | ANIMAL_LEOPARD; size and quantity remain missing |
| bdi tshirt plain black XL two pieces | PLAIN_SOLID / legacy PLAIN, BLACK, XL, quantity 2 |
| small print / oversized print | Motif-scale evidence; no S size or garment fit inferred |
| large dots | DOT_LARGE; no L size |
| two-color print | No quantity inferred; unsupported wording remains unresolved rather than fabricated |
| lace print / jacquard effect / faux embroidery / crocodile print | Appearance only; no physical fabric/composition/leather proof |
| fabric imprimé | Preserves explicit material-domain ownership; no motif stealing |
| Slim Fit Plain | Independent fit and plain pattern both preserved; Fit is not reinterpreted as a marker for Plain |
| size 32 / 32 pieces | Size candidates vs explicit quantity 32; no bare-number size-system assumption |
| XL / XXL / XXXL | Remain distinct exact size identities |

Negation is a conservative bounded clause scan with positive-request resets. Excluded motifs/modifiers cause clarification; no subtraction-based checkout logic is added. Exact plain/no-print phrases can own lexical negation. This is not a full discourse parser.

Independent motifs and repetitions remain visible. All motif constraints must be supported independently. Incompatible plain/printed legacy requests and contradictory attached modifier slots remain blocked. Actual brand/model words retain order and multiplicity; explicit model cues preserve literal words, and an intervening garment resets the cue's scope.

All **40 original scenarios** ran successfully against reviewed SaaS2 contracts. No expected positive/excluded ID was lost. 14 scenarios intentionally retain additional alternatives/owned-domain evidence instead of the reference engine's narrower output. Jeans remains a product/material role; its contextual denim-look alternative does not independently constrain matching. Negative fixtures remain previews requiring clarification. Details for every scenario are in PATTERNS_AUDIT.json.

## Catalog matching before/after

Synthetic tenant fixture: Product.name = Cedar dress leopard print; Category.name = Dress; actual variant Black/XL, Decimal price 25.00, stock 5. Input: Cedar dress ليوبارد black XL two pieces.

- Before this integration: **NOT_FOUND**.
- After this integration: **MATCHED**, actual variant v, quantity 2, requiresConfirmation=true.
- Same product without pattern-name evidence: INCOMPLETE, never a invented pattern column.
- Missing size/quantity/brand, contrary variant constraints, ambiguous catalog labels or truncated coverage: no complete MATCHED result.
- Stock 1 for quantity 2: INSUFFICIENT_STOCK; missing/invalid price cannot complete a match.

Only definite single-ID Product/Category name evidence establishes a motif. Cross-language concepts require the same grounded source ID. Ambiguous actual catalog labels cannot resolve themselves; stock/price never break semantic ties. Attached modifiers must belong to the same actual motif, not a different occurrence or origin.

Existing server-derived Account isolation, ACTIVE OWNER/WAREHOUSE authorization, auth-first validation, strict request body, rate limiting, financial allowlists, read-only queries and fresh stock/Decimal pricing remain unchanged. New API tests verify both roles, tenant B exclusion, rejected client Account IDs, 401, no private costs, fresh stock/prices and zero writes. No checkout/stock/reservation behavior changed.

## API and development Lab compatibility

The two optional fields are additive; old responses still work. Frontend projections allowlist source IDs, roles, polarity, spans and modifiers, reject malformed or contradictory claimed matches, and drop raw audit/internal fields. Lab displays desired/excluded alternatives, modifiers and context warnings without sale/cart controls. It remains lazily development-only. Production-bundle tests confirm the Lab/API code and pattern markers are absent; no production navigation or POS changes.

## Checks

| Check | Result |
| --- | --- |
| Full backend, all imported dictionaries and API/business regressions | 13554/13554, 143 suites, 0 failures/0 skips |
| Focused pattern/material/fit/parser/matcher/API | 5514/5514, 27 suites, 0 failures/0 skips |
| Full frontend | 394/394, 56 suites, 0 failures/0 skips |
| Backend TypeScript typecheck | PASS |
| Frontend lint | PASS |
| Backend production build | PASS |
| Frontend production build | PASS |
| Standalone compiled artifact | 1/1 PASS |
| Scoped diff whitespace review | PASS |

Backend has no lint script; frontend has no TypeScript configuration. Checks ran on Node v24.21.0; target Node 22 deployment runtime was **not** executed. No migration or database connection was needed. Backend build used only Prisma generate with its environment-free generation config.

## Resource packaging and local performance

Two new runtime JSON files total **405181 bytes**. Resources validate/hash/index once on module import, not each request. The production artifact contains exactly **19** whitelisted runtime resources. Standalone synthetic dist import verifies byte-identical resources and parser concepts without source fallback or environment files; source test fixtures/CSV/ZIP/audit reports are excluded.

Paired local warm parser + pure matcher benchmark (150 samples per version): before 5.005 ms mean, after 4.919 ms mean; observed mean delta -0.086 ms. Synthetic 1,000 shared-name variants: 53.09 ms mean; 1,000 distinct names: 1498.20 ms mean. Shared/distinct measurements have no paired prior measurement. Timing is local, machine/load dependent, not a network/production SLA. Distinct-name profiling can take seconds. Prices/stock are not cached across requests.

## Files

Created (14):

- backend/src/voice-sales/pattern-ids.ts
- backend/src/voice-sales/pattern.types.ts
- backend/src/voice-sales/pattern-source.ts
- backend/src/voice-sales/pattern-parser.ts
- backend/src/voice-sales/pattern.test.ts
- backend/src/voice-sales/PATTERNS_AUDIT.json
- backend/src/voice-sales/PATTERNS_PERFORMANCE.json
- backend/src/voice-sales/PATTERNS_ACTIVATION.md
- backend/resources/voice-sales/patterns.seed.json
- backend/resources/voice-sales/patterns.source-collisions.json
- backend/resources/voice-sales/patterns.smoke.json
- backend/scripts/audit-voice-patterns.mjs
- backend/scripts/benchmark-voice-patterns.mjs
- frontend/src/features/voice-sales/pattern-concepts.js

Modified (13):

- backend/src/voice-sales/index.ts
- backend/src/voice-sales/parser.ts
- backend/src/voice-sales/parser.types.ts
- backend/src/voice-sales/catalog-matcher.ts
- backend/src/voice-sales/matching.service.ts
- backend/src/voice-sales/matching.test.ts
- backend/package.json
- backend/scripts/copy-voice-dictionary-resources.mjs
- backend/scripts/verify-voice-dictionary-artifact.mjs
- frontend/src/features/voice-sales/text-matching-flow.js
- frontend/src/features/voice-sales/text-matching-flow.test.js
- frontend/src/features/voice-sales/text-matching-ui.test.js
- frontend/src/pages/app/TextMatchingLabPage.jsx

Ignored local verification scripts, snapshots and logs reside under .tools/ and .test-dist/. Existing unrelated local changes and integration kits were preserved.

## Remaining limits and safety

- Real Supabase tenant catalog matching: **UNVERIFIED**. All catalog/API fixtures were synthetic and tenant-scoped.
- Alias recognition/structural review is not empirical Lebanese/Syrian customer validation.
- Bare material/product/brand aliases retain contextual roles. Generic motifs can require finer catalog evidence. No fabricated fabric composition, motif dimensions, application technique or stock metadata.
- Pattern modifiers attach to adjacent recognized motifs; complex separated modifiers and long discourse need a later context-aware parser phase. Unsupported two-color wording stays unresolved and never implies two sold pieces.
- No schema/migrations or real database/data changes; no inventory/accounting/checkout writes; no microphone/STT/ElevenLabs/OpenAI integration; no Railway changes, deployment or commit; no secrets exposed.
- Protected planing/SaaS2_Clothes_Implementation_Summary.pdf was not inspected, touched or included in verification commands.

Stop after this phase. No deployment or commit was performed.
