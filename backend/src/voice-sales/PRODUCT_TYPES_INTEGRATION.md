# Product Types v2 integration report

Historical candidate-only integration report. Runtime activation is now implemented;
see [PRODUCT_TYPES_ACTIVATION.md](./PRODUCT_TYPES_ACTIVATION.md) for current behavior,
counts and validation. The original resource integrity audit below remains applicable.

STATUS: PASS

Implemented from `SAAS2_Product_Types_Integration_Kit (1)/`, without renaming the supplied kit. AGENTS.md, relevant architecture and schema, original kit instructions, QA report, smoke fixtures and existing engine contracts were reviewed before edits. No directly relevant architecture conflict or substantive engine redesign was required.

## Source integrity and before/after counts

| Measure | Before | After |
| --- | ---: | ---: |
| Trusted parser canonical ProductType values | 15 | 15 |
| Trusted Product Types aliases | 50 | 50 |
| Trusted contextual/suggestion aliases | 7 / 1 | 7 / 1 |
| Source candidate concepts | 0 | 343 |
| Original source alias records | 0 | 2,909 |
| Source IDs with an exact canonical compatibility mapping | 0 | 14 |
| Unmapped source IDs, retained as candidate evidence | 0 | 329 |
| Seed aliases promoted to trusted mappings | 0 | 0 |

All 343 IDs are unique. All 2,909 records retain raw text, sourceNormalized, locale, provenance, matchPolicy and seed_review status. The resource retains Arabic/English labels, groups, audience hints, notes, original source metadata and safety policy. The original JSON resources were copied byte-for-byte; SHA-256 tests pin seed, ambiguity and smoke resources. Original source ZIP/JSON historical SHA metadata is preserved, not represented as independently reverified original archive content. There are 2,799 exact_candidate and 110 require_context records. There are 17 source groups; these are not new dictionary domains. Audience reference vocabulary is not wired into a parser.

## Compatibility strategy

The existing ProductType union and dictionary APIs remain intact. `productTypeSource` is a separate frozen exact-candidate index. Source IDs never replace parser IDs; no narrower audience/style concept is coerced into a generic canonical value.

| Source ID | Existing canonical ID |
| --- | --- |
| TSHIRT | T_SHIRT |
| POLO | POLO_SHIRT |
| JEANS | JEANS |
| PANTS | PANTS |
| BODYSUIT | BODYSUIT |
| SWEATER | SWEATER |
| DRESS | DRESS |
| LEGGINGS | LEGGINGS |
| TIGHTS | TIGHTS |
| BRA | BRA |
| HOODIE | HOODIE |
| JACKET | JACKET |
| SHIRT | SHIRT |
| TOP | TOP |

Other source types, including BABY_ONESIE, ROBE_HOME, MEN_BRIEFS, PANTIES and style-specific types, have canonicalType null. They remain available through optional additive `parser.productTypeCandidates` evidence. A catalog can still be identified by a unique, literal current product name without claiming a canonical interpretation for these IDs. No product or variant record is embedded or invented.

## Collision audit

The actual project normalizer changes 516 source keys and yields 2,854 runtime keys. One same-type duplicate pair merges `جاكيت جلد` / `جاکيت جلد` (LEATHER_JACKET); both original alias records are retained. There are 55 source collision keys, 54 raw runtime cross-type collision keys, and no newly induced cross-type collision from normalization.

Source normalization collapses ة into ه while the project intentionally preserves ة. All 55 declared ambiguity relationships are reconnected through original aliases whose sourceNormalized identifies those relationships. This yields 56 context-preserving runtime collision keys; source normalized strings are not registered as invented aliases. No candidate is selected by array order.

| Runtime key with preserved ambiguity | Source candidate IDs |
| --- | --- |
| بلوزة | BLOUSE, TOP |
| قميص رسمي | DRESS_SHIRT, SHIRT |
| بودي | BABY_ONESIE, BODYSUIT |
| بادي | BABY_ONESIE, BODYSUIT |
| body | BABY_ONESIE, BODYSUIT |
| bodi | BABY_ONESIE, BODYSUIT |
| bady | BABY_ONESIE, BODYSUIT |
| shrug | BOLERO, SHRUG |
| بلوزة كورسيه | BASQUE, CORSET_TOP |
| توب كورسيه | BASQUE, CORSET_TOP |
| corset top | BASQUE, CORSET_TOP |
| بنطلون ترينينغ | SWEATPANTS, TRACK_PANTS |
| track pants | SWEATPANTS, TRACK_PANTS |
| كولون | LEGGINGS, TIGHTS |
| kolon | LEGGINGS, TIGHTS |
| koulon | LEGGINGS, TIGHTS |
| sarouel | HAREM_PANTS, SHERWAL |
| robe | DRESS, ROBE_HOME |
| quilted jacket | PUFFER_JACKET, QUILTED_JACKET |
| gilet | PUFFER_VEST, VEST |
| كاب | BASEBALL_CAP, CAPETOP |
| طقم متناسق | COORD_SET, TWO_PIECE_SET |
| co ord set | COORD_SET, TWO_PIECE_SET |
| chemise de nuit | CHEMISE_LINGERIE, NIGHTGOWN |
| nuisette | CHEMISE_LINGERIE, NIGHTIE |
| بيجاما وصل | BABY_SLEEPER, ONESIE_ADULT |
| شحاطة | SLIDES, SLIPPERS_HOME |
| bralette | BRA, BRALETTE |
| كيلوت | MEN_BRIEFS, PANTIES |
| كلوت | MEN_BRIEFS, PANTIES |
| كيلوتات | MEN_BRIEFS, PANTIES |
| kilot | MEN_BRIEFS, PANTIES |
| kelot | MEN_BRIEFS, PANTIES |
| string | G_STRING, THONG |
| g string | G_STRING, THONG |
| مايو رجالي | MEN_TANK_UNDER, SWIM_TRUNKS |
| كولون نايلون | PANTYHOSE, TIGHTS |
| paréo | BEACH_COVERUP, SARONG |
| طقم مولود | BABY_NEWBORN_SET, BABY_SET |
| فستان بنوتة | BABY_DRESS, GIRLS_DRESS |
| يونيفورم | SCHOOL_UNIFORM, WORK_UNIFORM |
| مريول مدرسة | SCHOOL_APRON, SCHOOL_UNIFORM |
| مريول | APRON, SCHOOL_APRON |
| جلابة | JALABIYA, JILBAB |
| جلابيه | JALABIYA, JILBAB |
| djellaba | JALABIYA, JILBAB |
| ايشارب | HIJAB_SCARF, SCARF |
| فوطة راس | BANDANA, HIJAB_SCARF |
| foulard | HIJAB_SCARF, SCARF |
| برقع | BURQA, NIQAB |
| جلابية | JALABIYA, JILBAB |
| طاقية | BEANIE, TAQEEYA |
| جزمة | BOOTS, SHOES |
| escarpins | HEELS, PUMPS |
| كف | GLOVES, SLIDES |
| لفحة | SCARF, WINTER_SCARF |

### Cross-domain overlaps

| Key | Existing domain | Policy |
| --- | --- | --- |
| بولو | necklines | Retain distinct domain interpretations |
| polo | necklines | Retain distinct domain interpretations |
| بدي | expressions | Retain source evidence, block from candidate scanning |
| baddi | expressions | Retain source evidence, block from candidate scanning |
| bdi | expressions | Retain source evidence, block from candidate scanning |
| جينز | materials | Retain distinct domain interpretations |

High-risk source aliases بدي / bdi / baddi collide with WANT expressions. Those three keys are retained for inspection but excluded from source candidate token scans. Polo/product vs collar and جينز/product vs material remain distinct. No unrelated domain files were changed.

## Parser and matching behavior

Whole-token matching and the shared longest-phrase scanner are reused. New compound source phrases take precedence over their shorter lexical fragments: tee-shirt is not interpreted as a separate Shirt, قميص تي شيرت is not a two-product request, and two piece set does not invent requested quantity 2. New/unmapped source concepts remain clarification evidence; unknown brand/model words outside recognized spans retain their order. Generic product markers do not verify source ambiguity. Unmapped source IDs still participate in the single-item safety limit. Numeric sizes, explicit quantities, missing size/quantity and negation guards remain in effect.

Intentional safety change: بودي, كيلوت and بلوزة no longer resolve automatically in the parser when the supplied seed exposes additional meanings; the original BODYSUIT / UNDERWEAR / TOP canonical values remain candidates. The `product Body` marker also cannot distinguish baby versus adult clothing by itself. Four previous parser assertions were updated to verify these explicit new safety semantics; the trusted dictionary itself is unchanged.

seed_review alone cannot guarantee MATCHED. A newly staged alias requires a whole literal phrase in a current tenant product name, followed by existing complete identity, explicit requested quantity, required variant attributes, unique variant, current stock, eligible price and complete catalog coverage. Canonical equivalence or category evidence alone cannot satisfy the seed-review guard. A literal unique product can be identified while parser source alternatives remain ambiguous. MATCHED is still a confirmation-required preview, never an automatic sale or stock selection.

| Mocked request / catalog | Outcome |
| --- | --- |
| chemise black XL two pieces / real fixture name Shirt | INCOMPLETE: source meaning unverified |
| chemise black XL two pieces / real fixture name Chemise | MATCHED: literal catalog evidence |
| baby onesie black XL two pieces / same literal fixture name | MATCHED; canonical productType remains null |
| robe black XL two pieces / fixture name Dress | INCOMPLETE; DRESS/ROBE_HOME remain candidates |
| robe black XL two pieces / unique literal fixture name robe | MATCHED preview; source alternatives preserved |
| Missing size or quantity | INCOMPLETE; neither is guessed |
| Multiple compatible variants | AMBIGUOUS |
| Insufficient current stock | INSUFFICIENT_STOCK |
| Truncated catalog snapshot | INCOMPLETE |
| Absent compatible product or missing brand | NOT_FOUND |

All examples are synthetic mocks; no live Supabase tenant data or real merchant catalog was queried. `t chirt orange kt3ten` remains the earlier vocabulary fix (T_SHIRT / ORANGE / 2 / size null). Its source candidate scan is empty: this seed does not contain t chirt and did not fix Orange or quantity vocabulary.

The development Lab exercises the new backend after restart through the same API. Existing clarification messages show source IDs and review requirements. Its allowlist continues to strip unknown extra metadata; no frontend application or navigation code was changed.

## Validation results

- Full backend: 1,022 passed, 0 failed.
- Normalization + dictionary: 199 passed. Parser: 216 passed. Catalog matcher/API: 86 passed. Source integration: 80 passed (581 focused tests total, included in backend total).
- Full frontend: 361 passed, 0 failed; includes the new seed-response allowlisting compatibility regression.
- Backend typecheck and build: PASS; Prisma generate only, no migration. Final compiled-resource import smoke also passed.
- Frontend lint and Vite production build: PASS. No backend lint script or frontend TypeScript check exists in the current manifests.
- Tests cover source hashes/counts, every original alias, all 55 ambiguity records, malformed resource rejection, immutable resources, French/Arabic/Arabizi scripts, phrase boundaries, longest matching, residual model names, XL/XXL/XXXL, size 32 vs quantities, missing fields, multiple items, catalog coverage, stock/price, authenticated API tenancy and financial allowlisting.

## Performance and security

JSON reads, validation, normalization and index construction occur once per module/process initialization, not per match. No heavy library or dependency was added. Measured locally: cold full dictionary import about 136.81 ms, warm parser median 0.254 ms / p95 0.376 ms (500 short requests), 1,000-variant synthetic matcher median 74.48 ms (8 runs). These are local informative measurements, not hosting or network benchmarks. Candidate display remains capped at 20; total count remains available. No price/stock cache was introduced.

The catalog reader and authenticated Account resolution are unchanged. Backend authorization and tenant isolation continue to be mandatory. No cost/profit fields are selected or exposed to WAREHOUSE. Tests use write-forbidden mocks. No database connection, schema migration, RLS change, data write, inventory/checkout/POS change, ElevenLabs integration, Railway change, deployment or commit was performed. The protected PDF was never inspected or touched. Existing unrelated working-tree edits and the original integration kit were preserved.

## Files created/modified for this integration

- backend/resources/voice-sales/product-types.seed.json
- backend/resources/voice-sales/product-types.ambiguous.json
- backend/resources/voice-sales/product-types.smoke.json
- backend/src/voice-sales/product-type-source-ids.ts
- backend/src/voice-sales/product-type-source.types.ts
- backend/src/voice-sales/product-type-source.ts
- backend/src/voice-sales/product-type-source.test.ts
- backend/src/voice-sales/index.ts
- backend/src/voice-sales/parser.types.ts
- backend/src/voice-sales/parser.ts
- backend/src/voice-sales/matching.service.ts
- backend/src/voice-sales/catalog-matcher.ts
- backend/src/voice-sales/parser.test.ts
- backend/src/voice-sales/matching.test.ts
- backend/src/voice-sales/README.md
- backend/src/voice-sales/PARSER.md
- backend/src/voice-sales/PRODUCT_TYPES_INTEGRATION.md
- backend/package.json (register additional test)
- frontend/src/features/voice-sales/text-matching-flow.test.js (tests only)

## Limits, assumptions and next proposed phase

The supplied seed is unverified language data, not merchant catalog truth. Strict literal grounding deliberately leaves alias-to-label equivalences INCOMPLETE unless previously trusted or independently supported. No audience inference or correction learning is implemented. Audience hints are retained metadata only. Actual variants still originate exclusively in authenticated tenant-scoped database reads when the application is run. The two packaged runtime JSON files under backend/resources must accompany compiled backend artifacts; both source/test-dist/dist path resolution were verified.

No implementation blocker remains for this controlled candidate-only integration. Broader semantic enablement is intentionally staged. Next proposed phase, requiring a separate approval: context-aware catalog disambiguation and evaluation of selected staged aliases with real tenant catalog fixtures, without changing checkout or inventing product types. Stop here; do not deploy or commit.
