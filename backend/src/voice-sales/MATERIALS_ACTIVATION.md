# Materials & Fabrics integration

The supplied Materials kit is integrated into the existing TypeScript Dictionary,
Parser, authenticated read-only Matcher and development-only Text Matching Lab.
Architecture, Prisma schema, existing canonical enums and business operations are unchanged.

## Provenance and coverage

Actual extracted source: `SAAS2_Materials_Fabrics_Dictionary_Integration_Kit/`.
All 18 manifest SHA-256 entries pass. All seven original CSV tables are checked
row-by-row and column-by-column against the byte-preserved JSON. Original JSON/XLSX,
notes, locale/source/review metadata and ambiguity records remain unchanged.

| Domain | Concepts | Source alias records | Active | Context-dependent | Blocked |
| --- | ---: | ---: | ---: | ---: | ---: |
| Fabrics/materials | 147 | 1,133 | 1,043 | 90 | 0 |
| Fabric modifiers | 35 | 288 | 0 | 287 | 1 |
| Total | 182 | 1,421 | 1,043 | 377 | 1 |

There are 1,364 distinct normalized keys, 15 fabric groups and all 50 declared
ambiguities. Recognition activates 1,420 source records, including 377 conditional
records; that count does **not** certify dialect quality or actual garment composition.
Before this phase, the legacy Material dictionary contained six canonical values and
17 aliases; it remains intact. The source and modifier registries are additive.

All modifiers lack source review/policy metadata and therefore remain conditional,
but are directly usable with linguistic context and independently supported catalog
label evidence. No per-owner approval gate was added. Fabric records needing review
cannot independently establish a material proof merely by matching themselves.

Only the source modifier alias `100%` (index 286, PURE) is blocked from alias
resolution: normalization yields bare `100`, potentially a quantity/size, and an
unattached percentage cannot identify a fiber. Attached percentages use separate
validated composition syntax and never select PURE automatically.

Actual runtime conflicts are retained:

- `velours`: VELVET / VELOUR.
- `polaire`: FLEECE / POLAR_FLEECE.
- `شمواه`, `شمواة`: SUEDE / FAUX_SUEDE.
- `matelasse`, `matelassé`: QUILTED_FABRIC / QUILTED modifier.

There are 43 repeated same-ID keys, 12 differences from raw source normalization,
and 35 alias records overlapping existing domains. These include legacy Materials,
Product Types/source Product Types, source Colors and source Quantity numbers/modifiers.
Existing Size, Fit, Pattern, Neckline and expression registries were also audited;
they contribute no additional exact cross-domain records under the current normalizer.
Complete per-record reasons and all 50 semantic ambiguity relationships are in
`MATERIALS_AUDIT.json`; the preview collision count alone is not a runtime oracle.

## Implementation and contracts

- `material-source-ids.ts`: source-derived, separate literal TypeScript unions for
  147 SourceMaterialId and 35 SourceFabricModifierId values.
- `material-source.types.ts`: immutable source/provenance, alias audit, lookup,
  parsed phrase and requested composition types.
- `material-source.ts`: hash-pinned loading, validation, deep freezing, once-created
  normalized indexes. Duplicate IDs retain all records; multi-ID keys retain all
  alternatives. Declared semantic alternatives expand the index safely.
- `material-parser.ts`: longest whole-token/phrase scans using shared normalization;
  material cues, model guards, product/color span ownership, and bounded Arabic
  conjunction handling (`قطن وكشمير`). No substring or broad fuzzy matching.
- `parser.ts`: optional `sourceMaterial`, `materialCandidates` and
  `materialComposition`, preserving old Material/Fit/Pattern fields and canonical IDs.
- `quantity-parser.ts`: optional protected spans prevent construction/modifier
  phrases (4-way stretch, double face) from becoming quantity commands.
- `catalog-matcher.ts`: real Product/Category label evidence supports descriptor
  constraints. Independently verified subtype evidence may narrow ambiguity.
  Price, stock, color, size, full name/model and coverage checks remain mandatory.
- `matching.service.ts`: material-only residual words cannot select an item;
  existing authentication and clarification gates still precede catalog reads.
- Text Lab projects only bounded safe summaries and marks composition unverified.
  Resource/alias rows and private extra fields are excluded from presentation state.

Existing product-type compound aliases retain ownership: an existing phrase like
Oxford Shirt does not automatically add an independent inventory-material claim.
Catalog compound evidence can support an explicit material request when the actual
name and independent category agree. Unknown brand/model words remain literal,
ordered name constraints. Model-prefixed vocabulary such as `Model Modal` is not
silently consumed as fabric.

Satin is separate from Silk; Stretch is a modifier, not Elastane. Unqualified leather,
suede, velvet/velour, Lycra and other declared ambiguities retain candidates. Label
matching cannot prove genuine leather, certification, sourcing, coating or fiber
percentages. Such specifications stay unresolved because the actual schema has no
material/composition/certification fields. Materials never invent a real SKU.

Composition supports integer 0–100 percentages directly before/after an explicitly
named component, including Arabic/Persian digits. `cotton 95% elastane 5%` and
`95% cotton + 5% elastane` preserve requested components; signed, fractional,
out-of-range or unbound percentages require clarification. Every composition record
has `catalogVerified: false`; the service blocks sale matching until supported data
exists. This is intentionally not a full blend/composition parser.

## Examples (synthetic catalog, no Supabase connection)

The saved pre-integration parser and pure catalog matcher returned INCOMPLETE for
`Tshirt fabric coton black XL two pieces` against Cotton T-Shirt (`coton` remained a
literal residual). After integration it returns MATCHED with COTTON label evidence;
the authenticated service/API regression verifies that same result. This before/after
rehearsal is synthetic, with no Supabase access.

| Input / stored catalog | Result |
| --- | --- |
| Tshirt fabric coton black XL two pieces / Cotton T-Shirt | MATCHED, quantity 2, COTTON label evidence, confirmation required |
| Same input / T-Shirt without material evidence | INCOMPLETE, unresolved material |
| Tshirt fabric مخمل black XL two pieces / Velvet T-Shirt | MATCHED using independent VELVET subtype wording |
| Same input / مخمل T-Shirt | INCOMPLETE; ambiguous catalog spelling is not independent subtype proof |
| مخمل request / both Velvet and Velour T-Shirt variants | AMBIGUOUS |
| Coton request with XXL / actual XL | NOT_FOUND; explicit size is preserved |
| Cotton 95% + Elastane 5% request | INCOMPLETE; composition unverified, no catalog query |
| mesh size XL two pieces | INCOMPLETE; material vocabulary alone cannot identify a product |

## Source fixture reconciliation

All 21 original fixtures and 15 additional safety fixtures are preserved and tested.
20 original cases agree exactly on IDs and attached percentages. SRC_010 expects
only POLAR_FLEECE for `pijama polaire`, contradicting the same source's explicit
FLEECE/POLAR_FLEECE ambiguity. Both alternatives remain visible; the fixture itself
was not changed. The single-item parser may also require an explicit fabric cue for
such a cross-role garment expression. No forced MATCHED or false 21/21 literal claim.
Source slot labels are mapped to existing descriptor concepts/groups; there is no
new certified composition or universal garment-grammar contract.

## Files

Created:

- `backend/src/voice-sales/material-source-ids.ts`
- `backend/src/voice-sales/material-source.types.ts`
- `backend/src/voice-sales/material-source.ts`
- `backend/src/voice-sales/material-parser.ts`
- `backend/src/voice-sales/material-source.test.ts`
- `backend/src/voice-sales/MATERIALS_ACTIVATION.md`
- `backend/src/voice-sales/MATERIALS_AUDIT.json`
- `backend/src/voice-sales/MATERIALS_PERFORMANCE.json`
- `backend/resources/voice-sales/materials.seed.json`
- `backend/resources/voice-sales/materials.source-collisions.json`
- `backend/resources/voice-sales/materials.smoke.json`
- `backend/scripts/audit-voice-materials.mjs`
- `backend/scripts/benchmark-voice-materials.mjs`

Modified:

- `backend/src/voice-sales/index.ts`
- `backend/src/voice-sales/parser.types.ts`
- `backend/src/voice-sales/parser.ts`
- `backend/src/voice-sales/quantity-parser.ts`
- `backend/src/voice-sales/catalog-matcher.ts`
- `backend/src/voice-sales/matching.service.ts`
- `backend/src/voice-sales/matching.test.ts`
- `backend/src/voice-sales/README.md`
- `backend/package.json`
- `backend/scripts/copy-voice-dictionary-resources.mjs`
- `backend/scripts/verify-voice-dictionary-artifact.mjs`
- `frontend/src/features/voice-sales/text-matching-flow.js`
- `frontend/src/features/voice-sales/text-matching-flow.test.js`
- `frontend/src/features/voice-sales/text-matching-ui.test.js`
- `frontend/src/pages/app/TextMatchingLabPage.jsx`

Ignored local baselines/logs and generated build/test output support review only.
Only the two immutable runtime material JSON resources enter the ten-resource backend
build allowlist. CSV/XLSX, smoke fixtures, audit reports and original kits are not
required by the standalone compiled backend. No source fallback exists in the
isolated artifact smoke tree.

## Verification and limitations

Final checks:

- Full backend: **7,286 / 7,286**, 127 suites, no skips or failures.
- New material suite: 1,723 tests, including every 1,421 alias record, all concepts,
  all 50 ambiguity records, 21 original cases and 15 safety cases.
- 18 additional matching/API regressions: role/tenant separation, independent
  evidence, ambiguous/subtype/unsupported specification outcomes, name, size,
  stock, price, catalog coverage and no-write behavior.
- Full frontend: **377 / 377**, including four new projection/rendering regressions.
- Backend TypeScript typecheck: PASS.
- Frontend ESLint: PASS.
- Backend build: PASS (Prisma Client 7.10.0 generation is local; no migration/DB call).
- Frontend Vite build: PASS; the existing production Lab exclusion test passes.
- Standalone compiled artifact smoke: **1 / 1**, ten byte-identical whitelisted
  resources, no src/.env/source-folder fallback.
- Manifest/CSV audit and scoped diff/whitespace review: PASS.

Local measurements (Node 24.21.0, observational):

| Measurement | Samples | Mean | p95 |
| --- | ---: | ---: | ---: |
| Saved original warm parser, common sentence | 300 | 1.20 ms | 1.97 ms |
| New warm parser, same sentence | 300 | 1.38 ms | 1.76 ms |
| New material sentence parser | 300 | 2.79 ms | 4.41 ms |
| 1,000 synthetic variants, shared raw name/category | 30 | 32.68 ms | 36.93 ms |
| 1,000 synthetic variants, distinct names | 10 | 588.90 ms | 743.69 ms |
| Cold import, entire voice pipeline | 5 | 1,268.86 ms | 1,320.34 ms |

The observed common-parser mean difference is +0.18 ms. Warm baseline was saved
before this integration and transpiled unchanged against the unchanged legacy
dictionaries. There is no controlled cold-import baseline. The two runtime material
resources add 435,452 bytes (about 425 KiB). Pure profiles are shared for identical
raw name/category labels within one request; distinct variants, stock and prices
remain separate and fresh. The distinct-label scan shows the current worst-case
local cost at the existing 1,000-variant coverage bound; it is not a production load
test or a promise of Supabase latency.

See `MATERIALS_PERFORMANCE.json` for full measurements, resource sizes and the saved
before/after example. Backend has no lint script; frontend has no
TypeScript configuration, consistent with ARCHITECTURE.md. Local checks run under
Node 24.21.0; production's Node 22 engine was not rehearsed for this integration.

No live Supabase catalog test was performed. Tests use authenticated synthetic API
fixtures and tenant-scoped read-only mocks. Real unknown merchant brands cannot be
pre-enumerated or linguistically certified from this kit. Some cross-role or noisy
expressions require explicit cues or clarification.

No database/schema/migration, Entry, checkout, inventory, accounting, microphone,
Railway/Netlify, deployment or commit operation was performed. No secrets were read
or exposed. The protected implementation-summary PDF was not inspected or touched.
