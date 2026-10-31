# Common Expressions Dictionary v2 integration

STATUS: PASS. This is a local, read-only language integration; nothing has been committed or deployed.

## Source inspection and integrity

Read AGENTS.md, ARCHITECTURE.md, the Prisma schema, existing normalizer, dictionaries, parser, quantity interpretation, catalog matcher/reader, authenticated matching service/router, tests and development Lab. No relevant architectural conflict was found. The frontend remains the architecture-defined JavaScript/JSX client; no database or application topology changed.

The complete extracted `SAAS2_Common_Expressions_Dictionary_Integration_Kit` is used as supplied. All 14 files listed in its manifest exist and their SHA-256 hashes match. This includes README_FIRST.md, CODEX_INTEGRATION_PROMPT.md, QA_REPORT.md, three source JSON resources, four original CSVs, the standalone source TypeScript/readme/test references and 21 integration smoke fixtures. The reference engine was inspected, not substituted for SaaS2.

Byte-exact runtime copies:

| Resource | SHA-256 |
| --- | --- |
| common-expressions.seed.json | `9d8360fadbcc5e48f42bd6e8cf019d206bc3e32574c9bf32dcbb629e0d9e2ad0` |
| common-expressions.collisions.json | `1efced26636a7597c9ceb50cf97120140ca86704e111d1b02dda274ebdde8c2d` |
| common-expressions.ambiguities.json | `c1cc46394b02caad8dbe44d4c1738d0001e63b20923edc0fe75acc7038222cc1` |

The manifest's original Complete ZIP hash is provenance, not independent archive verification: that archive is not a required kit file. All actually imported data/reference files were verified independently against the kit manifest.

## Coverage and alias decisions

| Measure | Result |
| --- | ---: |
| Concepts supported, IDs preserved | 141 |
| Intent categories | 18 |
| Source alias records evaluated | 1,297 |
| Direct, unambiguous lexical activation | 919 |
| Active, context-dependent records | 377 |
| Activated source records, total | 1,296 |
| Suggestion only, blocked from trusted activation | 1 |
| Structurally invalid / unsupported source records | 0 / 0 |
| Duplicate normalized alias/ID records retained in audit | 17 |
| Runtime multi-intent collision keys | 6 |
| Source ambiguity records preserved | 52 |
| Cross-domain overlap records | 19 |
| Raw alias keys differing from source normalized_key | 140 |
| Effective keys including three legacy compatibility aliases | 1,277 |

The single suggestion is `محتاين` for REQ_NEED: its uncertain seed spelling is preserved as evidence but cannot become a trusted request. It needs dialect/transcription validation. Other aliases still support that concept. The counts describe source records, not unique spoken phrases or proven dialect accuracy. Duplicates and collision counts overlap other categories; they must not be added to the activation partition.

All 141 concepts preserve `seed_unvalidated` provenance. Original alias risks remain 943 none, 299 workflow_validation and 55 context. Original concept handling remains 99 none, 32 workflow_validation and 10 context_required. Even direct lexical recognition never authorizes a business action.

The categories are REQUEST, AVAILABILITY, PRICE, PREFERENCE, REJECTION, CONFIRMATION, ORDER_CHANGE, CANCEL, ORDER_STATUS, DELIVERY, PAYMENT, RETURN, SIZING_HELP, MATERIAL_HELP, PHOTO, NEGOTIATION, CONTEXT and AMBIGUOUS. Per-category concept/alias/disposition coverage is recorded in COMMON_EXPRESSIONS_AUDIT.json.

Existing CONFIRM aliases `Confirm`, `أكيد`, `Akid`, which the kit omits as standalone phrases, are explicitly retained as recognition-only compatibility cues for CONF_YES. These three keys are reported separately and do not increase the 1,297 source-record count. A confirmation cannot turn an otherwise explicit item description into an eligible sale preview.

## Implementation logic

`common-expression-ids.ts` provides literal TypeScript unions for the 141 source IDs and 18 categories. `common-expression.types.ts` separates immutable source/audit data from the bounded public advisory projection.

`common-expression-source.ts` loads three integrity-checked JSON resources once per process, validates cardinalities, identity references, categories, handling/risk tags and separate collision/ambiguity resource agreement, then freezes the data. The indexed registry supports exact normalized lookup and the existing whole-token, longest-phrase matcher. It retains every alias record and all candidate IDs; there is no first-entry resolution, fuzzy lookup, substring lookup or executable command dispatch.

Raw aliases pass through the shared normalizer: Unicode NFKC, case folding, Arabic Alef/Yeh/Kaf folding, Arabic/Persian digits to Western digits, Arabic diacritic/tatweel and bidi-mark removal, punctuation separation and whitespace collapse. Arabic `ة` and French accents are preserved. Source normalized_key values, including the standalone engine's `ة` to `ه` fold, are metadata rather than extra runtime aliases. Six collisions are recomputed under the actual normalizer; all relationships remain visible.

`common-expression-parser.ts` annotates normalized token spans independently of attribute extraction. Cues contain candidate IDs, categories, recognized/context/suggestion status, intent/attribute/grammar/literal-name role and affirmative/negated/uncertain polarity. Every cue explicitly has `recognitionOnly: true`, `authorizesAction: false`, `provenance: seed_unvalidated`. There is deliberately no arbitrarily chosen primary intent or ML confidence.

Known WANT grammar, including `bdi/baddi/بدي`, cannot become a Bodysuit product type. Safe affirmative WANT/NEED/SEARCH prefixes can be removed from conversational residue after protecting garment, shade, size, quantity, material, neckline and fit spans. Unrecognized brand/model words are retained. An explicitly marked model phrase is retained as literal name evidence. Unanchored request words inside a name need context rather than being silently stripped.

An exact count modifier immediately adjacent to a resolved piece count, such as `exactly two pieces`, retains its quantity role and evidence. The qualified modifier is consumed as grammar, while `exactly` alone remains an advisory confirmation. Quantities, prices and stock are never inferred from an intent word.

Longest-phrase matching keeps `ما بدي ألغي الطلب` as CHANGE_KEEP_ORDER and suppresses its embedded cancellation phrase. An independently negated cancellation is marked negated, never an affirmative CANCEL operation. For the exact rejected-size/color templates, the later explicit slot can survive (`مش هالقياس بدي L` retains L) while sale preview remains blocked. General negation, alternatives and multi-item safeguards remain conservative; this is not a general dialogue-state or negation-scope engine.

The parser's two optional fields, `commonExpressionMatches` and `commonExpressionSafety`, are additive. Existing canonical slots, IDs and old clients remain compatible. Non-sale, uncertain and negated intents produce clarification metadata. The authenticated matching service stops before a catalog read; the pure catalog matcher also prevents MATCHED for those signals. REQUEST by itself never supplies product identity, a variant, size or quantity.

## Before/after examples

The comparisons below use the saved pre-task parser/matcher and a synthetic catalog containing Cedar T-Shirt, Black, XL, positive price and available stock. They are not live Supabase results or completed transactions.

| Input | Before | After |
| --- | --- | --- |
| je veux Cedar T-shirt black XL two pieces | NOT_FOUND; `je veux` left as name words | MATCHED advisory preview; REQ_WANT; T_SHIRT / BLACK / XL / 2 |
| أكيد Cedar T-shirt black XL two pieces | MATCHED; old confirmation stripped | INCOMPLETE; confirmation needs context, no sale preview |
| baddi Cedar T-shirt black XL two pieces | MATCHED | MATCHED advisory preview, plus explicit REQ_WANT cue |
| ما بدي ألغي الطلب | No eligible literal catalog match in the pure matcher | CHANGE_KEEP_ORDER, no embedded CANCEL_ORDER, INCOMPLETE |
| bdi 2 tshirt soda size L | No eligible match | REQ_WANT recognized; bare 2 unresolved, soda still suggestion, no forced match |

The old authenticated service already blocked unsupported negation; the pure before/after comparison does not imply that the old API executed cancellation.

`بدي تي شيرت سودا XL قطعتين` retains T_SHIRT, BLACK, XL and 2. `في منها XL` recognizes AV_CHECK and retains XL without reservation. `غيرلي اللون` retains both CHANGE_COLOR and PREF_OTHER_COLOR. `d accord` retains CONF_OK and CONF_AGREE. `بدون طبعة` remains a negative preference, not an invented positive pattern or product.

Source comments suggesting automatic quantity 2 or trusted Black for `bdi 2 tshirt soda size L` are not authoritative over existing safeguards. Bare numbers remain contextual and `soda` stays an uncertain color. Likewise `بدي تلات كنزات` does not invent a piece unit for an unqualified number word.

## API, Lab, packaging and security

The existing authenticated POST `/api/voice-sales/match` continues accepting only text. Client tenant IDs, parsed cues and safety overrides are rejected. Account scope comes from authentication; only active OWNER/WAREHOUSE tenant users can call it. SUPER_ADMIN/inactive tenant access, 4xx/5xx sanitization and costly-read rate limits are preserved. Actual-name/variant evidence, current Decimal-string prices and current stock remain mandatory. No new database fields, fabricated variants, product names or financial attributes are introduced.

The new public cue fields contain only safe typed summaries, not source/audit rows. The development-only Lab validates and allowlists the optional projection, discards unknown/private fields, rejects forged action authority and unsafe MATCHED payloads, and shows ambiguity/negation with a recognition-only notice. No Cart, checkout, navigation or production voice UI was added. Old payloads without the optional fields remain accepted.

The build allowlist adds exactly three runtime JSON files, taking the total from 12 to 15. A standalone artifact smoke copies only compiled JS and those 15 resources and checks byte equality, all dictionary counts, a French request, negated cancellation and disabled confirmation preview without source or .env fallback. Original CSV, QA, smoke fixtures and audit reports are not shipped as runtime resources.

No schema, migration, database data, inventory, financial, checkout or POS logic changed. No live database, Supabase Auth admin, Railway, microphone, ElevenLabs or external AI API was contacted. No credential values were inspected or exposed. No commit or deployment occurred. The protected planning PDF was not inspected or touched.

## Files created

- backend/src/voice-sales/common-expression-ids.ts
- backend/src/voice-sales/common-expression.types.ts
- backend/src/voice-sales/common-expression-source.ts
- backend/src/voice-sales/common-expression-parser.ts
- backend/src/voice-sales/common-expression.test.ts
- backend/src/voice-sales/COMMON_EXPRESSIONS_ACTIVATION.md
- backend/src/voice-sales/COMMON_EXPRESSIONS_AUDIT.json
- backend/src/voice-sales/COMMON_EXPRESSIONS_PERFORMANCE.json
- backend/resources/voice-sales/common-expressions.seed.json
- backend/resources/voice-sales/common-expressions.collisions.json
- backend/resources/voice-sales/common-expressions.ambiguities.json
- backend/resources/voice-sales/common-expressions.smoke.json (test-only)
- backend/scripts/audit-voice-common-expressions.mjs
- backend/scripts/benchmark-voice-common-expressions.mjs

## Files modified

- backend/src/voice-sales/index.ts
- backend/src/voice-sales/parser.types.ts
- backend/src/voice-sales/parser.ts
- backend/src/voice-sales/matching.service.ts
- backend/src/voice-sales/catalog-matcher.ts
- backend/src/voice-sales/matching.test.ts
- backend/package.json (test list only)
- backend/scripts/copy-voice-dictionary-resources.mjs
- backend/scripts/verify-voice-dictionary-artifact.mjs
- frontend/src/features/voice-sales/text-matching-flow.js
- frontend/src/features/voice-sales/text-matching-flow.test.js
- frontend/src/features/voice-sales/text-matching-ui.test.js
- frontend/src/pages/app/TextMatchingLabPage.jsx

Ignored local `.tools/expressions-*` helpers/logs/scoped baselines and `.test-dist`/build/Prisma generated artifacts support the audit and validation. Pre-existing unrelated work and prior dictionary reports were left intact.

## Checks

- All 14 kit-manifest file hashes and byte-exact runtime copies: PASS.
- All 141 concepts, 1,297 alias records, 6 collisions and 52 ambiguity records: tested.
- Original integration smoke fixtures: 21/21 PASS.
- New Common Expressions unit/regression tests: 1,554/1,554 PASS.
- Focused dictionary/parser/matcher/API regression: 1,914/1,914 PASS.
- Full backend suite: 10,123/10,123 PASS (136 suites; zero failures, skips or cancellations).
- Full frontend suite: 385/385 PASS (54 suites), including four new projection/SSR tests.
- Backend `npm run typecheck`, frontend `npm run lint`, backend/frontend `npm run build`: PASS on the final implementation. Backend builds generate Prisma Client 7.10.0 locally with the datasource-free generation config and apply no migration. Backend has no lint script; the JSX frontend has no TypeScript configuration/typecheck script.
- Final standalone compiled-artifact resource smoke: 1/1 PASS with exactly 15 runtime JSON files.
- Scoped diff and whitespace review: PASS. The task creates 14 maintained files and modifies 13 existing files; existing unrelated changes were preserved.

Tests exercise real application routing/services with synthetic Prisma/catalog dependencies. They cover both tenant roles, rejection of client authority, tenant A/B scope, fresh price/stock, no financial leakage, unavailable/ambiguous variants, missing size/quantity, numeric sizes versus quantities, XL/XXL/XXXL, existing dictionary suites, non-sale/no-read safety and zero-write spies. Local Node is 24.21.0; the architecture's production Node 22 runtime has not been verified by this integration.

## Performance and remaining limits

COMMON_EXPRESSIONS_PERFORMANCE.json records paired warm before/after parser timings, request parsing, 1,000 shared/distinct-name variants, early non-sale gating and cold import/memory. The final measurements are:

| Synthetic local measurement | Result |
| --- | --- |
| Common parser before/after, 200 interleaved pairs | 2.765 ms / 2.800 ms mean; observed delta +0.035 ms |
| French request parser, 200 runs | 7.084 ms mean; 9.481 ms p95 |
| Match 1,000 variants sharing a name, 20 runs | 50.914 ms mean |
| Match 1,000 distinct names, 5 runs | 1,064.152 ms mean; 1,177.125 ms p95 |
| Non-sale parse and early gate, 200 runs | 5.161 ms mean; no catalog iteration |
| Whole-pipeline cold import, 3 runs | 1.524–1.622 seconds |
| Whole-pipeline retained heap / RSS increase | 26.499–26.505 MiB / 101.211–103.094 MiB |
| New runtime JSON bytes | 365,312 |

The registry is built once per process; requests perform bounded exact lookup with the existing 4,096-character input cap. Cold measurements cover all dictionaries/parser and cannot be attributed solely to this integration. Warm before/after snapshots share the existing current registries; no controlled cold baseline or production latency claim is made. The distinct-name catalog scan remains a notable existing bounded cost, not a newly verified production SLA.

Live Supabase catalog verification: NO. Actual tenant catalogs, merchant dialect accuracy, dialogue references, complete negation scope and real speech transcription remain unverified. Non-sale/context-dependent phrases intentionally withhold preview rather than inventing an order, product or action. Multi-item speech remains unsupported. No new material/fit/style/payment/order columns or workflows are assumed.

Proposed next stage only: validate seed expressions with approved merchant examples and design a scoped dialogue/negation resolver. Keep separate authorization and human confirmation for any future business mutation. No next phase, speech integration, deployment or commit has been started.
