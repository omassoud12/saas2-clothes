# Dynamic catalog matching — Phase 1C

## Audit and scope

Sizes v2 compares typed spoken size constraints with actual nullable Variant.size
through one registry and independent Product/Category context. Composite sizes,
physical units and regional systems remain distinct; no conversions or database
size_standard column are assumed. Identical explicit numeric merchant labels can
match without inventing EU/US/UK. Partial bra/waist/inseam dimensions stay unresolved.
No spoken constraint, brand/model requirement, quantity, price, stock, tenant guard
or coverage requirement is dropped. See [SIZES_ACTIVATION.md](./SIZES_ACTIVATION.md).

Colors v2 uses `activeColors` for both spoken aliases and actual tenant Variant.color.
All 307 source IDs are distinct language concepts; the legacy Color union is
unchanged. An ambiguous requested shade requires independently unique stored color
evidence; an ambiguous stored label cannot select a meaning. Original labels,
explicit descriptors, missing size/quantity, current stock, Decimal prices and
tenant guards remain intact. The dev Lab displays additive `sourceColorId` evidence
and alternatives. See [COLORS_ACTIVATION.md](./COLORS_ACTIVATION.md) for the source
audit, contract, limitations and validation results.

Product Types v2 activation extends this phase with all 343 typed source concepts.
Requests and actual Product.name/Category.name labels are compared through the same
active alias registry. The earlier literal-only seed restriction is removed.
Independent unambiguous name/category evidence can narrow an ambiguous request;
repeating the same ambiguous catalog spelling alone cannot choose its meaning.
Unknown brand/model tokens and explicit descriptors remain constraints, and generic
type equivalence cannot erase missing name, variant, quantity, price or stock proof.
The Lab displays additive `sourceProductType` identities/alternatives. See
[PRODUCT_TYPES_ACTIVATION.md](./PRODUCT_TYPES_ACTIVATION.md) for the current audit.

The existing schema, Product Entry service, POS lookup, Sales service and auth
middleware were inspected before implementation. Product owns the display name
and Category; ProductVariant owns nullable color/size, currentStock and nullable
Decimal sellingPrice. Material, neckline, fit and pattern are language concepts,
not database columns. Category names may provide exact product-type alias evidence.

Existing Sales permissions permit active OWNER and WAREHOUSE tenants, with
WAREHOUSE requiring a positive catalog selling price. OWNER may manually price a
sale in the existing checkout; matching does not implement that override and
returns INCOMPLETE for a unique unpriced candidate. Active product/variant rules
are enforced. Category activity is not added as a new Sales eligibility rule.

Only read-only backend matching is implemented. No Entry hooks, startup catalog
loading, database writes, schema changes, checkout changes, frontend changes,
audio integration or alias learning are introduced. Fixtures in tests are not
production product names or automatically registered aliases.

## Files and dependency flow

- `match.types.ts`: immutable typed snapshot, evidence, candidate and result contracts.
- `authenticated-tenant.ts`: shared active OWNER/WAREHOUSE context guard.
- `catalog-reader.ts`: tenant-scoped Prisma projection and bounded keyset reads.
- `catalog-matcher.ts`: deterministic pure comparison over that authorized snapshot.
- `matching.service.ts`: trusted-context validation, existing parser and reader orchestration.
- `matching.routes.ts`: existing authentication/tenant/role middleware and text-only API.
- `matching.test.ts`: isolated repository doubles and localhost HTTP security tests.

`index.ts` wires the service into `createApp`; construction executes no database
query. Existing middleware handles security headers, CORS, request logging, error
sanitization and rate limiting. Matching POST requests also receive the costly-read
rate limit; they remain subject to existing general and POST rate-limit tiers.

## Catalog reader

`createCatalogReader(prisma).read(authenticatedContext)` obtains accountId only
from the trusted backend AuthContext. A client cannot supply or override it.
Queries constrain variant, product, category and account tenant identities.
Returned rows are checked again against that identity and fail closed on leakage.
Inactive products/variants are excluded; zero-stock records remain visible so a
unique match can report INSUFFICIENT_STOCK instead of disappearing.

The dependency exposes only `productVariant.findMany`. Its select excludes all
cost, profit, margin and accounting fields, even for OWNER. An explicit response
allowlist also protects against repository objects containing extra properties.
Selling prices are Decimal strings with two decimal places, matching the schema's
Decimal(18,2); no Number conversion is used. Null and zero prices retain their
actual representation. Current stock and account currency come from the database.

Each request scans newest eligible variants first in keyset pages of 200, ordered
by createdAt then id. At most 1,000 variants plus one coverage sentinel are read,
using at most six queries. Exactly 1,000 records is complete; the sentinel proves
when additional records exist. No offset pagination or cross-request price/stock
cache is used. New Entry-created records are visible on the next request without
training or product-name configuration.

For larger catalogs, INCOMPLETE with `catalog_coverage` prevents a false claim of
uniqueness. Older records outside this bounded window may not be suggested. This
is a conservative MVP bound, not a complete search index. Future scaling should
add selective, catalog-aware retrieval and explicit coverage guarantees.

## Matching and safety

1. Validate the trusted role/tenant and parse the raw text using unchanged Phase 1B.
2. Invalid input or unsupported multiple items returns INVALID_INPUT without a
   catalog query. Conflicting attributes return AMBIGUOUS; other unresolved numeric,
   negation or untrusted-transcription issues return INCOMPLETE before querying.
3. Read the current tenant catalog and normalize names/variants through Phase 1A.
   Reuse exact domain aliases and longest phrases; do not use substring size lookup.
4. Verify color/size against actual variant columns. Numeric sizes can be resolved
   in the real size-column context. Quantity must come from explicit parser evidence,
   never from a default or a catalog number.
5. Verify type and descriptors using explicit aliases in the real product name
   (or an exact category alias for type). Contradictory evidence rejects a candidate;
   absent descriptor evidence remains an unresolved constraint. No fictitious schema
   columns or material/style facts are inferred from a generic type.
6. Preserve lexical alternatives such as PANTS/JEANS and compare all supported
   alternatives. An exact literal name phrase can ground a candidate without
   changing the parser's grammatical ambiguity. The entire parser result remains
   in the response, including unknown tokens and alternative interpretations.
7. Require all unknown brand/model words to occur as exact whole tokens in their
   spoken order and multiplicity. Every distinct semantic/name atom of the actual
   name must be supported for full identity. Type alone cannot silently select
   Classic, Polo or Oversized. Repeated normalized name atoms do not create extra
   linguistic meanings; original display names and IDs remain distinct records.
8. Prefer fully supported names; broad candidates retain missing `product_name`.
   Prefix-only name overlap can supply suggestions but cannot supply a final match.
9. Require explicit quantity and any non-null variant attributes not already
   supplied. An unpriced candidate needs `selling_price`. Null color/size are never
   invented. Multiple plausible candidates remain ambiguous even when other fields
   are missing; the missing fields are still returned.
10. Only a unique, complete, fully covered candidate may return MATCHED. Check
    requested quantity against its current stock afterward; stock availability is
    never a tiebreaker for duplicate variants.

Unknown brands are not discarded or automatically transliterated. For example,
Arabic `كلاسيك` cannot silently match an English `Classic` catalog token without a
supported alias. Dictionary collisions and uncertain transcriptions remain under
the Phase 1A/1B safety rules.

## Result contract and API

`matchVoiceSaleText(text, authenticatedContext)` is supplied by the service factory.
The pure `matchParsedCatalog(parser, snapshot)` comparator is an internal building
block: callers must use the guarded service for user input and tenant authorization.

`POST /api/voice-sales/match` accepts only:

```json
{ "text": "Tshirt Classic sawda XL two pieces" }
```

Use the existing Bearer access token. Client accountId, pre-parsed attributes,
additional body keys and query parameters are rejected. Phase 1B's existing 4,096
UTF-16 code-unit bound, control-character validation and input rules apply.
Invalid shape/text returns 422; authentication/authorization uses existing 401/403
errors; costly-read throttling returns 429 with Retry-After. Valid matching outcomes
return 200. Unexpected errors use the existing sanitized 500 envelope.

Top-level result fields:

| Field | Meaning |
| --- | --- |
| status | MATCHED, AMBIGUOUS, INCOMPLETE, NOT_FOUND, INSUFFICIENT_STOCK, INVALID_INPUT |
| reason | Stable machine-readable reason, such as UNIQUE_SUPPORTED_CATALOG_MATCH |
| parser | Complete Phase 1B result with evidence, residual tokens and ambiguities |
| match | Unique supported preview, or null; also present for INSUFFICIENT_STOCK |
| candidates | At most 20 tentative previews with their missing/unverified constraints |
| suggestions | At most 5 broad/prefix-only previews; never final selections |
| missingFields | Quantity, size, color, product_name, descriptor, price or coverage needs |
| requiresConfirmation | Always true |
| catalog | scannedVariants, truncated, candidateCount, candidatesTruncated |

Candidate fields are productId, variantId, productName, categoryName, color, size,
quantity, sellingPrice, availableStock, currency, evidence, missingFields,
unresolvedConstraints and requiresConfirmation. Evidence identifies the actual
variant column, product-name alias, category alias, literal name phrase or partial
suggestion supporting each comparison. Internal account IDs and financial costs
are not exposed. `categoryName` is display metadata, not an inferred taxonomy.

Illustrative response excerpt for a mocked catalog containing `Tshirt Classic`:

```json
{
  "status": "MATCHED",
  "reason": "UNIQUE_SUPPORTED_CATALOG_MATCH",
  "requiresConfirmation": true,
  "match": {
    "productId": "00000000-0000-4000-8000-000000010001",
    "variantId": "00000000-0000-4000-8000-000000000001",
    "productName": "Tshirt Classic",
    "color": "Black",
    "size": "XL",
    "quantity": 2,
    "sellingPrice": "12.50",
    "availableStock": 40,
    "currency": "USD",
    "missingFields": [],
    "unresolvedConstraints": [],
    "requiresConfirmation": true
  }
}
```

The full response also includes categoryName, evidence, candidates, suggestions,
parser and coverage metadata as specified above. This example is not a live
database test or a claim that this fixture product exists in a store.

MATCHED is advisory and never creates a Sale, reserves inventory or authorizes
checkout. Prices and stock can change after the preview (including between reader
pages); existing Sales validation and transactional stock logic remain authoritative
at any eventual checkout. No new snapshot transaction is introduced in this phase.

## Tests, limitations and next phase

Run `npm test --workspace server`, `npm run typecheck --workspace server`, and
`tsc -p backend/tsconfig.json` from the repository root. Tests use Node's existing
runner with mocked Prisma rows and localhost HTTP servers; no live Supabase
requests or production writes are performed. All 27 requested coverage categories
are exercised, with additional rate-limit, error-envelope, Decimal precision,
projection, freshness, pagination and coverage-limit checks.

Limits include the bounded catalog window, finite dictionary sizes/quantities,
no arbitrary brand transliteration, no fuzzy final selections, no semantic
material/style columns, and unsupported negation/multiple-item speech. Names that
collide with quantity words or conversational expressions may need catalog-aware
parser improvements later; no language rules are weakened here to force a match.
This implementation does not promise recognition of every arbitrary Entry name.

Next proposed phase: **Text Matching Lab / POS integration preparation**, after
approval. Phase 1C adds no UI, Cart mutation, checkout or audio workflow.

Quantities v2 adds an optional `quantityIntent` to the parser response. The service
blocks unresolved units, modifiers, metadata amounts and conflicting counts before
catalog reads. The pure matcher also refuses to use a numeric quantity if this
intent is unresolved. An exact PIECE count previews whole sellable ProductVariants;
product names do not supply packaging/BOM conversions. Stock/Decimal price checks,
trusted Account scope, financial projection, bounded coverage and confirmation
remain unchanged. The development Lab displays a whitelisted intent summary only,
and remains absent from production frontend bundles. Tests use synthetic catalogs;
they do not verify a live Supabase catalog. See QUANTITIES_ACTIVATION.md for results.

Multi-item matching adds `items` and `segmentation` only after deterministic
boundaries are established. Repeated request markers remain supported. Arabic
`و` (attached or separate), Arabizi `w`, and English `and` are accepted only when
every resulting clause has independent product evidence and owns at least one
local attribute. Colors, materials, fits, alternatives, and unclear product scope
stay unsplit. Each accepted clause is parsed and matched independently against one
authenticated tenant-scoped catalog snapshot and always requires confirmation.
