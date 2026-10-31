# Voice sales foundations — Phases 1A, 1B and 1C

Phase 1A provides pure TypeScript language dictionaries. The dictionary files have
no runtime registration, environment loading, network access, database access,
API endpoints, or cart actions.
Canonical values are **language concepts**, never catalog Product/Variant identities.
Material, fit, pattern and neckline concepts do not imply corresponding database fields.
Phase 1C reads actual product names and variants from authenticated,
tenant-scoped Supabase/Prisma data; no store names are embedded in dictionaries.

## Structure and coverage

Sizes v2 is active through `activeSizes`: 671 source concepts / 10,448 retained
aliases in 22 families, with 9,484 lexically unambiguous, 940 contextual and 24
untrusted suggestion records. The legacy 14-value Size union stays compatible.
Parser composites retain original delimiters and source evidence; real nullable
Variant.size labels remain authoritative. See [SIZES_ACTIVATION.md](./SIZES_ACTIVATION.md),
[SIZES_AUDIT.json](./SIZES_AUDIT.json) and [SIZES_PERFORMANCE.json](./SIZES_PERFORMANCE.json).

Colors & Shades v2 is active through `activeColors`: 307 typed source concepts,
3,475 preserved records, 2,818 unambiguous / 223 context-dependent / 434 deferred.
The existing 13-value Color union remains compatible; `sourceColorId` carries
additional precise shades in parser/API/Lab results. Actual tenant color labels
use the same registry without catalog writes. See
[COLORS_ACTIVATION.md](./COLORS_ACTIVATION.md) and [COLORS_AUDIT.json](./COLORS_AUDIT.json)
for source integrity, every alias disposition, collisions and current checks.

Product Types v2 is now active through `activeProductTypes`: 343 source concepts,
2,906 active alias records (2,792 unambiguous / 114 context-dependent), and three
blocked conversational fillers. `productTypeSource` preserves all 2,909 original
records and provenance; the existing 15-value ProductType API and counts below
remain compatible. Immutable JSON and indexes load once per process using the
shared normalizer and longest-phrase matcher. Parser and actual tenant catalog
names/categories share source IDs across languages, without creating catalog data.
See [PRODUCT_TYPES_ACTIVATION.md](./PRODUCT_TYPES_ACTIVATION.md) for the current
activation audit, additive contract, ambiguity safeguards and validation results.

`dictionary.types.ts` defines distinct canonical types for nine domains.
`dictionaries/` contains their alias data; `dictionary.ts` implements validated indexes
and token matching; `normalization.ts` is shared by registration and lookup.
`index.ts` exports the dictionaries, lookup functions and coverage metadata.

| Domain | Canonical values | Trusted aliases | Context-required aliases | Suggestions |
| --- | ---: | ---: | ---: | ---: |
| Product types | 15 | 50 | 7 | 1 |
| Colors | 13 | 63 | 0 | 1 |
| Sizes | 14 | 53 | 7 | 0 |
| Materials | 6 | 17 | 0 | 0 |
| Necklines / collars | 3 | 11 | 2 | 0 |
| Fit / style | 4 | 15 | 0 | 0 |
| Patterns | 4 | 13 | 3 | 0 |
| Quantities | 17 | 102 | 0 | 0 |
| Common expressions | 8 | 29 | 0 | 0 |

Unit tests independently exercise every canonical value (84 total), the requested
Arabic/English/Arabizi examples, ambiguity, normalization and index integrity.
This is vocabulary coverage, not a claim of complete language or code coverage.
`getDictionaryCoverage()` returns current counts if entries are extended.

## Normalization

- Unicode NFKC, including presentation forms and full-width Latin/digits.
- Case folding through Unicode lowercase; whitespace collapsed and trimmed.
- Arabic diacritics and tatweel removed; Alef variants map to Alef;
  Alef Maksura/Persian Yeh map to Yeh; Persian Kaf maps to Arabic Kaf.
- Arabic-Indic and Persian digits become Western digits.
- Directional formatting controls removed; punctuation becomes token boundaries.
- Arabizi digits remain attached to letters (`Ka7le`, `2oton`, `3XL`).
- Teh Marbuta is preserved; arbitrary transliteration and Latin accents are not erased.

Use only for language comparison, never to rewrite SKUs, product identities or
display names. Punctuation and diacritic distinctions are intentionally lost;
the parser must retain the original sentence for display and numeric interpretation.

## Functions and result contract

```ts
import { colors, productTypes, quantities, sizes, lookupVocabulary,
  matchVocabularyTokens } from './index.js'

colors.lookup('Sawda')           // matched: BLACK
productTypes.lookup('Body')      // ambiguous: candidate BODYSUIT, no selected value
sizes.lookup('size ٣٢')          // matched: '32'
sizes.lookup('32')               // ambiguous: numeric size candidate, context required
quantities.lookup('32')          // unknown: never silently a quantity
quantities.lookup('32 pieces')   // matched: 32
lookupVocabulary('جينز')         // ambiguous: JEANS product type + DENIM material
matchVocabularyTokens('قبّة Polo size ٣٢') // longest phrases, neckline + size
```

- Each dictionary exposes `lookup(text)` (exact normalized whole-alias lookup)
  and `matchTokens(text)` (longest-match-first, non-overlapping lexical spans).
- `lookupVocabulary(text)` retains hits from **every** matching domain. More than
  one domain or a context-required alias is reported as `ambiguous`.
- `matchVocabularyTokens(text)` chooses the longest phrase across domains and
  retains all its domain hits. It is a lexical scan, not a sentence parser:
  it does not bind a color to a product, infer intent, handle negation or make a sale.
- Token offsets are half-open indices in normalized text, not original character
  offsets. Unknown words are skipped in scans, and remain `unknown` in exact lookup.
- `matched` contains one typed language value; `ambiguous`/`suggestion` contain
  candidates and a reason, **without** a selected value. Results are immutable.
- Uncertain spellings (`soda`, `جينس`) are explicit untrusted `suggestion` results;
  there is no fuzzy matching or automatic correction.

## Ambiguities reserved for the Context-Aware Parser

| Alias | Preserved interpretations |
| --- | --- |
| Body | Bodysuit candidate vs a non-garment body reference |
| كنزة / Kenza | Sweater vs general top |
| كولون / Kolon | Leggings vs tights |
| Polo / بولو | Polo shirt vs polo collar, across separate domains |
| جينز | Jeans product type vs Denim material |
| مموج / Wavy / Mmawwaj | Wavy pattern candidate vs texture/shape |
| Bare 28–40 supported size numbers | Possible size vs quantity, code or price |

`TOP`, `TIGHTS` and `POLO_SHIRT` are added lexical concepts to preserve those
alternatives. A one-candidate `ambiguous` result still requires context: it never
selects that candidate automatically. `بودي` and explicit `Bodysuit` are trusted
clothing aliases; unqualified English `Body` is intentionally context-required.
Quantity words and unit-qualified phrases are lexical quantities; no bare numeric
alias is registered in that domain. Supported quantities are 1–10, 12, 20, 24,
30, 32, 50, 100; numeric sizes are 28, 30, 32, 34, 36, 38, 40.

## Extension rules and tests

The vocabulary regression `t chirt orange kt3ten` now resolves T_SHIRT, ORANGE
and explicit quantity 2, while size remains missing. `t chirt` is an exact phrase;
`tchirt` and `قطعتين` were already supported. ORANGE registers `Orange`, `برتقالي`
and `برتقالية`; case/diacritic variants use the shared normalizer. `kt3ten` is
registered as the requested Arabizi spelling of `قطعتين`, not derived from its
digit 3. Other unverified spellings remain unknown. The same color dictionary is
used to compare real Variant.color values; there is no catalog rewrite or inferred
size. A compatible sized variant therefore remains INCOMPLETE until size is supplied,
multiple plausible variants remain AMBIGUOUS, and an incompatible catalog is NOT_FOUND.

Add aliases to the relevant typed domain, not to a combined untyped map. All input
aliases pass through `normalizeText` when the dictionary is created.
`createDictionary` throws `DictionaryAliasError` on duplicate/conflicting normalized
aliases, including collisions between trusted, contextual and suggestion entries.
For example, registering both `أسود` and `اسود` is redundant and rejected; registering
only one already supports lookup of both. Declare deliberate ambiguity in one
contextual group, with declared canonical candidates and a reason. Cross-domain
collisions are allowed and remain visible in `lookupVocabulary`.

Run the existing backend runner with `npm test --workspace server` and
`npm run typecheck --workspace server`. The test script includes normalization,
dictionary, parser and matching test files.
Future changes need independently chosen examples and ambiguity tests, not only
tests that iterate the dictionary's own data.

Phase 1B is available through `parser.ts`; see [PARSER.md](./PARSER.md) for its
context-aware result contract and limits. Phase 1C adds read-only catalog matching;
see [MATCHING.md](./MATCHING.md) for its API, tenant isolation and coverage limits.
ElevenLabs integration, frontend/POS/Cart and checkout remain outside these phases.

Quantities v2 is an additive, process-local resource registry in `quantity-source.ts`
and a pure intent layer in `quantity-parser.ts`. It preserves the legacy 17-value
dictionary, uses exact normalized phrases, and guards imported aliases with order,
unit and source-span evidence. See [QUANTITIES_ACTIVATION.md](./QUANTITIES_ACTIVATION.md)
and [QUANTITIES_AUDIT.json](./QUANTITIES_AUDIT.json) for coverage, collisions and all
65 reconciled source cases. Static recognition never authorizes stock changes.
# Materials & Fabrics

The additive Materials registry is active in the dictionary/parser/read-only catalog
pipeline. See [MATERIALS_ACTIVATION.md](./MATERIALS_ACTIVATION.md) for provenance,
alias dispositions, API additions, source contradictions and validation results.
Source material/modifier IDs are language concepts; they do not add Prisma columns
or certify actual garment composition. Composition/specification requests remain
unresolved until independently verifiable catalog data exists.

