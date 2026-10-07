# SaaS2 performance audit — 2026-10-04

Scope: Inventory startup, Products, authentication, Express middleware, Prisma,
the configured Supabase PostgreSQL connection, mutation statement structure,
conditional requests, and frontend refresh behavior. This is a diagnostic audit.
No optimization, business-logic change, migration, commit, push, or deployment
was performed.

## 1. Executive verdict

The multi-second latency is real and is not explained by JSON size, React
rendering, or the Vite proxy's processing time. Three mechanisms combine:

1. Local Node talks through TLS to a remote Supabase Session Pooler. A warm
   `SELECT 1` had a 253.94 ms p50; even indexed single-row lookups therefore
   cost about a quarter second before useful work.
2. Every protected request independently calls remote
   `supabase.auth.getUser(accessToken)`, then queries User and Account. The five
   Inventory reads repeat this authentication/context work five times. The
   initial `/api/auth/me` performs another User lookup plus its profile relation
   reads.
3. Inventory mounts Receipt history, Movement history, and Stock check while
   they are hidden. Development StrictMode starts the five Inventory effects a
   second time without aborting the first fetches. The result is ten business
   requests after the profile gate, plus ten remote Auth checks and twenty
   User/Account lookups.

The current local topology amplifies query count into seconds. A five-dataset
read wave produced a Prisma transaction-start timeout in one controlled run;
an earlier run failed while opening a database connection. Another ten-call
run completed, showing the failure threshold is connection-state dependent,
not a deterministic query defect.

The Vite proxy added roughly 1–2 ms to a health request, so it is not the
server-wait bottleneck. It did return `Connection: close`, while the direct
backend returned keep-alive. With ten slow HTTP/1.1 requests from one browser
origin, that development behavior makes the HAR's second-wave browser queueing
credible.

No P0 correctness or data-integrity finding was discovered. The main findings
are P1 performance architecture issues. The new receiving transaction is
correctly bounded and was subsecond for 200 options on local PostgreSQL in the
Phase 2 evidence; its current 8.2-second HAR result is explained by many serial
remote round trips plus authentication.

## 2. Tested architecture

```text
Chrome on localhost
  -> HTTP/1.1 localhost:5173
  -> Vite development proxy
  -> HTTP localhost:3001
  -> Express request/security/rate-limit middleware
  -> Supabase Auth getUser over HTTPS
  -> User lookup through Prisma
  -> Account lookup through Prisma
  -> route controller/service
  -> reusable PrismaClient + pg Pool
  -> TLS-verified Supabase Session Pooler :5432
  -> Supabase PostgreSQL
```

Production differs at the first hop: the built frontend uses `VITE_API_URL` to
call the separate Railway API and does not use Vite. The repository confirms
Railway as backend host and Supabase as database/Auth host. The runtime database
hostname structurally identifies an `ap-northeast-1` Session Pooler. Railway's
actual production region is not recorded in the repository, so production
region alignment cannot be confirmed.

The backend creates one PrismaClient, one `pg.Pool`, and one Supabase verifier
client at startup. Prisma is not instantiated per request. The pool uses the pg
default maximum of 10 because `max` is not configured, with a 5-second
connection timeout, 30-second idle timeout, verified CA, and full certificate
validation. The HTTP server uses a 5-second keep-alive timeout.

## 3. HAR baseline

| Request | HAR total | HAR waiting | Interpretation |
| --- | ---: | ---: | --- |
| `GET /api/auth/me` | 3026 ms | 3020 ms | Almost entirely before response bytes |
| `GET /api/inventory/receipts?page=1` | 5786 ms | 5777 ms | Auth/context + relation queries + contention |
| `GET /api/inventory/movements` | 4695 ms | 4685 ms | Auth/context + relation queries + contention |
| `GET /api/inventory/reconciliation` | 2348 ms | 2340 ms | Auth/context + transactional reads |
| `GET /api/categories` | 2626 ms | 2617 ms | One business SELECT after repeated auth/context |
| `GET /api/products?page=1&limit=12&isActive=all` | 2891 ms | 2881 ms | Parallel list/count followed by relation reads |
| `POST /api/inventory/product-setups` | 8236 ms | 8231 ms | Auth/context + many serial transaction statements |
| `PATCH /api/products/:productId` | 4796 ms | 4791 ms | Auth/context + 4–5 business query events |

Download time is only 5–10 ms in these samples. The baseline therefore measures
server/remote-service wait and browser queueing, not large response transfer.

## 4. Frontend duplicate-request findings

`AppRouteGuard` starts `loadBusinessAppProfile`, which obtains the current
Supabase session and calls `/api/auth/me`. Its `useRef` retains the in-flight
promise through StrictMode's development setup/cleanup/setup cycle, so
`auth/me` is normally one request per guard mount, not two.

Inventory renders only after that profile promise resolves. It then mounts all
four views at once. `hidden` changes presentation but does not unmount child
components. The initiators are:

| Request | Initiator | Initially needed? | Dev calls |
| --- | --- | --- | ---: |
| `/api/products?...isActive=all` | `InventoryPage` effect `[filters, version]` | Yes, for Stock & receiving | 2 |
| `/api/categories` | `InventoryPage` effect `[]` | No; needed when New product opens | 2 |
| `/api/inventory/receipts?page=1` | `ReceiptHistory` effect | No; tab is hidden | 2 |
| `/api/inventory/movements` | `InventoryHistory` effect | No; tab is hidden | 2 |
| `/api/inventory/reconciliation` | `InventoryReconciliation` effect | No; tab is hidden | 2 |

The cleanup flags only suppress stale React state updates. They do not use an
AbortController and do not stop the first network request. StrictMode therefore
causes the second five-request wave in development. Dependency arrays are not
otherwise looping on initial mount. No route loader duplicates these reads.
Products and Categories are independently requested once by their Inventory
owners per production mount; the duplication comes from StrictMode, not two
different visible components.

Opening Inventory with `?productId=...` adds a `getProduct` effect. That effect
is also subject to the development double invocation, while all hidden history
datasets still load behind the receiving flow.

## 5. Browser blocked/queue findings

Ten direct health calls to port 3001 ranged from 1.19 to 1.75 ms. Ten calls
through Vite ranged from 2.80 to 3.85 ms. Vite's processing cost is therefore
about 1–2 ms on this route.

The direct backend health response was HTTP/1.1 with:

```text
Connection: keep-alive
Keep-Alive: timeout=5
```

The same response through Vite was HTTP/1.1 with `Connection: close`. The
Inventory development page starts ten slow requests from one browser origin.
Browser HTTP/1.1 connection limits mean some requests cannot be sent until a
socket is available; `Connection: close` also removes reuse between responses.
That time is recorded as browser **blocked/queued**, before Express receives the
request. Once sent, the multi-second **waiting/TTFB** is remote Auth, pool, and
database work. These two numbers must not be added as if both were backend
execution.

The supplied HAR and response headers support this explanation. Exact Chrome
socket allocation was not re-captured because no browser surface was available
in the audit environment.

## 6. Auth timing breakdown

The bearer token is not locally verified. `resolveVerifiedIdentity` calls the
shared Supabase client's `auth.getUser(accessToken)` on every protected request.
After that call:

- `createRequireAuth` performs one User lookup.
- `createRequireTenant` performs one separate Account lookup.
- `/api/auth/me` performs another User/profile lookup; Prisma resolves its
  Account relation as a second SQL query.
- Role/account-state checks themselves are synchronous and negligible once the
  rows have returned.

Direct warm measurements against the configured database were:

| Auth database stage | p50 | average | p95 | query events |
| --- | ---: | ---: | ---: | ---: |
| Application User lookup | 252.67 ms | 254.56 ms | 267.43 ms | 1 |
| Account status lookup | 255.14 ms | 302.46 ms | 708.62 ms | 1 |
| `/auth/me` profile + Account relation | 508.42 ms | 558.07 ms | 971.94 ms | 2 |

A public Supabase Auth health request had a 746.62 ms cold result and warm
259.91/351.31/325.38/387.23/387.23 ms min/p50/average/p95/max. This measures the
network/edge path, not authenticated `getUser` processing.

For the HAR's `/auth/me`, the three measured database queries account for about
761 ms at warm p50. Express/Vite pre-auth overhead was under 10 ms on missing-
token probes. The remaining roughly 2.26 seconds is therefore the upper-bound
residual for `getUser`, remote network/provider work, and run-specific pool
contention. It is an inference from matched HAR plus direct database timings,
not a directly timed authenticated provider call.

Authentication is not repeated inside one router request beyond the single
middleware chain. It is repeated across every concurrent endpoint. The
Supabase client is safely reused; multiple clients are not being created.

## 7. Prisma/DB timing breakdown

An isolated temporary Prisma query-event probe ran one cold and ten sequential
warm, read-only service calls. No SQL parameters or business identifiers were
logged.

| Read/service | Cold | Warm min | p50 | average | p95/max | Query events | Payload |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `SELECT 1` | 308 ms | 253 ms | 254 ms | 313 ms | 835/835 ms | 1 | 13 B |
| Categories | 266 ms | 249 ms | 253 ms | 253 ms | 258/258 ms | 1 | 142 B |
| Products full | 2510 ms | 552 ms | 585 ms | 836 ms | 1551/1551 ms | 4 | 8,834 B |
| Receipt history | 769 ms | 751 ms | 760 ms | 785 ms | 998/998 ms | 5 | 764 B |
| Movement history | 1051 ms | 802 ms | 815 ms | 836 ms | 1033/1033 ms | 4 | 9,402 B |
| Reconciliation | 1558 ms | 1508 ms | 1524 ms | 1664 ms | 2474/2474 ms | 4* | 5,682 B |

`*` Reconciliation also has transaction begin/commit protocol work that Prisma's
query event did not expose as model query events.

Query-duration sums can exceed wall time because independent Prisma queries run
in parallel. Products uses `Promise.all(findMany, count)`, and relation loading
can occupy more than one pool connection.

A fresh Products summary call returned 2,084 bytes but still emitted four
queries and took 2.94 seconds because two query events spent 2.32 and 2.66
seconds while the fresh pool established/contended for parallel connections.
The payload is smaller; the round-trip structure is the same.

## 8. Endpoint timing table

The table separates the supplied end-to-end HAR from directly measured warm
database/service work. Provider/queue residual is not presented as a precise
Supabase Auth number because the requests ran under a concurrent browser wave.

| Endpoint | HAR total | Business service p50 | DB query events including User/Account | Slowest direct business result | Payload |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/api/auth/me` | 3026 ms | 508 ms profile | 3 | 972 ms p95 profile + 253 ms User | 303 B profile object |
| `/api/categories` | 2626 ms | 253 ms | 3 | 258 ms | 142 B |
| `/api/products` full | 2891 ms | 585 ms | 6 | 1551 ms | 8,834 B |
| `/api/inventory/receipts` | 5786 ms | 760 ms | 7 | 998 ms | 764 B |
| `/api/inventory/movements` | 4695 ms | 815 ms | 6 | 1033 ms | 9,402 B |
| `/api/inventory/reconciliation` | 2348 ms | 1524 ms | 6 model events + transaction control | 2474 ms | 5,682 B |

Request parsing, role checks, and JSON shaping are in-process. They were not
separately observable at high resolution without an authenticated browser
request, but the small payloads and 5–10 ms HAR downloads show they are not the
multi-second component. Express's existing request logger does record total
duration, though not stage timings.

## 9. `POST /api/inventory/product-setups` deep dive

For a new Product with receiving, the current transaction performs:

1. begin transaction;
2. set the transaction-local lock timeout;
3. acquire the receipt advisory lock;
4. look for a replayed Product operation;
5. look for a conflicting receipt operation;
6. lock/validate Category;
7. insert Product;
8. bulk-insert all ProductVariant definitions;
9. lock/validate Product;
10. lock/validate selected variants;
11. insert StockReceipt;
12. for each received option, serially update ProductVariant, insert
    InventoryMovement, and insert StockReceiptItem;
13. reload StockReceipt plus items, variants, Product, and actor through five
    relation queries;
14. commit.

The approximate SQL/protocol count is `17 + 3m`, where `m` is the number of
received options. Two, three, and four received options therefore require about
23, 26, and 29 statements/round trips. The `for (...) { await ... }` loop is
strictly serial. Validation/fingerprinting is synchronous and is not the cause.

At the measured ~250 ms remote round-trip floor, 26 serial round trips have a
6.5-second latency budget before remote Auth/User/Account work. Some relation
queries overlap, but the arithmetic quantitatively matches the ~8.2-second HAR
request for a few options.

The existing Phase 2 disposable PostgreSQL results were 103 ms for 24 options,
462 ms for 100, and 791 ms for 200. That contrast proves the receiving algorithm
is not spending eight seconds on application CPU or row volume. The current
local-to-remote network and statement count dominate. No mutation was rerun in
this audit.

## 10. `PATCH /api/products/:id` deep dive

The Product patch has no transaction and no explicit row lock. It performs:

1. current Product/category lookup;
2. active Category lookup when category changes or reactivation is requested;
3. Product update;
4. Category relation load for the response;
5. Variant relation load for the response.

A name-only patch is approximately four business query events; a category
change is approximately five. Adding the User and Account middleware lookups
makes six or seven database query events, plus the remote Supabase Auth call.
At a ~250 ms floor this is already 1.5–1.75 seconds of database network time.
Provider verification, lazy pool growth/outliers, and contention from other
Inventory requests explain the rest of the 4.8-second HAR result. Input
validation is synchronous; no uniqueness preflight or transaction lock explains
those seconds.

After success, Products uses the returned detail immediately and refreshes only
the Products list. It does not reload Inventory receipt/movement/reconciliation
views.

## 11. Inventory initial-load request waterfall

```text
/app/inventory
└── AppRouteGuard
    └── GET /api/auth/me                         one guarded request
        └── InventoryPage mounts after success
            ├── GET /api/products               visible and required
            ├── GET /api/categories             hidden creation prerequisite
            ├── GET /api/inventory/receipts     hidden tab
            ├── GET /api/inventory/movements    hidden tab
            └── GET /api/inventory/reconciliation hidden tab
                 development StrictMode repeats all five
```

Direct service measurements put Products alone at 585 ms warm p50. Categories
and Products started together took 2.03 seconds in one fresh-pool run. All five
started together produced a transaction-start timeout once. A ten-call
StrictMode-shaped run later completed in 2.05 seconds with 41 query events, but
an earlier ten-call run failed with a database connection timeout. The variance
is pool-connection state, not a stable speedup.

Only Products is required to render the initial Stock & receiving list.
Deferring Categories and the three inactive datasets would reduce production
startup business requests from five to one and development from ten to two.
This audit did not implement that change.

## 12. 304/cache findings

Express ETag support is enabled by default; the app does not disable it. The
observed backend responses include weak ETags and no explicit Cache-Control
policy. Express computes the handler result and response body before freshness
logic converts a matching conditional GET to 304. Authentication and database
queries therefore still execute.

A 304 saves response-body transfer, which is only hundreds of bytes to about
9 KB here. It does not save remote `getUser`, User/Account lookups, service
queries, or response shaping. This is why HAR 304 entries can still take
seconds. Shared/public caching would be unsafe for tenant-authenticated data;
no cache policy was changed.

## 13. Connection/pooling findings

- One reusable PrismaClient and pg Pool exist for the process.
- Runtime uses the Supabase Session Pooler on port 5432, not a per-request
  direct connection.
- TLS is verified with a CA and `rejectUnauthorized: true`.
- Pool maximum is pg's default 10; connection timeout is 5 seconds and idle
  timeout is 30 seconds.
- Connections are opened lazily. Parallel list/count/relation work can require
  additional TLS connections even when one warm connection already exists.
- A read wave failed once with `Connection terminated due to connection
  timeout`; another failed with Prisma `P2028: Unable to start a transaction in
  the given time`. A later ten-call wave succeeded. This is evidence of burst
  sensitivity, not proof that pool size should simply be raised.

Increasing `max` without verifying Supabase/Supavisor limits could move the
queue to the database and is not recommended from this audit alone.

## 14. Database/index findings

Read-only `EXPLAIN (FORMAT JSON)` was used without `ANALYZE` or mutation.

- Categories used the `(accountId, name)` unique index, followed by a tiny sort.
- Products used a sequential scan and sort, but the plan expected one tenant
  row. With this data size, that is cheaper than an index and does not explain
  seconds.
- Receipt history used a tenant/product/createdAt index and a tiny sort. The
  exact `(accountId, createdAt, id)` index also exists.
- Movement history used `(accountId, createdAt)` and incremental sort for `id`.
- Reconciliation used an account-leading ProductVariant index and a tiny sort;
  `(accountId, sku)` is already unique.

There is no evidence that a missing index is responsible for the current
latency: `SELECT 1` has the same ~250 ms floor, and all plans had one to three
estimated rows. At larger scale, `(accountId, createdAt DESC, id DESC)` for
Products and adding `id` to the Movement order index deserve re-evaluation with
real cardinality and read-only `EXPLAIN ANALYZE`. Receipt offset pagination may
also degrade on deep pages. No index or schema change was made.

## 15. Dev-only vs production-impact findings

| Finding | Development only? | Production impact |
| --- | --- | --- |
| StrictMode double effect execution | Yes | Production React build invokes each mount effect once |
| Vite proxy and `Connection: close` | Yes | Production calls Railway directly; live HTTP version/reuse unverified |
| HMR/module development overhead | Yes | Removed by Vite production build |
| Hidden tabs fetch on mount | No | Five production business requests still start |
| Remote `getUser` per protected request | No | Persists unless auth design changes securely |
| Separate User and Account lookups | No | Persists |
| Prisma relation/transaction round trips | No | Persists, though latency depends on region |
| Local Node to remote `ap-northeast-1` DB | Local topology | Railway-to-Supabase RTT is unknown |

Production may be much faster if Railway is geographically aligned with
Supabase and its edge connection uses HTTP/2/keep-alive. The repository does
not prove either fact, so localhost numbers must not be presented as production
latency predictions.

## 16. Root causes ranked P0/P1/P2/P3

### P0

None found. The audit did not identify a performance defect that corrupts data
or breaks authorization.

### P1

1. **Remote per-request Auth and database context:** every protected endpoint
   pays one remote Supabase Auth call and two database queries before business
   work.
2. **Eager Inventory fan-out:** four unnecessary datasets load with the initial
   view; StrictMode doubles all five business effects in development.
3. **High serial round-trip count in mutations:** Product setup performs about
   `17 + 3m` statements/protocol operations, and Product patch performs 4–5
   business query events.

### P2

1. Fresh pool growth is slow and bursts can hit connection/transaction start
   timeouts.
2. Vite returns `Connection: close`, amplifying development browser queueing.
3. Prisma relation loading turns logically single resources into 4–5 SELECTs.
4. Conditional 304 responses avoid bytes but not backend computation.

### P3

Payload size and current query plans are secondary. Possible future ordering
indexes and cursor receipt pagination matter with larger cardinality, not the
current tiny dataset.

### Required 22 questions, answered

| # | Answer |
| ---: | --- |
| 1 | `/auth/me` pays remote `getUser`, one User lookup, then two profile/Account queries. The DB portion is ~761 ms p50; the HAR residual is ~2.26 s for provider/network/contention. |
| 2 | Products pays remote Auth, User/Account, and four business query events; pool growth made some Product queries exceed two seconds. |
| 3 | Receipt history pays the same auth/context plus five relation queries; it also competes with four other datasets and their dev duplicates. |
| 4 | Product setup has about `17 + 3m` transaction statements. At ~250 ms per remote round trip, a few options plus auth quantitatively reach ~8 s. |
| 5 | Product PATCH performs 4–5 business events plus two auth-context DB queries and remote Auth; it has no expensive lock or CPU stage. |
| 6 | Auth-context DB is ~508 ms p50 before business work. `/auth/me` adds ~508 ms profile work. Auth provider time was not directly timed; HAR residual is up to ~2.26 s. |
| 7 | One remote DB round trip is ~254 ms p50. Business service p50 ranges from 253 ms to 1524 ms. |
| 8 | Auth/me 3; Categories 3; Products 6; Receipts 7; Movements 6; Reconciliation 6 model events plus transaction control. Product setup is ~`17 + 3m`; Product PATCH is 6–7 total events. |
| 9 | Yes in Product setup's per-item three-write loop and several relation/transaction phases. Product list/count is intentionally parallel. |
| 10 | PrismaClient itself is reused. Lazy pool connection establishment contributes during bursts; it is not per-request client construction. |
| 11 | Yes. Every protected request calls remote Supabase `getUser`; Auth health alone is ~351 ms warm p50. |
| 12 | Yes. Local Node uses the configured remote Supabase Session Pooler. |
| 13 | Unknown. Railway's production region is absent from repository/config evidence. |
| 14 | Not for the current dataset. Plans use tiny scans/indexes and `SELECT 1` has the same network floor. |
| 15 | No. Vite added roughly 1–2 ms processing, although its connection-close behavior contributes to browser queueing. |
| 16 | StrictMode re-runs mount effects; cleanup ignores stale results but does not abort the first requests. |
| 17 | Ten slow HTTP/1.1 requests exceed immediately usable browser sockets; Vite closes connections, so the duplicate wave waits before sending. |
| 18 | Yes for Categories, Products, Receipts, Movements, and Reconciliation. The guarded `auth/me` promise prevents its normal duplicate. |
| 19 | Yes. Receipt, Movement, and Stock check components mount and fetch while hidden; Categories also loads before New product opens. |
| 20 | No. Representative bodies are 142 B–9.4 KB and HAR download is 5–10 ms. |
| 21 | Express must authenticate, query, and construct the representation before ETag freshness converts it to 304. |
| 22 | Verify/align backend–database region; lazy-load/dedupe Inventory datasets; securely reduce Auth/DB and mutation round trips. |

## 17. Top 3 recommended optimizations

These are recommendations only.

1. **Verify production geography, then align Railway with Supabase if needed.**
   Region mismatch multiplies every Auth/SQL round trip. Measure live private
   backend-to-database RTT before moving anything.
2. **Fetch only the active Inventory view.** Load Products initially; load
   Categories on New product; load each history/check dataset on first tab use.
   Add request deduplication or abort support so development replays do not keep
   consuming network/server work.
3. **Reduce round trips without weakening security.** Evaluate Supabase's
   supported local JWT/JWKS verification model and revocation/key-rotation
   requirements; combine User/Account reads where semantics allow; use set-based
   receiving writes and return shaping that preserves the exact transaction,
   idempotency, tenant, role, and ledger contracts.

## 18. Expected benefit of each recommendation

1. Geography targets the measured ~250 ms floor on every SQL query. The exact
   production gain cannot be stated until Railway region and live RTT are known.
2. Active-view loading changes initial production business requests from five
   to one and development from ten to two. It removes three hidden datasets and
   the premature Categories request, plus their repeated Auth/User/Account work.
3. Round-trip consolidation directly attacks Products' four relation queries,
   Receipts' five, PATCH's 4–5 business events, and Product setup's `17 + 3m`
   operations. Phase 2's local PostgreSQL subsecond mutation results show the
   upside when network round trips are cheap.

These benefits are directional, not release promises. They require a separate
implementation and production-like benchmark phase.

## 19. Risks/tradeoffs

- Local JWT verification or auth caching must preserve signature validation,
  key rotation, expiry, revoked-session expectations, inactive User/Account
  checks, and role freshness. A speed change must not weaken authorization.
- Lazy tabs show a loading state on first activation and need explicit stale/
  refresh policy after mutations.
- Aborting fetches saves client/server work only where cancellation propagates;
  it must not be used for idempotent mutation recovery.
- Set-based receiving SQL is harder to review and must preserve ordered locks,
  stock bounds, per-item movements, immutable receipt links, and rollback.
- Raising pool size may overload Supavisor/PostgreSQL and does not remove RTT.
- Authenticated tenant responses must not receive shared/public caching.

## 20. Tests/validation results

- Read AGENTS.md, ARCHITECTURE.md, Prisma schema, all named Inventory reports,
  and relevant frontend/backend paths.
- Ran isolated read-only Prisma timing: one cold + ten warm samples for DB ping,
  auth lookups, Categories, Products, Receipts, Movements, and Reconciliation.
- Ran read-only `EXPLAIN (FORMAT JSON)` for the representative SELECT shapes;
  no `ANALYZE` and no mutation.
- Ran controlled 2-, 5-, and 10-call read concurrency probes; captured one
  connection timeout and one transaction-start timeout.
- Ran eleven read-only Supabase Auth health requests without a user token.
- Measured ten direct and ten Vite-proxied local health requests.
- Inspected direct/proxied response headers and unauthenticated middleware
  timing.
- Temporary measurement scripts compiled under the backend production build
  and were removed after capturing aggregate, sanitized results.
- Final backend Prisma generation and TypeScript production build passed after
  the temporary scripts were removed. The report has no trailing whitespace.
- No Product, receipt, movement, stock, user, or account data was changed.

## 21. `git diff --stat`

Plain `git diff --stat` produces no output because the only working-tree change
is a new untracked report. A standalone no-index stat for that file is:

```text
 NUL => docs/performance-audit-2026-10-04.md | 579 ++++++++++++++++++++++++++++
 1 file changed, 579 insertions(+)
```

Generated build output is ignored and temporary diagnostic sources were
removed.

## 22. `git status`

Expected final short status:

```text
?? docs/performance-audit-2026-10-04.md
```

No source file, schema, migration, lockfile, or protected PDF is modified.

## 23. Exact limitations

Directly measured:

- local direct-backend and Vite-proxy health latency and headers;
- configured remote PostgreSQL query/service wall times, query-event counts,
  payload bytes, safe plans, and low-concurrency behavior;
- public Supabase Auth health network timing;
- source-derived request ownership, middleware order, query structure, pool
  configuration, refresh behavior, and transaction statement count.

Inferred from direct measurements plus the supplied HAR:

- authenticated `getUser` residual inside `/auth/me`;
- the division of individual HAR totals among Auth provider work, pool waiting,
  and database work;
- Chrome's exact blocked-time allocation;
- Product setup/PATCH stage durations, because mutations were not repeated.

Not measured:

- a fresh authenticated browser trace with server stage headers, because no
  browser surface or safe user token was available to the audit process;
- Railway production region, protocol, connection reuse, RTT, or latency;
- production Supabase Auth `getUser` timing in isolation;
- mutation timing against the shared configured database;
- large-cardinality query plans or production load.

The report distinguishes those limitations and does not describe inferred
numbers as direct stage traces.

## 24. Confirmation

- Diagnostic audit only.
- No performance optimization implemented.
- No business, stock, receipt, financial, auth, authorization, role, or tenant
  behavior changed.
- No Prisma schema or migration changed or executed.
- No remote/shared business-data mutation or load test.
- No commit, push, or deployment.
- `planing/SaaS2_Clothes_Implementation_Summary.pdf` was not opened or changed.
