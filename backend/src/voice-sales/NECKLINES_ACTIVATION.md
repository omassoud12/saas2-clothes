# Necklines & Collars v2 integration

Implemented in the existing Voice Sales pipeline. No standalone source parser,
route, dependency, database field or checkout behavior was introduced.

## Provenance and source verification

Actual kit: `SAAS2_Necklines_Collars_Dictionary_Integration_Kit/` in the project root.
Read project `AGENTS.md`, `ARCHITECTURE.md`, relevant Prisma models, the supplied
prompt/QA and the actual kit before implementation. Architecture's current JSX
frontend and authenticated Express/Prisma backend remain unchanged.

All seven required kit files exist. `manifest.json` counts independently verified:
92 styles (45 neckline shapes, 47 collar types), 807 style alias records,
38 modifiers, 234 modifier records, 34 declared ambiguities, 18 source fixtures.

Verified hashes:

| Resource | SHA-256 |
|---|---|
| `data/necklines.seed.json` | `0178ce4499f5236e2cdfecc27aad538f84b8a55e9f71931077371affaffe7ddc` |
| Original archived module | `9cbd33faa40defb6684bf025b2af52d7b330851e84aa761c3ffba8e6404f262b` |
| `data/necklines.source-collisions.json` | `ba0d834fe07475af315ffc7b3531b4ece2e0dc075b1e5a6be424b32679667e44` |
| `reference/necklines.smoke-test-cases.json` | `6e662d022bf4b196414367f86a3f93bacd8ff74e1227ae698d444521ee7e19fe` |

Runtime resources are copied byte-for-byte. All source records, descriptions,
review flags and original normalized keys remain intact. The shared normalizer
is unchanged: NFKC, Arabic letter/digit folding, case/whitespace/punctuation
normalization; **ة is preserved** and French accents remain significant.
The standalone module's ة→ه normalizer, heuristic score and Levenshtein matching
were inspected as reference and were not imported.

## Activation and ambiguity

| Source records | Direct lexical activation | Active with context | Blocked literal records |
|---|---:|---:|---:|
| Styles | 684 | 102 | 21 |
| Modifiers | 0 | 234 | 0 |
| Total | 684 | 336 | 21 |

The 21 blocked records contain editorial `|` alternatives. Their concatenation
is not a real spoken phrase. All **42 exact source parts** are registered with
their source identity and alternatives, without importing a folded source key.
This preserves the complete vocabulary while preventing unsafe literal matching.
There are 1,012 effective recognition keys, including declared review phrases
and explicit existing legacy spellings. These supplementary keys do not inflate
the 1,041 original record count.

All 234 modifiers are recognized immediately but require a neck role before
becoming catalog constraints. A general word such as `large`, `loose`, `mesh`
or `zip` must not silently change a size, fit, material or product interpretation.
This is automatic context handling, not a manual Owner approval gate.

Actual project normalization yields:

- Styles: 797 original keys, 10 duplicate keys, 10 multi-style keys.
- Modifiers: **198** original keys, **33** duplicate keys, 3 multi-modifier keys.
  The supplied QA approximation reported 197/34; its counts were recomputed,
  rather than copied into runtime assumptions.
- 14 combined cross-identity/domain collision keys, 43 source records overlapping
  existing dictionary domains, 480 source-normalized/runtime-normalized differences.

All 34 declared relationships remain active, including external roles such as
`PRODUCT_POLO_SHIRT`, `SIZE/OTHER`, `FABRIC_FUR` and `GENERAL_PHRASE`.
An ambiguity table can add alternatives even when an alias row names only one ID.

Examples:

- `قبة V`, `v neck`, `v-neck` → `NECK_V`; no substring matching inside model words.
- `polo` → collar/product alternatives; `polo collar` and `قبّة Polo` explicitly
  identify the collar domain. A product identity must still be supplied separately.
- `قبّة مبرومة` → `COLLAR_RIBBED`, `TRIM_ROLLED`, `NECK_CREW`. The legacy
  `CREW_NECK` field remains available for compatibility, but cannot override these
  typed alternatives in the matcher.
- `قبة عالية` → high/mock/turtle/funnel alternatives. An independently stored,
  unambiguous `funnel neck` name can resolve this; the identical ambiguous label
  or a category named Turtleneck cannot.
- `col roulé` → neck/collar turtleneck alternatives; accents are not silently lost.
- `بدون قبة` retains collarless/round-neck alternatives and its qualified meaning.
  An independent `not`, `مش`, cancellation or alternative still blocks affirmation.
- `قبة V ورول` keeps the connected roll interpretations as constraints, preventing
  an identical literal word in a name from bypassing unresolved neck meaning.

## Parser and real catalog contract

Existing eight attribute fields and canonical IDs remain. New optional fields:
`sourceNecklineShape`, `sourceCollarType`, `necklineCandidates`. Candidate evidence
contains separate typed shapes, collars and modifiers, token spans, external roles,
explicit role and whether the phrase constrains the catalog.

Exact longest phrases own their spans. Existing Product Type compounds retain
ownership of their identity; qualified neck phrases do not create a second garment.
Numeric sizes, XL/XXL/XXXL, explicit order units and two-piece garment sets stay
separate. Unknown brand/model words are preserved. Definite incompatible styles
in one domain and incompatible modifier slots require clarification.

The existing tenant Catalog Reader and API are reused. New neckline/collar/modifier
proof comes **only from independently interpretable actual Product.name text**.
No nonexistent columns or category-only neckline inference were added. Identical
ambiguous labels provide no unique proof. A missing property stays INCOMPLETE;
multiple eligible variants stay AMBIGUOUS. No selection uses price, stock or scores
to choose a linguistic interpretation. MATCHED remains confirmation-required.

Synthetic before/after example, independently stored `Shirt Peter Pan collar`:
`Shirt col Claudine black XL two pieces` was NOT_FOUND before and is MATCHED
after, with `COLLAR_PETER_PAN` product-name evidence. This is not a live store claim.
The audit retains before/after results for all 18 source fixtures. All expected
style memberships survive. Source `expect_review:false` does not override its
own contradictory ambiguity table (round/high/roll/Polo). Bare `2` stays uncertain;
the implementation never invents quantity to satisfy an upstream fixture.

## Files created

- `backend/src/voice-sales/neckline-source-ids.ts` — separate literal TypeScript IDs.
- `backend/src/voice-sales/neckline-source.types.ts` — source, audit and evidence types.
- `backend/src/voice-sales/neckline-source.ts` — pinned hashes, validation, frozen registry.
- `backend/src/voice-sales/neckline-parser.ts` — contextual span ownership using shared matching.
- `backend/src/voice-sales/neckline-source.test.ts` — exhaustive and behavioral regression tests.
- `backend/resources/voice-sales/necklines.seed.json` and `necklines.source-collisions.json`.
- `backend/resources/voice-sales/necklines.smoke.json` — unchanged source/review fixtures, test-only.
- `backend/scripts/audit-voice-necklines.mjs` and `benchmark-voice-necklines.mjs`.
- This report, `NECKLINES_AUDIT.json` and `NECKLINES_PERFORMANCE.json`.

## Files modified

- Backend voice `index.ts`, `parser.types.ts`, `parser.ts`, `catalog-matcher.ts`,
  `matching.service.ts`, `matching.test.ts`, `parser.test.ts`.
- Backend `package.json` test list and existing resource-copy/artifact-verification scripts.
- Frontend voice `text-matching-flow.js`, its tests, `text-matching-ui.test.js`,
  and dev-only `TextMatchingLabPage.jsx`.

Ignored local `.tools/necklines-baseline/` snapshots, diagnostic scripts and scoped
diff support review/measurements only. Existing unrelated working files were preserved.

## Packaging, testing and safety

Resources validate and index once per process, with SHA checks and deeply frozen
records; no disk/JSON rebuilding per sentence. The isolated compiled artifact must
contain exactly 12 allowed runtime JSON files, identical to their source bytes,
and imports with no repository/src/.env fallback. Smoke/audit/QA/source ZIP files
do not enter the artifact. Frontend production exclusion of the dev Lab is tested.

Tenant permissions, ACTIVE Account gating, OWNER/WAREHOUSE access, server-resolved
accountId, fresh prices/stock, Decimal handling and financial response allowlists
remain unchanged. API tests reject other roles/inactive Accounts, verify cross-tenant
isolation, inactive products/variants and no cost leakage. Mock write methods throw;
no database or checkout write is used by this phase.

**STATUS: PASS** (local integration and regression validation).

| Final check | Result |
|---|---|
| Full backend `npm.cmd test` | **8,566/8,566 PASS**, 132 suites, zero failures/skips |
| New neckline-specific tests | **1,274/1,274 PASS**, covering all concepts/records/ambiguities/fixtures |
| Full frontend `npm.cmd test` | **381/381 PASS**, 53 suites |
| Backend `npm.cmd run typecheck` | PASS |
| Frontend `npm.cmd run lint` | PASS |
| Backend `npm.cmd run build` | PASS; local Prisma client generation 7.10.0, no migration or connection |
| Frontend `npm.cmd run build` | PASS; existing production bundle excludes the dev Lab |
| Isolated `node --test scripts/verify-voice-dictionary-artifact.mjs` | **1/1 PASS**, exactly 12 runtime JSON files |
| Source integrity/count/audit script | PASS, 18/18 expected source style memberships preserved |
| Scoped diff review and `git diff --check` | PASS; pre-task snapshots distinguish prior working changes |

One legacy parser expectation was updated deliberately: `قبّة مبرومة` retains
its legacy CREW_NECK value but now reports needs_clarification and typed
ribbed/rolled/crew alternatives, as required by the supplied source. Existing
Product Types, Colors, Sizes, Quantities and Materials exhaustive regressions pass.
The final tests also ensure `shirt neckline` alone describes a style and cannot
invent a Shirt product. Modifier marker tests use a separate Blouse product,
preserving the source distinction between `shirt neckline` and `shirt collar`.

Local timings on Node 24.21.0, measured after final checks:

| Measurement | Runs | Mean | p95 |
|---|---:|---:|---:|
| Common parser, saved previous implementation | 300 | 1.501 ms | 2.312 ms |
| Same sentence, current parser | 300 | 1.537 ms | 2.442 ms |
| New collar sentence | 300 | 3.931 ms | 6.163 ms |
| Matcher, 1,000 variants sharing raw labels | 30 | 37.464 ms | 47.978 ms |
| Matcher, 1,000 distinct raw product labels | 10 | 1,216.031 ms | 1,482.599 ms |
| Cold all-dictionary/parser import | 5 | 1,479.162 ms | 1,680.204 ms |

Observed common-parser mean difference is **+0.036 ms**, not a throughput promise.
No-neck sentences avoid redundant domain scans. Catalog scanning reuses existing
product/legacy spans and keeps name profiles within one request; variant IDs,
prices and stock are not cached across requests. Distinct 1,000-label catalogs
remain a material CPU cost; timings are synthetic, not network/Supabase latency.

The two new runtime resources add **380,326 bytes**. Five cold subprocess samples
with explicit GC show roughly **24.96–24.97 MiB retained heap** and
**99.97–101.32 MiB RSS delta** for the **complete dictionary/parser import**, including
all previous dictionaries and Node module work. These are not the incremental
memory cost of this dictionary; no controlled cold/memory baseline was available.
Exact samples, before/after parser/matching output and measurement limits are in
`NECKLINES_PERFORMANCE.json`; per-record provenance/collisions are in
`NECKLINES_AUDIT.json`. No benchmark uses a database connection or writes.

## Limitations and next proposed dictionary

**Live Supabase tenant catalog verified: NO.** Catalog/API tests use synthetic
read-only doubles. Language labels do not establish physical garment truth,
certification or properties missing from actual merchant data. No new columns,
alias learning or fuzzy final selection. Some short shared terms need explicit
role wording. Incompatible same-slot modifiers are conservatively clarified.

Checks use the installed Node 24.21.0; the production Node 22 target was not
independently exercised. Frontend has no TypeScript/typecheck configuration;
backend has no lint script. Their available checks are run instead.

Next proposed phase: Fit & Style Dictionary v2, subject to separate user approval.
No database/schema/migrations, production writes, POS/checkout/stock/accounting,
ElevenLabs, infrastructure, commits or deployments were changed. Secrets were
neither read nor exposed. The protected PDF was not inspected or touched.
