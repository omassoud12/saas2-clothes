# Context-aware voice sale parser — Phase 1B

## API and scope

Sizes v2 adds optional `sourceSizeId: ParsedAttribute<SourceSizeId>` and
`sourceSizeCandidates` for 671 source concepts, preserving the legacy Size union.
The local original-text scanner preserves composite `/`, `-`, decimal and unit
evidence; shared normalization is unchanged. Regional/age/measurement uncertainty,
partial dimensions and uncertain transcriptions retain null values and alternatives.
Exact size-source candidates include original character spans alongside shared
normalized token spans. See [SIZES_ACTIVATION.md](./SIZES_ACTIVATION.md).

Colors v2 adds optional `sourceColorId: ParsedAttribute<SourceColorId>` and
`colorCandidates` evidence using `activeColors`. The legacy Color union stays
unchanged. Exact source phrases resolve directly; ambiguous/deferred records
retain alternatives and null selected values. Color markers cannot choose between
shades or validate uncertain transcriptions. Explicit PLAIN evidence survives
color phrases; bare product/material overlaps remain context-dependent. See
[COLORS_ACTIVATION.md](./COLORS_ACTIVATION.md) for the current additive contract.

```ts
import { parseVoiceSaleText } from './parser.js'
import type { VoiceSaleParseResult } from './parser.types.js'

const result: VoiceSaleParseResult = parseVoiceSaleText(
  'بدي T-shirt بيضا قياس XL قطعتين',
)
// result.status === 'parsed'
// attributes: T_SHIRT / WHITE / XL / quantity 2, all explicit
```

The parser is pure and deterministic. It imports the Phase 1A dictionary API,
normalizer and lexical scanner. It has no environment, database, network or server
dependencies. Importing it does not register a route or execute a sale.
The Phase 1A dictionaries and their API/data remain unchanged.

Product Types v2 adds optional `sourceProductType: ParsedAttribute<SourceProductTypeId>`
and `productTypeCandidates` span/provenance evidence. All 343 source IDs are typed
separately from the unchanged legacy canonical union. Unambiguous authorized aliases
resolve directly, including the 329 concepts with no legacy canonical mapping.
Context-dependent aliases preserve alternatives and null values; a generic product
marker cannot choose between multiple meanings. The compatibility flag
`requiresCatalogEvidence` is false: ordinary catalog proof remains mandatory, but
same-spelling-only seed review is removed. Raw provenance retains `seed_review`.
Resources/indexes load once; parsing has no per-request file/network/database IO.
See [PRODUCT_TYPES_ACTIVATION.md](./PRODUCT_TYPES_ACTIVATION.md).

`Product` and `ProductVariant` were inspected read-only: Product has a name and
category; variant color/size are nullable strings, quantity is not a catalog
attribute, and material/neckline/fit/pattern are not schema columns. Parser values
are language concepts; no Product ID, Variant ID, stock, price or availability is
inferred. Unknown names are provisional residual text until dynamic catalog matching.

## Contract

- `originalText` and `normalizedText` retain original input and its shared normalized
  representation. Non-string runtime input produces `originalText: null`.
- `attributes` has separately typed `productType`, `color`, `size`, `quantity`,
  `material`, `neckline`, `fit`, `pattern`. Each has status, nullable value,
  candidate values, source and evidence.
- Only `resolved` attributes have a non-null value. `ambiguous` and `conflict`
  retain alternatives without selecting one. Repeated equivalent values are deduplicated;
  evidence for each mention is retained.
- Evidence distinguishes explicit aliases from inferred contextual interpretations,
  with a rule and half-open normalized token span. The additive size candidates
  also retain original character offsets. Other attribute evidence does not claim
  original offsets. Mixed explicit/inferred evidence produces source `mixed`.
- `productNameResidualTokens` preserves unknown name/brand candidates in order.
  `unrecognizedTokens` also includes unresolved numbers and unsupported attribute
  words. Numbers without context are never automatically name tokens or quantities.
  Uncertain transcription suggestions remain unrecognized; unqualified ones also
  remain name candidates for later catalog evaluation.
- `conversationalTokens` records dictionary-supported conversational expressions
  and conjunctions between attribute/item descriptions. Arbitrary unknown words
  are not silently treated as filler.
- `ambiguities` includes typed issues for lexical choices, conflicts, unsupported
  values/structures, numbers, transcription suggestions, and multiple items.
- `missingInformation` lists fields with no extracted canonical candidate;
  `unresolvedInformation` lists ambiguous/conflicting fields and fields implicated
  in issues. A field may appear in both after an unsupported marker value.

### Status

| Status | Meaning |
| --- | --- |
| `parsed` | Product type, color, size and quantity are linguistically resolved, with no issues |
| `incomplete` | No ambiguity, but one or more of those four linguistic fields is absent |
| `needs_clarification` | A lexical, numeric, conflict or unsupported-structure issue remains |
| `unsupported_multiple_items` | More than one item description is detected; parse separately |
| `invalid_input` | Empty/non-string, malformed Unicode/control characters, or over 4096 UTF-16 code units |

Core-field completeness is a parser convention, **not** a database requirement
that every real product has a color or size. `parsed` never means a real catalog
match or authorization to checkout. Downstream code must inspect status/issues and
match tenant-owned catalog data before any business operation.

## Pipeline and supported structures

1. Validate bounded text, then reuse shared normalization/tokenization.
2. Guard numeric punctuation before normalization can erase signs/decimal/range syntax.
3. Reuse whole-phrase longest-first vocabulary spans.
4. Resolve explicit grammar markers and collect non-overlapping evidence.
5. Preserve cross-domain/contextual alternatives and conflicting values.
6. Detect multiple-item structures and retain unknown tokens; derive parse status.

Supports mixed Arabic/English, Lebanese dialect, Arabizi, Arabic/Persian/Western
digits, letter sizes, numeric size markers, quantity words/unit phrases, reordered
attributes, repeated equivalent aliases, all eight clothing/quantity attribute domains,
and the Phase 1A conversational domain.

Grammar markers add structure, not duplicate clothing dictionaries: size/color/quantity
markers use the expression dictionary; additional markers are material/fabric/قماش/خامة,
collar/neckline/قبة/2abbe, pattern/نقشة, fit/قصة and product/منتج.

## Context and ambiguity rules

| Input/context | Result |
| --- | --- |
| `size 32`, `قياس ٣٢`, `مقاس ۳۲` | Explicit canonical size `'32'` |
| `32 pieces`, `quantity 32`, `عدد ٣٢`, `قطعتين`, `two pieces` | Explicit supported quantity |
| Bare `2` / `32` | Unresolved number; no selected size/quantity |
| Missing quantity | Missing with value/source null; no default one |
| Bare Body / كنزة / كولون | Contextual product alternatives remain unresolved |
| Bare Polo / جينز | Product-vs-collar / product-vs-material alternatives both remain visible |
| `product Body`, `collar Polo`, `pattern مموج` | Single contextual candidate resolved by explicit domain marker; inferred provenance |
| `product كنزة` | Still ambiguous: the marker cannot choose Sweater vs Top |
| `كنزة صوف` | Reuse qualified Sweater alias: inferred Sweater prefix and separate explicit Wool suffix |
| `بنطلون jeans` / `jeans pants` | One Pants/Jeans compound with preserved product ambiguity |
| `قبّة Polo` / `Polo Shirt` | Complete trusted phrase wins before standalone marker rules |
| `soda` / `جينس` | Untrusted transcription suggestion, never automatic correction |
| `one size` | Unsupported size concept; one is not extracted as quantity |
| `size two` / `quantity XL` | Unsupported marker value, never reinterpreted as another field |
| `-2`, `1.5`, full-width signed/decimal numbers, `32–34` | Clarification required; no partial numeric quantity/size extracted |

Multiple distinct definite product mentions, products separated by conjunctions,
repeated products with intervening attributes, or two repeated core attribute groups
across a conjunction produce `unsupported_multiple_items`. A conjunction joining
only conflicting colors remains a color conflict. An Arabic attached `و` is recognized
for multiple-item detection only when its remainder exactly matches a known product
word and another product mention exists. No substring clothing search is performed.

Negation, `or` alternatives and cancellation return clarification with no affirmative
attribute values, or the multiple-item status when several definite products are
already apparent. Their semantic interpretation is outside the MVP.

## Examples

| Input | Selected values / unresolved information |
| --- | --- |
| `بدي T-shirt بيضا قياس XL قطعتين` | T_SHIRT, WHITE, XL, quantity 2; parsed |
| `بدي بنطلون jeans مخمل كحلي قياس 32` | PANTS/JEANS unresolved; VELVET, NAVY_BLUE, size 32; quantity missing |
| `بدي كنزة قبّة Polo سودا` | SWEATER/TOP unresolved; POLO_COLLAR, BLACK; size/quantity missing |
| `T-shirt sawda XL two pieces` | T_SHIRT, BLACK, XL, quantity 2; parsed |
| `Tshirt Cedar Collection black XL 2 pieces` | Resolved core fields; residual `cedar collection`; no catalog identity |
| `Tshirt and pants` | Unsupported multiple items |

## Tests and limits

`parser.test.ts` is registered alongside the unchanged dictionary tests in the
existing Node test runner (`npm test --workspace server`). Run TypeScript checks
with `npm run typecheck --workspace server` and compile with `tsc -p backend/tsconfig.json`.
All test inputs are local constants and mock fixtures; no live catalog is fetched.

The vocabulary remains finite. Quantities v2 supplements its 1,006 source number
concepts with bounded explicit digit grammar (1–1,000,000), without creating
additional dictionary concepts or catalog variants. Source size concepts remain
independent of order quantities.
There is no fuzzy correction, alias learning, general Arabic morphology, pronoun
resolution, price extraction, free-size mapping, or real product-name recognition.
Catalog names colliding with known language aliases require later catalog-aware
clarification. Multiple unknown catalog names and unhandled grammatical structures
cannot always be classified without that catalog; unresolved attributes are retained
rather than assigned automatically. Base attribute evidence uses normalized token
offsets. Additive source-size and quantity-intent evidence also retains original
character spans.

Phase 1C now consumes this parser in the **Dynamic Catalog Matching Engine**;
see [MATCHING.md](./MATCHING.md) for authenticated, tenant-scoped, read-only matching.
The parser itself remains pure. Database queries, ElevenLabs, frontend/POS/Cart,
stock changes and checkout remain outside Phase 1B.

Optional `quantityIntent` distinguishes order units, unit alternatives, exactness,
modifiers and unverified packaging/measurement conversions. Its `resolvedPieces`
is populated only for exact PIECE requests in the existing sellable-variant unit
convention; it never expands named sets or packages. Legacy `attributes.quantity`
is now typed as a validated integer number, allowing safe explicit counts beyond
the old 17 literal values; its JSON shape is unchanged. Bare number words are
recognized but unresolved without an explicit count marker or piece/unit phrase.
Unclaimed words such as Twenty in a brand remain literal catalog constraints.
Containers, PAIR and DOZEN are never converted into stock counts without verified
SKU metadata. Approximate/range/allocation/add/remove intent is advisory only.
See [QUANTITIES_ACTIVATION.md](./QUANTITIES_ACTIVATION.md).
