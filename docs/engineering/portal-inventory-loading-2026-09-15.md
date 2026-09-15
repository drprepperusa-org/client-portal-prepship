# Inventory loading — 2026-09-15

## Placement and evidence

Outcome: one correctly filtered page request per Inventory search/filter change,
starting on page one; preserve current rows while loading within the same client
and clear them when the client changes. History must send the selected client.

A read-only production log sample contained 15 stock-list responses: median 159 ms,
range 133–209 ms. One history response was 133 ms. This small sample does not show
a large backend bottleneck and is not a controlled production benchmark.
The stock owner already starts rows/count together and batches shipped enrichment.
Existing query hooks already debounce input, cancel obsolete reads, share matching
query keys and retain display rows only within the same user/client scope.

Seven browser reproductions failed against base `36f1db2`: stock search, Low/Out,
history SKU and history type each initiated page 2 then page 1; stock client,
history client and history dates instead stayed on page 2. Fetch instrumentation
counts even requests cancelled before reaching the server. The History hook also
included clientId in its query key without forwarding it to the API.

The real-route database fixture additionally reproduced a backend filter defect:
`inventoryScopePredicate` returned before applying explicit filters for global
admins. Selecting Beta returned all three Alpha/Beta fixtures instead of one.
Apply explicit client/store narrowing before the global bypass in this existing
owner. Restricted users keep the same access intersection. Existing Inventory,
SKU Analysis and receiving callers delegate to this owner; inbound passes no
explicit filter and is unchanged.

Earliest defect: `Inventory.tsx` resets pagination in an effect after the query
has already committed, or omits the reset for client/date changes. Fix request
intent here; do not add caching or alter the backend stock formula to mask it.
The shared pagination helper serves only these two Inventory tables. The History
hook and API adapter must forward the explicit client narrowing intent.

## Business authority and scope

- Stock: `inventoryQuantitySql` in `src/services/inventory-stock-math.ts`, signed
  sum of committed `inventory_ledger.qty`; DTO `inventoryQuantity` and backend
  `stockStatus` remain unchanged. No balance cache or frontend stock computation.
- Warehouse shipped 30d: existing portal Inventory read model, absolute sum of
  `ship%` movements by `coalesce(effective_at, created_at)` within the last 30 days.
- History: existing inventory route, ledger rows and their effective/created clock.
  Its `inventoryLedgerScopePredicate` retains backend JWT client/store enforcement;
  selected client can only narrow access. All existing DTO/redaction rules remain.
- Frontend changes only pagination and query parameters. The existing backend
  predicate applies explicit filters to global users too. No new business owner,
  schema, dependency, polling cadence or provider call is needed.

## Verification and release plan

Browser proofs cover all seven request transitions, retained rows/updating state,
client clearing, exact query parameters, sorting, pagination and stale responses.
Run typecheck, build, architecture, shadow-renderer, contract, inventory/SOT,
scope/security, session/cache and table retention checks. Verify History narrowing
against the existing backend on disposable PostgreSQL. Wire the browser proof
into hosted CI after the mutation guard suite. Deploy directly to main under the
user's existing authorization, verify exact Vercel/Render commits and public
readiness/login boundaries. No production business data writes are part of testing.

Rollback base: `36f1db2799f86d13dc55ceced5ee5c43811179f3`.

## Completed verification

- All seven new browser reproductions now pass; each filter change initiates
  exactly one page-one fetch, including debounced search. All 12 focused Inventory
  browser checks passed, including retained rows, empty results, client clearing,
  sorting, pagination and protection from an obsolete sort response.
- The new real-route PostgreSQL integration passed: global client/store narrowing,
  restricted access intersections, no-scope denial, inactive/orphan exclusion,
  negative/low/positive ledger quantities, search, pagination, effective history
  dates and immediate visibility of a committed test movement.
- Existing main portal and access-security database integration suites passed.
  The disposable local PostgreSQL server was stopped after verification.
- Typecheck and contract-drift passed. Focused inventory status/sold-label/scope,
  access-security, fail-closed scope, client/store scope, query-session scope,
  table retention, SKU-orders scope, Analysis scope/DTO redaction, carrier/weight
  redaction and runtime-DDL guards passed.
- Full-site certification passed: production build/bundle budget, architecture,
  shadow-renderer, bundle redaction, API contracts, auth smoke, 41 portal UI tests
  and failure-state checks. `git diff --check` passed; dependencies/lockfiles unchanged.
- Both the new database test and focused browser tests are included in hosted CI.
  No production business records were changed. The measured improvement is fewer
  initiated requests and correct filtering, not a claimed production latency percent.
