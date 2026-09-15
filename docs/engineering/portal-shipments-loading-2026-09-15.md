# Shipments loading and search — 2026-09-15

## Placement and measurement

User outcome: efficient Shipments loading, correct order/tracking search, one
page-one request for changed filters, and retained rows within the same client.
The read-only production log query returned no matching Shipments requests in
the sampled window, so no production latency baseline is claimed.

Four real-browser tests reproduced two initiated fetches (old page 2 then page 1)
for search, status, local client and top-bar client changes. The root is the
pagination-reset effect in `Shipments.tsx`. Reuse `useFilteredPage` so query intent
is correct before effects start network work. Existing scoped retention, debounce,
query keys and cancellation remain in their established hook/transport owners.

The canonical `listPortalShipments` owner performs independent row and count reads
sequentially. The actual owner over disposable PostgreSQL, with 40 ms added per
DB I/O, took 111 ms, two queries, peak one active query. Twenty native samples
without added delay had median 4 ms / p95 5 ms. A warmed comparison using the old
owner from `7b9060b` and the same fixture measured 100 ms before and 52 ms after
with the added delay; native medians stayed 4 ms (p95 5 ms before / 4 ms after).
The modeled round-trip saving is not a production latency percentage.
Start both existing queries in
one Promise.all, bounded at two reads per list; do not introduce a cache or change
the count query/predicates. Page/count remain separate statements, with the same
existing lack of a shared transaction snapshot.

The same DB test reproduced a search defect: a visible shipment with order number
`ORPHAN-4002` and no linked order returned no match when searching that number.
The canonical `shipmentSearchPredicate` checked only the joined order's number.
Include the persisted shipment's own order number, already used in the DTO.
Rows and count share this selector; client/store/status/visibility predicates
continue to intersect search. No import, linking or shipment record is changed.

## Business authority

- Status: `portalShipmentStatusSql`, linked or same-client matched order lifecycle,
  with voided precedence. Fulfillment writes are the clock; carrier telemetry
  does not decide the displayed status. Returns/replacement exclusion is unchanged.
- Money: `shipmentCustomerShippingRateSql`, frozen billing lines then validated
  PrepShip snapshot; label/bill time is the clock. DTO `customerShippingRate` and
  pending flag retain financial permission redaction; no carrier-cost fallback.
- Tracking: persisted label tracking then legacy shipment tracking, chosen by
  `toPortalShipmentDto`; backend tracking URL/redaction unchanged. Search covers
  both stored tracking columns and both order-number sources.
- Scope: existing backend `shipmentScopePredicate`; explicit client/store filters
  only narrow access. No frontend business calculation or scope enforcement added.

## Verification and release

Prove four browser regressions, retained rows/updating, client clearing, query
parameters, sorting and stale-response behavior. Actual PostgreSQL test proves
concurrent reads, unlinked order-number search, both tracking sources, cross-client
denial, explicit filters, status, frozen shipping rate/redaction and pagination.
Run existing CP-069 fulfillment and main portal integration suites, focused
domain/scope/redaction/contract guards, typecheck and full-site certification.
Wire tests into hosted CI. Deploy directly to main under existing authorization
and verify exact Vercel/Render SHA, readiness, portal-only startup and anonymous
sign-in/API boundaries. No labels, tracking-provider calls or production business
record mutations are permitted in these checks.

Rollback base: `7b9060b4e7e3205538b8236f4c83918d460f67ea`. No schema, dependency,
worker configuration or migration changes.

## Completed local verification

- All four filter regressions failed before the fix and pass after it. Six focused
  Shipments browser tests pass, including sorting, row retention, client clearing,
  stale sort responses, exact parameters and unchanged displayed shipping charge.
- New real PostgreSQL integration passed: concurrent reads, displayed order-number
  search without a link, canonical/legacy tracking search, client/store isolation,
  voided/shipped filters, pagination, frozen billing rate and financial redaction.
- Existing CP-069 fulfillment and main portal database integrations passed; their
  provider calls are blocked. Disposable PostgreSQL was stopped after testing.
- Typecheck and contract-drift passed. Shipments status/item identity, CP-069
  fulfillment display, CP-041 shipping-rate parity, shipping-pending, access-security,
  fail-closed scope, client/store scope, query-session scope, table retention,
  carrier/weight redaction and runtime-DDL guards passed.
- Full-site certification passed, including production build/bundle budget,
  architecture, shadow-renderer, API contracts, auth smoke, 41 portal UI tests
  and failure-state checks. `git diff --check` passed; lockfiles unchanged.
- New SQL and browser proofs are wired into hosted CI. No production business
  records, label actions or marketplace notifications were part of verification.
