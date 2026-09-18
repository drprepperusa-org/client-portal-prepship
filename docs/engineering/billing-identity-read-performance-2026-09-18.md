# Billing identity-read optimization — 2026-09-18

## Scope

Client Portal change, initially implemented and verified locally. The owner
subsequently approved committing, pushing, and deploying this scoped optimization.
No migration, production DB write, provider operation, polling change, or
PrepShip code change is included.

`portalInvoiceSummary` and `portalInvoicePeriodSummary` have one application caller:
the `/invoice-summary` route. That route already assigns every displayed count
and amount from PrepShip's canonical invoice totals. Their previous distinct-order
count and seven category aggregates were discarded. The helpers now return only
client identity and, for grouped reads, period identity.

## Preserved contracts

- Existing active-client, client/store union, requested-client, customer-safe return
  postage, and effective-day predicates are unchanged.
- Date boundaries remain inclusive start / exclusive end; calendar labels remain UTC.
- Queries remain uncapped and grouped over the whole filtered set.
- `sum(b.total_cost)` remains in ORDER BY. It is not exposed as a DTO amount.
  Existing equal-sort-value ties remain unspecified; no new tie-breaker is added.
- The route, canonical assignment, footer totals, upstream period clamps, bounded
  concurrency of two, authorization forwarding, and fail-closed behavior are unchanged.
- No optional local amount is returned or substituted when PrepShip is unavailable.
- Tests of the retired internal aggregate fields now check identity-only shape;
  route tests continue to check actual canonical money and counts.

## Measurement and proof

`test:client-portal-billing-identity-performance` runs the real Drizzle-generated
queries and the real Hono summary route against in-memory PostgreSQL (PGlite).
Network DB configuration is explicitly replaced by an unusable localhost address;
DB execution and upstream totals are substituted. No real credentials are needed.

The SQL comparison reinstates the pre-change SELECT aggregates from `e549f2d`
while keeping the exact compiled predicates, bindings, groups, and ORDER BY.
Independent assertions verify allowed client membership, deny-all/store-only
scopes, zero-amount clients, inactive clients, empty results, validated versus
unvalidated return-only clients, explicit UTC boundary cases, and persisted
effective dates overriding shipment dates. Both UTC and America/Los_Angeles
database sessions are covered.

- 30,009 billing lines; 120 baseline/candidate identity and ordering comparisons.
- Plain, half-month, and month route responses/footers compare exactly using
  canonical upstream fixture answers. Same client sets, period clamps, and
  upstream call sequence. Missing authorization, missing totals, upstream denial,
  financial denial, and database failure are covered.
- Ten measured warm SQL executions per version, alternating execution order after
  two warm-up pairs: baseline median **101.32 ms**, identity-only median **43.60 ms**.
  Final repeat after the harness typecheck fix: **96.61 ms → 40.79 ms**.
  Timings are diagnostic, not a flaky pass/fail threshold or production benchmark.
- Deterministic saving: remove DISTINCT order-count work and seven conditional
  category aggregates. Retain the existing total-cost aggregate for ordering.

This targets a small part of the 1.2–1.8-second observed production Billing request.
The six upstream canonical requests observed in the audit are NOT removed; no
whole-page speedup is claimed. A later release needs comparable production samples.

## Verification

- API and portal typecheck and production frontend build pass. The new standalone
  test script also passes strict TypeScript checking explicitly (root scripts are
  outside the application's tsconfig).
- New SQL/route comparison and existing canonical assignment, scheduling,
  high-volume, and return-customer-rate checks pass.
- Full guard run: 186/188 passed initially. The old returns-display guard still
  required the now-discarded summary aggregates, causing its direct check and the
  dependent CP-059 mutation baseline to fail. Updated it to check retained detail
  aggregates plus canonical summary assignment; all 16 display checks pass on rerun.
  CP-059 mutation rerun passes **39/39**, with original files restored. All 188
  registered checks therefore have passing results across the full run and reruns;
  the complete runner was not repeated after that correction.
- Focused Playwright run: **32/32** pass across CP-059 Billing, CP-068 exports, and
  CP-070 finalization. These are local browser fixtures, not production API tests.
- Updated the Billing source-of-truth matrix to document identity-only readers
  and canonical financial ownership; its shadow-renderer guard passes again.
- Pre-release `git diff --check` passes. These results were recorded before
  committing and deploying; they do not assert a production speedup.

The external-PostgreSQL integration scripts were updated for the internal
identity-only shape; their full native database suites have not been rerun locally
in this pass. PGlite executes the changed SQL and route behavior rather than
relying solely on source guards or a mocked identity reader.
