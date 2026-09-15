# Portal Billing loading performance — 2026-09-15

## Measurement and selection

Read-only Render request logs for the portal API, 2026-09-15 from 00:00 UTC
through the inspection at approximately 06:20 UTC, returned these successful GETs.
Times are server response times, not complete browser load times. The sample is
observational, small for Billing, and predates this change; it is not a benchmark
under controlled load. No customer payloads, tokens or IP addresses are retained here.

| Endpoint | Samples | Median | Maximum |
| --- | ---: | ---: | ---: |
| Orders list | 15 | 651 ms | 1,038 ms |
| Inventory list | 13 | 162 ms | 211 ms |
| Invoice summary | 3 | 2,939 ms | 2,972 ms |
| Audit log | 153 | 115 ms | 451 ms |

The Billing sample used June 18–September 15 with half-month grouping. Source
inspection showed an awaited loop over distinct periods. Each upstream totals
read waited for the preceding period to complete. The initial page already uses
lazy chunks, user-scoped query caching, and deferred speculative reads; this change
targets the observed slowest endpoint rather than adding another cache.

## Placement and success criteria

- User outcome: shorten Billing's multi-period summary wait.
- Canonical financial owner: PrepShip `/billing/invoice-totals`, parsed by
  `fetchCanonicalInvoiceTotals`; its `CanonicalBillingTotals` fields remain the
  only source of the summary's money and order counts.
- Identity owner: existing scoped invoice read models. `keyBillingSummaryRows`
  intersects each calendar period with the requested billing days and groups
  clients; `assignCanonicalTotals` rejects missing totals. Billing effective-day
  semantics, SQL, DTOs, footer formula and redaction are unchanged.
- Delay entry point / caller changed: `/invoice-summary` request orchestration in
  `src/routes/client-portal/invoices.ts` serialized independent period reads.
- Fix: execute at most two periods concurrently per summary request. Keep keys
  attached to results, await the pair, and stop before later pairs on a failure.
  There is still one upstream call per distinct period. This is a per-request
  concurrency bound, not a global rate limit.
- Authority: forward the same caller bearer and request ID. PrepShip still
  re-authorizes every read. Missing financial access returns the same redacted
  payload. No business computation moves to React.
- Freshness: no new cache, polling interval change or stale fallback. A failed or
  incomplete canonical response never produces partial or locally derived money.
- Acceptance: identical rows, order, totals, scope and errors; overlapping reads
  with peak concurrency two; no later pair after a failed pair.

## Controlled route proof

`test:client-portal-billing-summary-performance` executes the real Hono route,
real day normalization, period keying and assignment with substituted I/O.
Fourteen rows across seven periods use alternating 80/120 ms upstream delays,
including out-of-order responses. It checks both range clamps, exact client/period
totals, auth forwarding, selected-client reads, fresh later requests, empty results,
financial denial, missing bearer, missing canonical totals and upstream denial.

Before: 797 ms, seven calls, peak one. After the initial patch: 520 ms, seven
calls, peak two. This approximately 35% reduction is a local latency simulation;
it does not establish a production percentage or database capacity improvement.
The test asserts deterministic scheduling and correctness, not a flaky elapsed-time
threshold. Existing billing guards continue to validate the real upstream parser.

## Release scope

Backend orchestration only; no schema, dependencies, settings, client UI or
production business-record changes. Rollback is the preceding portal release
`e9f4d7b863a2b43153bd6b0d94ac29bfd068db2d`. Keep the reproducible `npm ci` install
configuration. Verify typecheck, build, full guard suite, disposable Billing
integration and focused Billing browser flows before release. Inspect both
deployment commits and public readiness after release. Production speed improvement
remains unquantified until comparable authenticated requests are observed.

## Verification results

- `npm run typecheck` and `npm run build:web`: passed.
- `npm run test:guards`: all 186 entries passed, including architecture,
  shadow-renderer, contract drift, scope/redaction, canonical Billing guards,
  the new scheduling proof and full-site certification.
- Disposable PostgreSQL: `test:client-portal-integration`,
  `test:client-portal-billing-cp059:integration` (28 checks), and
  `test:client-portal-access-security:integration` passed. The local server was
  stopped afterward.
- Focused Playwright Billing, CP-070 finalization and CP-068 export files:
  32 tests passed when run after the mutation suite. An earlier overlapping run
  saw the mutation suite's intentional source edits and server restarts; that
  run is not acceptance evidence. Source restoration was verified before rerunning.
- `git diff --check`: passed. No production data or provider operations were used
  for verification.
