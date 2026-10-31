# Fits & Cuts integration — STATUS: PASS

Implemented from the actual `SAAS2_Fits_Cuts_Dictionary_Integration_Kit.zip` in the project root. The archive was inspected and extracted into the matching folder. AGENTS.md, relevant architecture/model contracts, existing dictionary/parser/matcher, authenticated catalog reader, API and development Lab were reviewed. No directly relevant architecture conflict was found. Fits and cuts remain language concepts, not database columns.

## Source integrity and activation

All 16 manifest-listed files passed SHA256 verification. The runtime seed and collision JSON were copied byte-for-byte and also have runtime integrity checks. Unique IDs, axis membership, counts, alias foreign keys, modifier slots, source collision references and ambiguity references are validated before indexing. The original upstream archive hash is retained as provenance; that separate original archive was not independently available or verified.

| Domain | Concepts | Source alias records | Direct | Context-dependent | Blocked |
|---|---:|---:|---:|---:|---:|
| Styles/cuts | 144 | 1,278 | 302 | 976 | 0 |
| Modifiers | 10 | 67 | 0 | 67 | 0 |
| Total | 154 | 1,345 | 302 | 1,043 | 0 |

All 1,345 source alias records are active recognizers. Conditional recognition never means unconditional catalog proof or checkout authorization. All 961 style aliases marked `review` retain that risk flag and require garment/catalog context. The additional 15 conditional standard aliases have cross-domain or identity conflicts. No per-alias Owner approval is required. No empirical dialect-validation claim is made for this curated source.

The audit preserves all 26 ambiguity notes, 10 declared collisions and 36 reference cases. There are 10 runtime collision keys, 122 cross-domain alias records, 219 differences between source normalized metadata and the actual project normalizer, no duplicate normalized identity records, and no concept alias-count discrepancies. Raw aliases always pass through the shared normalizer; source normalized_key never replaces that process. All nine domains retain their IDs:

| Axis | Concepts |
|---|---:|
| fit | 19 |
| leg_cut | 27 |
| silhouette | 30 |
| waist_rise | 8 |
| length_cut | 16 |
| sleeve_cut | 15 |
| shoulder_cut | 4 |
| hem_cut | 10 |
| construction_detail | 15 |

Detailed record classifications, cross-domain relationships, source fixture outcomes and reasons are in `FITS_CUTS_AUDIT.json`.

## Implementation and behavior

`activeFitCuts.lookup` and `matchTokens` use an immutable module-level index, exact whole-token phrases and longest matches. Typed `sourceFitCuts` adds separate per-axis attributes; `fitCutCandidates` carries alternatives, normalized token spans, role, polarity and modifier attachment. Existing canonical fit IDs and parser/API fields remain available. Ambiguous legacy words such as واسع and ضيق now keep their legacy candidate without forcing its value.

Modifiers remain separate evidence: intensity, polarity, fabric property, relative position and target area. They need an attached descriptor and independent catalog evidence. Repeated equivalent descriptions are retained; conflicting definite descriptions within an axis or modifier target require clarification. Product compounds, colors, sizes, materials and necklines preserve phrase ownership. Explicit brand/model cues preserve literal names, including a real model named Oversized.

The matcher verifies requested descriptors against uniquely interpretable actual Product.name/Category.name text. It preserves every independent axis, modifier, brand/model and existing type/color/size/quantity/material/neckline constraint. Missing cut evidence yields INCOMPLETE; contrary verified evidence rejects the candidate. Ambiguous catalog labels cannot prove a chosen interpretation. No fit field or variant is invented. A unique real eligible variant, explicit quantity, applicable exact color/size, valid price, stock and complete catalog coverage remain required. Every result requires confirmation.

Negated descriptions are displayed separately and excluded from affirmative attributes. For `ما بدي سكيني بدي بوت كت`, Skinny is negated and Bootcut remains a visible positive alternative; the sentence requires clarification and cannot become a sale preview. This does not introduce a full clause-level negation/exclusion execution engine.

## Before/after examples — synthetic catalog, not Supabase

Fixture: one actual mocked variant named `Cedar jeans wide leg high waist`, category Jeans, color Black, size W32/L30, Decimal price 25.00, stock 5.

| Input | Before | After |
|---|---|---|
| Cedar jeans wede leg 5ser 3ale black W32/L30 two pieces | NOT_FOUND | MATCHED advisory; LEG_WIDE + RISE_HIGH + quantity 2 + JEANS_W32_L30 |
| Same complete request in English | MATCHED via literal words | MATCHED with typed axis evidence |
| bdi jeans wide leg high waist | No typed cut attributes; INCOMPLETE | LEG_WIDE + RISE_HIGH; still INCOMPLETE without color/size/quantity/name completeness |
| fustan mermaid maksi | No typed cut attributes | SIL_MERMAID + LEN_MAXI; no invented catalog match |
| bdi kenze oversaiz | No extended fit recognition | FIT_OVERSIZED; no assumed size/quantity or product |
| ما بدي سكيني بدي بوت كت | Existing negation gate blocks sale | Explicit negative/positive cut evidence; still blocked pending clarification |

Removing the cut descriptors from the fixture's actual catalog name produces INCOMPLETE with an unresolved fit constraint. Changing requested color/size, reducing stock, removing price, duplicating eligible variants or truncating coverage cannot produce a valid MATCHED result.

All positive expected concept IDs from the 36 reference cases are recognized. Four cases intentionally expose additional safe alternatives: سكيني includes SUPER_SKINNY; بليسيه includes construction PLEATS; قصة واسعة also includes LEG_WIDE; كولون سليب displays the potential SIL_SLIP role while preserving product ownership and uncertainty. The standalone source parser's single-ID expectations do not override the kit's ambiguity notes or existing project safety.

Important retained conflicts include Skinny/product classes, pleated silhouette/construction detail, wide overall fit/leg/sleeve, petite/tag sizes, relaxed/neckline modifiers, stretch/material properties and generic fit/request expressions. Their source relationships are inspectable; the implementation never chooses by array order, stock or price.

## API, security and development Lab

The existing endpoint is unchanged; its response gains optional typed cut fields. New public cut evidence contains no raw audit rows or internal resource paths. The Lab validates IDs per axis and bounds candidate lists, keeps old responses compatible, displays roles/polarity/alternatives, and rejects confirmed previews carrying negated styles or conflicting axes. Production bundle tests verify Lab code and its cut vocabulary do not ship.

Authentication, server-resolved Account isolation, ACTIVE OWNER/WAREHOUSE restrictions, bounded read-only catalog selection and private cost/profit omission remain unchanged. API tests verify both roles, Account A/B isolation, freshness of Decimal prices/stock, unauthenticated rejection, client accountId rejection, zero writes and no stock mutation.

## Validation results

| Check | Result |
|---|---|
| New Fits & Cuts tests, including every source alias | 1,708 passed |
| Focused dictionary/parser/matcher/API/Product Types/Necklines regressions | 3,756/3,756 passed, 27 suites |
| Full backend suite | 11,833/11,833 passed, 139 suites; no failures/skips/cancellations |
| Full frontend suite | 390/390 passed, 55 suites |
| Backend typecheck and final production/test TypeScript compilation | PASS |
| Frontend ESLint | PASS |
| Backend build, Prisma Client generation only | PASS |
| Frontend production build | PASS |
| Standalone compiled resource artifact | 1/1 passed; exactly 17 allowlisted runtime JSON resources |
| Scoped diff review / whitespace check | PASS |

Backend has no lint script; frontend is architecture-authorized JSX and has no TypeScript configuration. No unavailable check is reported as passed. Verification used Node 24.21.0; the production Node 22 target was not exercised in this integration.

## Packaging and measured performance

The two new runtime JSON files total 372,602 bytes and are copied explicitly into compiled backend resources. Smoke fixtures, QA, CSV, ZIP and audit documents are excluded. Integrity validation, JSON parsing and indexing occur once at module initialization, not on each matching request. Stock and price are never cached between requests.

Local synthetic paired benchmark: 200 alternating warmed parser+pure-matcher samples per version on the same descriptor-free catalog. Mean before 2.486 ms, after 2.581 ms, delta +0.094 ms; p95 before 3.630 ms, after 3.495 ms. Current 1,000 variants sharing a label average 58.7 ms; 1,000 distinct descriptor-bearing labels average 2,727 ms over five samples. This distinct-name cost remains a limitation; it is not an incremental before/after measurement or a production SLA.

Single cold subprocess observations for whole dictionary imports: before 1,537 ms / 26.27 MiB retained heap delta; after 1,745 ms / 27.96 MiB. These are exploratory samples, not production startup benchmarks. Measurements and methodology are in `FITS_CUTS_PERFORMANCE.json`; the comparison uses the locally captured pre-task modules.

## Files created

- `backend/src/voice-sales/fit-cut-ids.ts`
- `backend/src/voice-sales/fit-cut.types.ts`
- `backend/src/voice-sales/fit-cut-source.ts`
- `backend/src/voice-sales/fit-cut-parser.ts`
- `backend/src/voice-sales/fit-cut.test.ts`
- `backend/src/voice-sales/FITS_CUTS_ACTIVATION.md`
- `backend/src/voice-sales/FITS_CUTS_AUDIT.json`
- `backend/src/voice-sales/FITS_CUTS_PERFORMANCE.json`
- `backend/resources/voice-sales/fits-cuts.seed.json`
- `backend/resources/voice-sales/fits-cuts.source-collisions.json`
- `backend/resources/voice-sales/fits-cuts.smoke.json` (test/reference only)
- `backend/scripts/audit-voice-fit-cuts.mjs`
- `backend/scripts/benchmark-voice-fit-cuts.mjs`
- `frontend/src/features/voice-sales/fit-cut-concepts.js`

## Files modified

- `backend/src/voice-sales/index.ts`
- `backend/src/voice-sales/parser.ts`
- `backend/src/voice-sales/parser.types.ts`
- `backend/src/voice-sales/catalog-matcher.ts`
- `backend/src/voice-sales/matching.service.ts`
- `backend/src/voice-sales/parser.test.ts`
- `backend/src/voice-sales/matching.test.ts`
- `backend/package.json` (test list only)
- `backend/scripts/copy-voice-dictionary-resources.mjs`
- `backend/scripts/verify-voice-dictionary-artifact.mjs`
- `frontend/src/features/voice-sales/text-matching-flow.js`
- `frontend/src/features/voice-sales/text-matching-flow.test.js`
- `frontend/src/features/voice-sales/text-matching-ui.test.js`
- `frontend/src/pages/app/TextMatchingLabPage.jsx`

The extracted kit and ignored `.tools`/`.test-dist` diagnostics are local supporting artifacts. Existing unrelated changes were preserved. Architecture, schema, original dictionaries and checkout/inventory/accounting implementations were not edited.

## Remaining limits and safety

- No live Supabase tenant catalog matching was verified; all catalog/API tests use mocks.
- Merchant names must supply independent descriptor evidence; generic or ambiguous stored labels remain unresolved.
- Context and modifier attachment use bounded lexical cues and immediate adjacency, not a complete conversation/negation parser. Multiple-item requests stay unsupported.
- Dialect review flags remain meaningful. No fuzzy or substring mapping can authorize a final match.
- Distinct-name catalog normalization is comparatively expensive and needs separate profiling before a latency guarantee.
- No database/schema/migration/data changes, inventory/checkout/accounting changes, external AI/audio integration, Railway changes, deployment or commit. No secrets were read or exposed. The protected PDF was never inspected or touched.

Stop after this integration. A future refinement of context/negation and catalog-profile performance needs a separately scoped request.
