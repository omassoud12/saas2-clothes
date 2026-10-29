# Text Matching Lab — Phase 2

## Opening the lab

Run the existing frontend development command and backend development command.
Sign in normally as an active OWNER or WAREHOUSE, then visit:

`http://localhost:5173/app/dev/text-matching`

The route is deliberately absent from normal navigation and POS. It is an
on-demand, lazy-loaded development tool, not a new checkout interface. The
frontend remains JavaScript/JSX according to ARCHITECTURE.md; this phase does not
introduce TypeScript configuration, a new router or test dependencies.

Production Vite builds replace `import.meta.env.DEV` with false. The root App
returns NotFound for direct lab navigation before loading the authenticated
workspace. The route resolver defaults to production-denied, the lazy import
exists only in the development branch, and the page checks the environment and
active tenant profile again. Automated production-bundle verification checks
that the lab component, stylesheet and matching request implementation are absent.
Existing backend authentication/authorization remains authoritative; Phase 1C's
API is unchanged by this frontend-only development gate.

## Components and behavior

- `pages/app/TextMatchingLabPage.jsx`: guarded page, manual form and responsive
  diagnostic components for Parser, Catalog, candidates, suggestions and evidence.
- `text-matching-flow.js`: input validation, authenticated request, strict response
  projection and a one-request-at-a-time controller.
- `text-matching-lab.css`: scoped two-column desktop / single-column mobile styles,
  wrapping long text, touch-sized buttons and shared semantic theme tokens.
- `text-matching-flow.test.js`: route/access, transport, schema safety and lifecycle tests.
- `text-matching-ui.test.js`: actual React markup tests and production build exclusion.
- `testing/match-fixtures.js`: synthetic fixtures imported by tests only.

Enter a sentence and click **Test Match**. Typing and **Use example** never send
requests. Reset clears text/results/errors and invalidates an old response. If a
POST is already running, the controller stays busy until it settles: the shared
transport does not cancel POST requests. No duplicate submission, automatic retry
or polling of the endpoint is introduced. Changing text, resetting, changing the
profile key or unmounting prevents an older response from replacing the current
view. A 429 Retry-After cooldown survives reset; a local timer updates its display
without any network call. The backend still enforces the actual rate limits.

The lab displays the original editable sentence, server-normalized text, all
typed parser attributes and their evidence, unknown/residual words, missing and
unresolved information, lexical alternatives/conflicts, match evidence, stock,
Decimal-string selling prices, alternative candidates, suggestions and bounded
catalog coverage. Early parser/input failures explicitly say the catalog was not
queried, rather than claiming that a zero-record scan verified an empty catalog.
Suggestions and tentative candidates are labelled unconfirmed. A matched preview
always requires confirmation and has no cart, sale, stock, price-edit or checkout
action. Evidence is expandable so large diagnostic results remain manageable.

## API integration and security

The existing `authenticatedApiRequest` obtains the existing Supabase Auth session
and calls the centralized API transport. The only business request is:

```http
POST /api/voice-sales/match
Authorization: Bearer <existing session>
Content-Type: application/json
```

```json
{ "text": "بدي T-shirt سودا قياس XL قطعتين" }
```

No accountId, role, price, product ID or pre-parsed attribute is sent. Supabase is
used for authentication only; browser business-data queries are not added. Parser
and matching code are not imported into React. Frontend validation only checks
nonempty input, the existing 4,096 UTF-16 code-unit bound and malformed/control
characters; all language interpretation remains server-side.

Phase 1C's INVALID_INPUT response uses HTTP 422 with a structured match result.
The shared transport now has an optional `acceptedStatuses` argument, forwarded
by the authenticated helper. Only this lab opts into 422 so it can validate and
display that domain result. Other callers retain the existing error contract.
An ordinary 422 error envelope remains a safe validation error. 401 offers the
existing sign-in route; 403, 429, network and server failures have fixed safe
messages. Provider details and authentication tokens are never rendered.

Response projection allowlists candidate, parser and evidence properties and
removes extra cost, COGS, profit, margin and credential properties before they can
enter presentation state. Malformed or contradictory confirmed-match contracts
fail closed. Prices remain strings and reuse `formatMoney`; no financial arithmetic
or lossy Number conversion is performed. React escapes display text; no raw JSON
dump or HTML injection is used. Results are local component state only, with no
localStorage persistence or shared catalog cache.

## Verification and scenario coverage

Commands from the repository root:

- `npm test --workspace client`
- `npm run lint --workspace client`
- `npm run build --workspace client`
- `npm test --workspace server`
- `npm run typecheck --workspace server`
- `tsc -p backend/tsconfig.json`

The frontend has no TypeScript configuration/typecheck script, and the backend
has no lint script; this phase follows the available checks rather than claiming
those checks ran.

| Scenarios | Automated verification |
| --- | --- |
| Lebanese Arabic, English, Arabizi, mixed language | Raw text is unchanged through the authenticated client; Phase 1C tests verify matching semantics against mocked catalog rows |
| Exact/dynamic/Entry-added/similar names, variants | Existing Phase 1C tests plus frontend contract/candidate rendering tests |
| Missing quantity/size, ambiguity, unknown words | Frontend diagnostic fixtures and existing parser/matcher tests |
| Out-of-stock/insufficient stock/no selling price | Server eligibility/stock tests and frontend unconfirmed/price preview fixtures |
| Invalid text, unclear multi-item scope, oversized input | Zero-call local validation and structured 422 result preservation |
| Unauthorized role/inactive account/tenant isolation | Lab route/page guards and unchanged Phase 1C authenticated HTTP/repository tests |
| Empty catalog / coverage limits | Server bounded-read tests and frontend coverage/result rendering tests |
| Errors/429/duplicates/reset/stale responses | Mocked transport and controlled deferred-request lifecycle tests |
| Production direct-route access | Default-denied resolver, root/page development gates and actual production-bundle exclusion test |

All automated tests are mocked/local tests. React tests render real JSX through
Vite SSR with a synthetic null Auth client; they do not imply browser DOM interaction
or visual verification at actual device sizes. The production build check uses a
separate no-environment directory and writes no build artifact.

This original Phase 1D verification section records the Lab's text-only baseline.
Phase 1E later verified the authorized development catalog; the Phase 2 additions
below preserve that matcher and its dictionary behavior.

## Phase 2 voice transcription

The development Lab now includes an optional, user-initiated MediaRecorder flow:

- **Start recording**, **Stop recording** and **Cancel** controls with elapsed time.
- Automatic stop at 30 seconds and a 5 MiB client/server size limit.
- Microphone tracks stop after stop, cancel, error and component cleanup.
- Audio stays in memory and is never written to browser or backend storage.
- The transcript is editable and must be explicitly confirmed before the
  separate **Run catalog match** action calls the existing matching endpoint.
- Editing confirmed text invalidates confirmation; no voice action creates a
  Cart, Sale, InventoryMovement or stock change.

`voice-recording-flow.js` owns the browser recording, bounded authenticated
multipart request and confirmation lifecycle. `voice-recording-flow.test.js`
tests permission denial, unsupported formats, start/stop/cancel, limits, retry,
Arabic/English preservation and stale-result cancellation with a mocked provider.

Authenticated `POST /api/voice-sales/transcribe` accepts exactly one `audio`
file and `durationMs`. The backend validates the active OWNER/WAREHOUSE tenant,
MIME and container signature, duration and size before calling ElevenLabs
Speech-to-Text with `scribe_v2` and a bounded timeout. The response exposes only
text, an optional language hint/probability and model identity.

`ELEVENLABS_API_KEY` is backend-only and optional for server startup. Missing
configuration returns a safe 503. No `VITE_` ElevenLabs variable exists, and
audio, transcript, provider body and credentials are never logged. Automated
tests mock ElevenLabs; a real smoke test must be initiated by an authenticated
employee pressing the recording control.

## Multi-item transcripts

The matcher now adds `items` and `segmentation` only when repeated explicit
request markers establish conservative item boundaries, for example two clauses
starting with `بدي` or `bdi`. Each segment runs through the existing parser and
the same authenticated, tenant-scoped catalog snapshot independently. Colors,
sizes and quantities never cross segments, and missing quantity remains missing.
Single-item responses retain their previous contract.

Conversational endings `يا كبير`, `يا معلم` and `يا خيي` are removed only as
exact vocative phrases. Attribute links `لونه` and `لونها` are treated as grammar,
while genuine size wording such as `قياس كبير` remains available to the size
parser. In a segment such as `بنطلون polo`, Pants stays the explicit product type
and `polo` remains literal product-name/model evidence that must be proven by the
real catalog. A standalone Polo request keeps its existing ambiguity.

Conjunctions or adjacent product words alone do not create boundaries. Negation,
correction, empty clauses and unclear shared modifier scope keep the existing
fail-closed result. The Lab renders separate parser/catalog cards and requires a
separate local review acknowledgement for every item. These acknowledgements
perform no API request and cannot add to Cart, reserve stock or create a Sale.

Next proposed phase: **employee-confirmed Voice Sale POS integration** with the
existing atomic Sale safeguards.
