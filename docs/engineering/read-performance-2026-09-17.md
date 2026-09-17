# Read-performance pass: portal measurement and CSV counts

## Completed

`perf:web` now builds and previews the active `portal-client/`, not legacy `web/`. The observer selects first-contentful-paint explicitly. Preview uses a strict port and fails if its process exits; rendering must populate the root before measurement. Reports label their unauthenticated scope.

Local five-run entry-page baseline (not production or authenticated dashboard/API latency): median FCP 80 ms, median LCP 736 ms; p95 FCP 888 ms and LCP 1,492 ms. Average resource transfer 389,643 bytes. Raw samples are generated in ignored `reports/web-performance-current.json`. The normal bundle guard remains unchanged and passes; chart chunk remains 720,519 raw / 209,151 gzip bytes. No chart deferral is claimed or implemented without an authenticated measurement.

## Export ownership

The Inventory, Orders, Shipments and Inbound Receipts read models remain the canonical owners of predicates, sorting, DTO values and redaction. Export services reuse the first page's database count through an optional internal `snapshotTotal` argument. This argument is only valid with the same transaction, scope and filters; supplying it with the default live database reader throws. It is not a request parameter, frontend calculation or shared cache.

Each exporter keeps its count inside one read-only repeatable-read transaction. New exports and ordinary list requests count independently. Orders still probes schema readiness before reserving the transaction connection. Row/byte/time caps and incomplete-file checks are unchanged. Source errors still fail the whole export.

OFFSET pagination is deliberately retained for the bounded 10,000-row exports and existing arbitrary/computed table sorts. A generic ID cursor would change ordering or skip rows. A future keyset change needs per-sort cursor definitions and parity tests; this pass only removes redundant counts.

## Verification

`npm run test:client-portal-export-count-performance` uses the actual Drizzle read models, SQL, DTOs, CSV formatters and export loops on isolated in-memory PostgreSQL. For each surface, 1,001 visible rows require three pages: counts drop **3 to 1**, while CSV bytes match the non-reused-count baseline exactly. Tests also cover empty exports, different client scopes, store-only scopes, fresh live-list counts and rejection of a snapshot count on the live reader. The script sets an unusable local network database URL and substitutes database operations before execution. No production credentials or database are needed. The existing guard runner discovers the new test automatically.

Passed: API/portal typechecks, production portal build, active API/architecture guards, shadow-renderer/SOT drift/analytics parity guards, inbound/inventory/order/shipment ownership guards, bundle budget and the local entry-page measurement.

All 13 browser cases across the Inventory, Orders, Shipments and Inbound export suites also passed: download byte identity, filter forwarding, progress, errors/retry, empty results and cancellation on client/date changes. All portal API requests in those browser tests were intercepted fixtures.

## Next steps and safety

Review the local branch alongside the PrepShip Inventory History change. Billing event pagination and Shipping Margin summary/detail separation belong in their PrepShip canonical owners; those edits remain pending the explicit shipped-data override required by that checkout's AGENTS.md. Authenticated dashboard and production-query measurements are still outstanding.

Implementation validation involved no schema migration, production data mutation or provider operation. Existing external-PostgreSQL integration suites were not run against a real database during that pass. On 2026-09-17 the user authorized publishing this verified batch; deployment state is verified separately from these local results.
