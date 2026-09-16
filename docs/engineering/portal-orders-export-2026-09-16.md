# Orders CSV export

## Outcome and placement

Orders now offers Export CSV for the current client, status, search, sort and
optional order-date window. It exports every matching page as one file. An
explicit Use selected date range control applies the header range to both the
list and export; all dates remains the default so older pending orders stay
visible. A dated list cannot overwrite the all-time awaiting badge count.

Canonical owner: `src/lib/client-portal/read-models/orders.ts`, with the existing
scope/active-client/search/lifecycle predicates, canonical `order_items` and
`toPortalOrderDto`. The earliest potential defect was exporting the browser's
current page, or collecting pages against a changing dataset. Instead,
`read-models/order-export.ts` calls that reader inside one read-only
repeatable-read transaction. The reader accepts a transaction selector; its
count bypasses shared in-flight counts for transaction reads. Schema readiness
is resolved before reserving the transaction connection and reused throughout.

`order-csv.ts` serializes an explicit allowlist of DTO fields. Order date is UTC
from `orders.order_date`; item names/SKUs/quantities and ordered units come from
canonical order items; status/tracking and customer shipping retain their existing
backend owners. One CSV row represents one order; multiline item cells retain
matching item order. No pricing, status or scope rules are duplicated. Financial
columns require financial access; weight requires global access. No raw payload,
carrier/service identity, provider credential, internal cost or recipient address
is exported. Formula neutralization and CSV quoting apply to every cell.

## Boundaries and UX

- Existing authenticated `/orders` route accepts `format=csv`; status, scope,
  search and sorting use the same backend inputs as the table.
- Optional UTC timestamps and client/store IDs are validated; malformed or
  inverted date filters fail with 400 rather than broadening the selection.
- Complete file or explicit error: maximum 10,000 orders / 16 MiB, with a bounded
  loop work budget. Existing database statement timeouts still apply. No partial
  file is returned. Source failures return a generic 503.
- Response is private/no-store and named orders.csv; successful generation audits
  the row count and filters, without claiming the browser saved it to disk.
- Browser downloads backend bytes, shows progress and retryable errors, disables
  export while loading/debouncing or empty, and aborts pending downloads on scope,
  filter, session or navigation changes. No browser pagination fan-out.
- No migrations, new dependencies, provider actions or production business writes.

## Verification

- Disposable PostgreSQL integration: 505 rows across the 500-row boundary;
  list/export sort parity; client, store-only and global narrowed scope;
  cross-client filters; optional UTC date bounds and search; financial/weight
  redaction; canonical multi-item quantities; quoting and formula neutralization;
  concurrent committed insertion leaves the export snapshot unchanged; oversized
  row/byte limits and generic failure responses.
- Existing Orders performance integration: in-flight count sharing, freshness,
  distinct scopes, failure eviction, pagination and sort.
- Browser: backend bytes/filename; client/status/search/sort/date parity after
  navigating page 2; changed header dates reset page; progress/failure/retry;
  empty state; scope change cancels stale download; mobile bounds and screenshot.
- Existing Orders browser sorting/retained-row regressions.
- Production build, typecheck, architecture/shadow-renderer/source-line guards,
  and the full repository guard suite. Exact release results live in the release
  receipt. Hosted CI runs the new DB integration and browser specs.

Rollback: revert the feature commit. There is no schema or stored customer data
to reverse. Production smoke is read-only and unauthenticated; authenticated
behavior is demonstrated with fixtures rather than exporting customer data.
