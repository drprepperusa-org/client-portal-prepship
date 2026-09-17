# Shipments CSV export

## Outcome and placement

Shipments offers Export CSV for all matching pages. It follows the effective client
(page override or top-bar selection), search, status, sort and optional selected date
range. All dates remains the default. Enabling Use selected date range applies the
header dates to both table and export and resets paging when those dates change.

The earliest potential defect is exporting only browser rows, omitting active filters,
or collecting pages while shipment membership changes. `shipment-export.ts` calls the
existing `listPortalShipments` owner with a transaction reader for both page and count
queries. All pages use one read-only repeatable-read snapshot. There is no second query
owner or business calculation in React. The existing list still starts independent
page/count reads together when used outside exports.

## Provenance and boundaries

- One CSV row per shipment: ID, order number and client from the existing DTO;
  displayTrackingNumber from frozen label tracking then legacy tracking; shipmentStatus
  from PrepShip fulfillment lifecycle, with voided winning. Carrier telemetry never
  supplies outbound status. Ship date is the existing DTO fallback clock: ship_date,
  then label_ship_date, then create_date (label creation time).
- Inclusive UTC bounds filter that same date expression in the shared reader. Missing
  dates remain in all-dates results, but cannot match a specified date bound. Bounds
  and scope IDs are validated; inverted/malformed dates return 400.
- Existing scope, return/replacement exclusions and voided visibility are unchanged.
  Legacy status aliases remain supported. Invalid export status fails instead of
  silently producing an unfiltered report; legacy list behavior is preserved.
- CSV is an explicit allowlist without carrier/service identity, label URLs, recipient
  addresses, internal costs or financial fields. CSV quoting and formula neutralization
  happen on the backend. Browser/API guards prove original bytes reach the download sink.
- 10,000 shipments / 16 MiB and a bounded loop; existing request/statement timeouts apply.
  Oversized results return 413, source failure 503. No partial file is sent.
- Private/no-store download; audit records successful generation and filters, not disk save.
- Loading, retryable errors, and cancellation when client/filters/session/navigation change.
  Export is disabled during table updates/search debounce and when empty.
- No new dependencies, migrations, provider calls, tracking refreshes, or live business writes.

## Verification

Disposable PostgreSQL tests cover 505 rows across pages, stable sort, scope intersection,
store-only access, canonical tracking/status, return/replacement/voided exclusions,
legacy status aliases, date bounds at both endpoints with label/create-date fallbacks,
missing dates, concurrent void/insert during export, safe text serialization, row/byte
limits and sanitized failure. Existing Shipments loading and CP-069 fulfillment tests
exercise unchanged canonical owners. Date fixtures use explicit UTC for timezone independence.

Browser tests cover original bytes/filename, client override plus search/status/sort/date
parity from page 2, changed header dates resetting paging, progress/error/retry, empty view,
client-switch cancellation and mobile containment. Both suites run in CI. CSV-byte guards
and mutation tests cover the new API and download boundaries. See release receipt for
exact gate and deployment results.

Rollback: revert the feature commit and redeploy frontend/API; no schema or data rollback.
Production verification is public health/readiness and signed-out browser/API smoke.
Authenticated export content is tested with fixtures instead of real customer downloads.
