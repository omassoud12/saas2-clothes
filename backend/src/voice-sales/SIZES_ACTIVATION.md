# Sizes Dictionary v2 — implementation and acceptance report

## Scope and source verification

The actual extracted `SAAS2_Sizes_Dictionary_Integration_Kit/` was inspected,
including README, integration prompt, QA, manifest, seed, collision resource,
original JSON/CSV and smoke cases. All ten original manifest file hashes matched.
Source TypeScript examples were not executed. The imported resources are data,
not instructions or catalog records. AGENTS.md, ARCHITECTURE.md, the existing
Prisma models and Dictionary/Parser/Matcher/security contracts were inspected.
No directly relevant architecture conflict was found.

All **671 concepts**, **10,448 original alias rows**, **22 families**, **51 declared
ambiguities**, **23 modifiers** and **196 modifier aliases** are retained. Original
source IDs, policy, language, confidence, required context, notes and collision
relationships survive intact. CSV round-trip and SHA-256 checks verify provenance.
The kit calls this expansion v2; its internal seed version remains `1.0-seed`.

## Activation and normalization

| Disposition | Alias rows | Meaning |
| --- | ---: | --- |
| Active exact / lexically unambiguous | 9,484 | Direct exact dictionary evidence; family/unit/system and real variant proof still required |
| Active context-dependent | 940 | Typed alternatives or cross-domain/numeric/generic ambiguity; never first-match selection |
| Blocked as selection proof | 24 | `fuzzy_with_context`; recognized suggestions, not trusted SKU or age-range evidence |
| Total evaluated | 10,448 | Every source row has a disposition in SIZES_AUDIT.json |

These are **record counts**, not distinct spelling counts or automatic sale approvals.
No valid source row is silently discarded. A trusted spelling is not proof the
merchant stocks the size. The fuzzy 24 remain visible as null-valued suggestions.

The existing shared NFKC, Arabic letter/diacritic, Western/Arabic/Persian digit,
case and whitespace normalization stays unchanged. `normalizeSizeText` uses that
same normalizer while locally retaining `/`, `-` and decimal points; Unicode
hyphens and Arabic decimal punctuation are folded locally. Composite scanning
uses original characters before shared punctuation removal, with original
character and normalized token spans. Longest complete suffixes take priority
over a generic `size` prefix. Repeated size cues do not bypass composite parsing.

| Collision audit | Count |
| --- | ---: |
| Unique source-normalized keys | 9,384 |
| Source keys with multiple IDs | 352 |
| Source keys with multiple records | 861 |
| Unique shared-runtime keys | 9,015 |
| Shared-runtime keys with multiple IDs | 352 |
| Local structural keys | 9,778 |
| Local ambiguous keys after preserving source collision relationships | 382 |
| Source keys differing from shared runtime normalization (rows) | 850 |
| Repeated same-ID shared normalized pairs | 954 |
| Exact duplicate raw same-ID/alias pairs | 0 |

The 30 additional local ambiguous spellings preserve declared relationships such
as `US-8` versus `US 8`; punctuation cannot decide apparel versus shoe standards.
`OS` and `فريز` overlap Colors and require explicit size context. All source and
runtime collision inventories, plus every alias disposition, are in the audit JSON.

## Contracts and logic

- `source-size` data is separate from the unchanged 14-value legacy Size union.
  Seven compatible alpha source IDs map to XS/S/M/L/XL/XXL/XXXL; numeric labels do
  not acquire an EU/US/UK meaning merely because the legacy size is `32`.
- `activeSizes.lookup` returns exact source records and typed candidates, or an
  explicit ambiguous/suggestion/unknown result. Modifiers have a separate lookup.
  No substring/fuzzy search or size conversion chart is introduced.
- `sourceSizeId` and `sourceSizeCandidates` are optional additive Parser/API fields.
  Regional sizes require a supported family and explicit regional language or
  independent merchant-column evidence. Physical measurements need stated cm;
  baby/children age concepts need supported month/year language. Missing units,
  conflicting sizes and partial bra/waist/inseam dimensions stay unresolved.
- Exact composition supports verified unit synonyms and EU/US/UK prefixes/suffixes
  over existing source IDs. It creates no replacement source rows. `نمرة 3` in
  tights scope uses the existing T3 concept, rather than treating 3 as sale count.
- A size phrase can own an embedded garment qualifier only when a separate
  surrounding product supports that size family. Contradictory product nouns,
  colors, brands/model names and sale-unit counts cannot be erased to force a match.
- Signs/decimals/ranges are protected only by a grounded original composite span;
  a preceding `-` or `+` cannot disappear into a positive size or quantity.
  Ambiguous known numeric expressions retain alternatives without affirming them.
- The Matcher compares every size constraint against the current **real
  ProductVariant.size string**, using actual Product/Category language evidence.
  An explicit regionless numeric label may equal the merchant's identical numeric
  label without selecting a regional source ID. Explicit regional constraints
  cannot use that exception. Partial bra/waist/inseam dimensions cannot prove a
  complete size. Constraints are never dropped to manufacture MATCHED.
- No `size_standard` database field is assumed. Source concepts are language
  metadata only. Authenticated tenant reads, role guards, financial allowlists,
  Decimal prices, stock/price freshness, capped coverage and confirmation persist.
- POST `/api/voice-sales/match` still accepts only `{text}` with unchanged statuses.
  The development Lab projects/displays only the optional source size attribute;
  raw source metadata is stripped. Existing responses remain accepted. The Lab
  remains excluded from the production frontend bundle.

## Before/after and catalog examples

Before this integration, the legacy 14-size dictionary had no additive 671-ID
registry or delimiter-preserving composite grammar. Existing alpha/count behavior
is preserved; expanded cases now have typed size evidence.

All examples below use synthetic **merchant-column fixtures**, not Supabase data.

| Spoken size in otherwise complete product/color/count request | Parser after | Actual variant label | Matcher |
| --- | --- | --- | --- |
| Tshirt XXL | ALPHA_2XL; legacy XXL retained | 2XL | MATCHED |
| Jeans W32/L30 | JEANS_W32_L30 | W32 L30 | MATCHED |
| Baby Onesie 0-3M | BABY_0_3M | 0-3M | MATCHED |
| Kids Tshirt 5-6Y | KIDS_RANGE_5_6 | 5-6Y | MATCHED |
| Shoes EU 38 | SHOES_EU_38 | EU 38 | MATCHED |
| Shoes 38 | null selected system; alternatives retained | 38 | INCOMPLETE |
| Bra 75B | null selected system; BRA_EU_75_B candidate | 75B | INCOMPLETE |
| Bra EU 75B | BRA_EU_75_B | EU 75B | MATCHED |
| Tshirt size 32 / count 32 pieces | legacy size 32; quantity 32; null regional source ID | 32 | MATCHED |
| Bra cup C | partial BRA_CUP_C | EU 75C | INCOMPLETE |

An independently explicit stored `EU 38` or `EU 75B` can ground an ambiguous
spoken size without mutating the Parser or claiming universal conversions.
Empty/incompatible catalogs, missing count, multiple variants, insufficient stock,
unpriced variants or incomplete coverage cannot produce an unconditional match.

## Audited source fixture corrections

All 24 original cases and 15 extra safety cases are executed, with these written
corrections to proposed source assumptions:

- `صباط 38`: retains SHOES_EU_38 as a candidate; the parser cannot assume EU.
- `سوتيان 75B`: retains the EU composite candidate without assuming the system.
- `قبعة محيط راس 58`: retains HEAD_58CM without inventing a cm unit.
- `لبس بيبي 3 شهور` / `3m`: source 0-3M is only a suggestion, not an invented age
  range or size. Bare child numeric labels cannot silently acquire year units.
- `bdi tshirt m 2ata3`: M is recognized; `2ata3` remains residual terminology.
  The existing quantity dictionary does not establish an explicit count of two
  from that spelling. Quantity vocabulary was not expanded in this Sizes phase.
- Source modifiers such as petite, tall, cm and oversized are not size IDs;
  supported pre-existing Fit parsing continues separately.
- Previous unsupported expectations for `one size`/`one-size`/`قياس واحد` and
  `size 42` were updated because the authorized expansion supports those concepts.
  One-size never becomes quantity one; size 42 never invents a legacy ID or system.

## Files created / modified in this integration

Backend, under `src/voice-sales/`:

- Created: `size-source-ids.ts`, `size-source.types.ts`, `size-source.ts`,
  `size-context.ts`, `size-parser.ts`, `size-matching.ts`, `size-source.test.ts`,
  `SIZES_ACTIVATION.md`, `SIZES_AUDIT.json`, `SIZES_PERFORMANCE.json`.
- Modified: `index.ts`, `parser.types.ts`, `parser.ts`, `parser.test.ts`,
  `catalog-matcher.ts`, `matching.test.ts`, `README.md`, `PARSER.md`, `MATCHING.md`.
- Created byte-identical resources: `resources/voice-sales/sizes.seed.json`,
  `sizes.source-collisions.json`, `sizes.smoke.json`, `sizes.aliases.csv`,
  `sizes.manifest.json`.
- Modified `package.json`, `scripts/copy-voice-dictionary-resources.mjs`,
  `scripts/verify-voice-dictionary-artifact.mjs`; created
  `scripts/benchmark-voice-sizes.mjs`.

Frontend:

- `src/features/voice-sales/text-matching-flow.js`, `text-matching-flow.test.js`,
  `text-matching-ui.test.js`, `src/pages/app/TextMatchingLabPage.jsx`.

Generated ignored test/build/Prisma-client artifacts and logs were produced by
existing local checks. Other pre-existing working-tree changes were not reverted.

## Validation, performance and limits

| Final check | Result |
| --- | --- |
| Full backend regressions | 2,956 / 2,956 PASS |
| Sizes resource/Parser/Matcher tests (included above) | 1,101 / 1,101 PASS; all 671 concepts and 10,448 rows exercised |
| Existing Parser suite | 216 / 216 PASS |
| Matching / read-only API suite | 94 / 94 PASS |
| Full frontend regressions | 370 / 370 PASS |
| Backend typecheck | PASS |
| Frontend lint | PASS |
| Backend and frontend builds | PASS |
| Standalone compiled vocabulary artifact | 1 / 1 PASS |
| Backend lint / frontend typecheck | No existing scripts; frontend architecture is JSX |

Measured on Windows x64 / Node 24.21.0:

| Benchmark | Samples | Mean | Median | p95 |
| --- | ---: | ---: | ---: | ---: |
| Cold import, all voice dictionaries | 5 | 1,073.96 ms | 1,017.36 ms | 1,348.35 ms |
| Warm mixed multilingual parsing | 300 | 1.55 ms | 1.41 ms | 2.64 ms |
| Matching 1,000 synthetic variants | 30 | 38.84 ms | 37.87 ms | 47.44 ms |

Cold heap usage for all vocabulary is approximately 57.8 MiB; this is not a measured
increment attributable only to Sizes. The repository engine targets Node
`>=22.12.0 <23`, but only Node 24 binaries were available locally. Node 22 runtime
acceptance remains unverified; no runtime/deployment configuration was changed.

See SIZES_AUDIT.json for final check counts and SIZES_PERFORMANCE.json for measured
iterations, median/p95, Node/platform and fixture scope. The benchmark measures
all voice dictionaries at cold import, warmed multilingual parsing, and one
product with 1,000 variant fixtures. It excludes DB/network latency and does not
claim a measured speedup over the previous version. Size runtime resources add
4,230,757 bytes. Registries load/index once per process; no per-request JSON reads,
stock/price cache or new unbounded database scan was introduced.

Tests verify all 671 concepts and all 10,448 aliases through lookup and family-aware
Parser contexts, collision alternatives, metadata integrity, actual mock catalog
sizes, OWNER/WAREHOUSE API isolation, price precision, freshness and zero writes.
The standalone compiled artifact is tested without repository source/resources or
an `.env` file. Existing Product Types/Colors and frontend regressions are retained.

**Real authenticated Supabase catalog acceptance testing was not performed.**
No secrets were printed or copied into dictionary resources. A later manual authenticated
development Lab check can verify this tenant's actual labels without writing data.
The source is not a universal conversion chart. Unqualified numeric systems,
partial dimensions, ambiguous age/measurement labels and fuzzy transcriptions may
need clarification or more merchant context. Missing/unknown catalog labels never
cause fabricated variants. No alias learning, provider integration or sale occurs.
Baby source aliases expressed in years, such as the 2-3 years alias for BABY_24_36M,
retain candidates but do not automatically establish a month-labelled size or age/body
equivalence. New size vocabulary embedded in literal product/model names may also
need separate full-name proof; unknown name content is not erased by variant size.

No database/schema/migration, checkout, inventory, accounting, infrastructure,
deployment or commit changes were made. The protected PDF was not inspected or
touched. Stop here; deployment and further dictionary categories remain separate.
