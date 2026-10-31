# Phase 1E — authenticated real Supabase catalog verification

Date: 2026-10-11 (Asia/Beirut).

**STATUS: PASS for the authenticated OWNER tenant and real catalog matching path.**

The local application reached the configured Supabase-backed catalog through the
existing authenticated endpoint. Eleven read-only scenarios completed against the
authorized synthetic-data store `abu ali x9`: the eight requested inputs plus one
exact in-stock match, one insufficient-stock match and one exact Arabizi match.

Live cross-tenant A/B and WAREHOUSE-role checks remain unavailable because only one
authorized OWNER session and one authorized tenant were present. Their enforcement
continues to pass the guarded API regression suite with tenant doubles; this is not
represented as a live two-tenant result.

## Live environment and catalog evidence

- Frontend: `http://localhost:5173/app/dev/text-matching`.
- Authenticated role: OWNER.
- Authorized test store: `abu ali x9`.
- Catalog observed from the authenticated application: 3 active products, 36 active
  variants and 41 units on hand.
- Every catalog query reported complete coverage of all 36 eligible variants except
  the deliberately blocked negation case, which stopped before a catalog read.
- No token, key, password, connection string or private identifier was copied or
  printed. Authentication was used only through the existing browser session.

## Live requested scenarios

| Input | Parser result | Live catalog result |
| --- | --- | --- |
| `بدي تي شيرت سودا XL قطعتين` | T_SHIRT, BLACK, XL, quantity 2; no unknown words | NOT_FOUND; 36 variants scanned; no exact Black/XL variant |
| `bdi tshirt black size xl 2 pieces` | Same canonical attributes; `bdi` recognized as request | NOT_FOUND; 36 variants scanned |
| `بدي بنطلون جينز قياس W32 L30` | JEANS and composite size JEANS_W32_L30; quantity missing; denim remains context-sensitive | NOT_FOUND; 36 variants scanned; no Jeans catalog candidate |
| `بدي فستان ساتان خمري` | SATIN_DRESS; satin descriptor retained; خمري preserved as BORDEAUX/BURGUNDY/MAROON_RED/WINE_RED alternatives | NOT_FOUND; no forced color or material choice |
| `بدي قميص قطن أبيض` | SHIRT, COTTON and WHITE; size and quantity missing | NOT_FOUND; no matching Shirt candidate |
| `بدي تي شيرت oversized` | T_SHIRT and OVERSIZED; other required variant details missing | AMBIGUOUS; 36 candidates; fit shown as an unverified constraint |
| `بدي بلوزة موردة` | BLOUSE/TOP and floral alternatives remain context-dependent | NOT_FOUND; no arbitrary product or pattern selection |
| `ما بدي منقط، بدي مخطط` | dotted alternatives excluded; striped alternatives requested; unsupported multi-clause structure retained | INCOMPLETE; zero catalog rows read; no product selected |

The live statuses differ from synthetic fixture statuses when the real store lacks
the fixture product. That is expected: dictionary recognition never invents a real
Product or ProductVariant and never forces MATCHED.

## Exact real ProductVariant checks

The Lab identified an existing variant without writing to the database:

| Input | Result | Real catalog evidence |
| --- | --- | --- |
| `t chirt zara white L 1 piece` | MATCHED | Product `t chirt zara`; White / L; price 12.00 USD; stock 2; requested 1 |
| `t chirt zara white L 3 pieces` | INSUFFICIENT_STOCK | Same variant and price; requested 3 exceeds stock 2 |
| `bdi t chirt zara bayda L kt3ten` | MATCHED | `bdi`, `bayda` and `kt3ten` resolved; same White / L variant; requested 2; stock 2 |

All previews retained `requiresConfirmation`. The Lab did not add to a cart, reserve
stock, create a Sale or update stock. Re-reading the same variant continued to report
stock 2, confirming these requests were read-only.

## Dictionary and parser coverage confirmed live

- Product Types: Arabic, English and Arabizi T-Shirt aliases resolved; JEANS, SHIRT,
  SATIN_DRESS and BLOUSE/TOP source concepts remained available.
- Colors & Shades: BLACK and WHITE resolved across Arabic, English and Arabizi;
  wine-color alternatives remained ambiguous instead of collapsing.
- Sizes: XL and L stayed distinct; JEANS_W32_L30 resolved as a composite and was not
  treated as quantity.
- Quantities: Arabic `قطعتين`, English `1 piece` / `3 pieces`, and Arabizi `kt3ten`
  resolved to safe sellable-unit counts.
- Materials: COTTON resolved; SATIN and DENIM retained the required context/catalog
  evidence behavior.
- Fits & Cuts: OVERSIZED resolved as a fit and did not become an XL size.
- Patterns & Prints: floral, dotted and striped alternatives remained explicit;
  negation blocked selection.
- Common Expressions: Arabic `بدي` and Arabizi `bdi` were recognized as request cues.

Material, fit and pattern concepts are language constraints only. The matcher did
not pretend they were Prisma columns and did not certify composition from vocabulary
alone.

## Authorization, tenant and response safety

- The route accepted only the existing authenticated OWNER session and resolved the
  active Account on the backend. The Lab did not submit a client-selected account ID.
- The catalog reader is read-only, Account-scoped and returned only Product/Variant
  labels, selling price, stock and bounded evidence.
- Purchase cost, COGS, margin, profit and other OWNER-sensitive accounting internals
  were absent from the matching output.
- The live session established correct current-tenant behavior. A second authorized
  tenant and a WAREHOUSE session were not available, so no live A/B comparison or
  live WAREHOUSE response was attempted.
- The backend regression matrix runs all eight requested inputs for OWNER and
  WAREHOUSE with an injected foreign-tenant variant and asserts that the foreign ID,
  price and Account never appear. It also asserts zero writes and unchanged stock.

## Verified behavior and fixes

No parser or matcher defect was reproduced that required an implementation change.
The negated/alternative pattern sentence intentionally remains clarification-only:
its pattern parser preserves the excluded and requested descriptors, while the
general common-expression safety layer blocks a sale preview before querying the
catalog. This matches the documented MVP safety contract.

No dictionary, parser, matcher, API, frontend or database implementation was changed
during the live verification. Earlier Phase 1E synthetic regressions remain in
`matching.test.ts`; this report was updated with the authenticated evidence.

## Regression and build results

| Check | Result |
| --- | --- |
| Authenticated live requests | PASS: 11/11 requests completed safely |
| Requested live scenario matrix | PASS: 8/8 produced conservative, catalog-grounded outcomes |
| Exact real match | PASS: MATCHED with correct product, color, size, quantity, price and stock |
| Insufficient stock | PASS: INSUFFICIENT_STOCK; stock unchanged |
| `npm.cmd test --workspace backend` | PASS: 13,570 tests, 144 suites, 0 failures/skips |
| Phase 1E synthetic API matrix | PASS: 16/16; 8 inputs × OWNER/WAREHOUSE |
| `npm.cmd test --workspace frontend` | PASS: 394 tests, 56 suites, 0 failures/skips |
| `npm.cmd run typecheck --workspace backend` | PASS |
| `npm.cmd run lint --workspace frontend` | PASS |
| `npm.cmd run build --workspace backend` | PASS; Prisma Client 7.10.0 generation, TypeScript and resource copy only |
| `npm.cmd run build --workspace frontend` | PASS |

The first `npm` invocation was blocked by the machine's PowerShell script policy
before tests started. The same commands were rerun through the standard Windows
`npm.cmd` executable and passed. No execution-policy setting was changed.

## Remaining limitations

- Live tenant A/B isolation requires a second existing authorized test tenant/session.
- Live WAREHOUSE output verification requires an existing authorized WAREHOUSE
  session. No account or data was created for either check.
- The current catalog has no exact products for Jeans, Dress, Shirt or Blouse
  scenarios, so those real requests correctly demonstrate NOT_FOUND/ambiguity safety
  rather than successful SKU selection.
- The parser remains conservative for multi-clause negation, generic floral wording
  and wine-color synonyms. Clarification is required before any later sales flow.

## Safety confirmation

- Database writes: NO.
- Database/schema migrations: NO.
- Checkout, Sale, cart, reservation or inventory mutation: NO.
- Railway or infrastructure change: NO.
- Deployment: NO.
- Commit: NO.
- Secrets exposed: NO.
- Protected PDF inspected or modified: NO.

