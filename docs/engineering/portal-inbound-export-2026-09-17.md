# Inbound receiving-history CSV export

## Outcome and placement

Inbound's Received inventory section exports all matching receipts across pages.
Local Received from/through controls filter both history and export. Empty bounds
preserve all receipt history; either bound may be used independently. Inverted
ranges show a validation message and disable requests/downloads. Clearing dates
restores all history. Client/date/sort changes reset or scope paging as appropriate.

The existing backend `listPortalInboundReceipts` remains the only list owner.
The earliest risks are exporting only the current browser page, filtering on the
wrong timestamp, or mixing concurrent receipt inserts across pages. The owner
now accepts optional inclusive UTC bounds on its existing `receivedAt` SQL
expression and a transaction reader. `inbound-receipt-export.ts` traverses it
within a read-only repeatable-read snapshot. Independent list/count reads still
start together for normal list requests.

## Provenance and boundaries

- Receipt ID and received quantity: inventory ledger ID and qty, restricted to
  canonical movement type `receive`. No batch reconstruction or new stock math.
- SKU, item name and client label: the existing receipt DTO's inventory/client
  joins, with the existing inventory scope predicate plus narrowing filters.
- Received date: effective_at, then created_at for legacy receipts; inclusive
  UTC bounds apply to this exact expression, never the global reporting range.
- The CSV is an explicit six-column projection; no operator identity, notes,
  internal source identifiers, financials or provider data is exported.
- Backend quoting and formula neutralization preserve text safely. The browser
  passes filters and downloads the returned Blob unchanged.
- 10,000 receipts / 16 MiB; bounded generation and existing request/SQL timeout
  controls. Failure returns 413/503, not a partial file. Downloads are private,
  no-store and successful generation is audited with scope/filter/row metadata.
- Progress, safe failure messages, retry and abort on filter/user/session change.
  Loading, empty, failed or invalid-range views cannot start an export.

## Verification and release

Disposable PostgreSQL tests exercise 507 dated receipts across pages, canonical
quantity/clock parity, inactive SKU history, client/store isolation, receive-only
membership, inclusive and open date bounds, concurrent inserts, CSV escaping,
row/byte limits, empty files and sanitized errors. Browser tests prove original
bytes, filters/sort from page 2, date reset/clear/validation, mobile containment,
progress/retry/permission errors, and client/date cancellation using mock APIs.
The inbound source-of-truth guard preserves full history by default; CSV byte
guards and mutation tests include both new download boundaries. Browser and DB
proofs are wired into GitHub CI.

No dependencies, migrations, environment variables or worker changes. No live
receipt, inventory adjustment or provider action is needed for verification.
Rollback is a code revert and frontend/API redeploy; no data rollback is needed.
