# Returns loading and search — 2026-09-15

## Placement and evidence

Outcome: one page-one request for Returns filter changes; correct search by the
reference shown to users; independent list queries can run together. Production
log sampling returned no matching Returns reads, so no production latency baseline
or speed percentage is claimed.

Five browser tests reproduce page 2 then page 1 fetches for search, status, local
client, top-bar client and order-link changes. The injection point is the reset
effect in `Returns.tsx`; use the existing `useFilteredPage` request-intent helper.
Existing hook/transport owners keep user/client/order retention boundaries,
debouncing, cancellation and query-key behavior.

The existing backend Returns read owner (`returns/reads.ts`) sequences independent
row/count reads. A warmed actual-route PostgreSQL fixture with 40 ms added to each
list SQL read measured 102 ms, two queries, peak one active query. Overlap only
these two existing statements; audit recording and DTO construction retain their
existing order. No cache or new business owner. Page/count remain separate reads,
without a new transaction snapshot guarantee.

The PostgreSQL test also shows a displayed `LEGACY-100-RETURN` reference cannot be
searched when the persisted reference is absent. `returnSearchPredicate` checked
the raw reference column while the DTO used `resolveReturnReference`. Delegate
search to the same owner's existing SQL twin, `returnReferenceSql`, already used
for sorting. It covers persisted references and legacy order-number/order-id
fallbacks without rewriting any return or inventing new identifiers.

## Source and workflow boundaries

- `returns.status` owns workflow state. `resolveReturnArrival` combines it with
  linked shipment tracking status/delivery time for the display-only arrival flag.
  No lifecycle transition, eligibility, receiving or refund logic changes.
- `validatedReturnCustomerShippingRateSql` owns returned customer postage, using
  the frozen rate and validated shipment snapshot from label time. Financial
  permission redaction remains in `toClientSafeReturnRow`; no price recalculation.
- `return_items` owns returned SKU/quantity; DTO and tracking/PDF redaction remain.
- `returnScopePredicate` uses the canonical order's client/store and intersects
  explicit filters. Search and counts retain that same backend scope.
- Browser tracking-refresh behavior is unchanged. Verification blocks external
  requests; no real label, tracking refresh, notification or stock/billing write.

## Verification and release

New browser proofs cover all five request transitions, client/order clearing,
retained rows, sorting, stale responses and displayed postage. Real PostgreSQL
proves reference/order/tracking searches, client/store scope, status, arrival,
frozen money/redaction, returned items and pagination. The focused browser run
passed 9 tests, including all five new filter regressions. The new PostgreSQL
suite and existing recovery (CP-043), inspection authority (CP-045), and arrival
(CP-062) integration suites passed. Focused domain, scope, redaction, contract and
runtime-DDL guards and both backend/frontend typechecks passed.
Manifest/lockfile dependency consistency passed for both packages. Full-site
certification passed: production build/bundle budgets, architecture/source-of-truth
and bundle-redaction guards, action/API contracts, label-URL/print validation,
7 signed-out/auth smoke tests, 41 portal UI tests, and failure-state fixtures.

The same warmed fixture with 40 ms added per list SQL read measured 50 ms after
the change, with two reads and peak concurrency two (baseline 102 ms, peak one).
This demonstrates overlapping independent reads under modeled latency; it is not
a production speed measurement. Browser request count dropped from two to one
for each tested filter transition. Both regression proofs are wired into hosted CI.

Deploy main under the user's standing authorization;
verify exact Vercel/Render SHA, readiness, portal-only startup and public auth gates.

Rollback base: `eae7091a0dd4ec1f3687b01dde7040e539960cc1`. No dependency, migration,
schema or worker configuration changes.
