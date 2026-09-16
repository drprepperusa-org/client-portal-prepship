# Inventory CSV export

## Outcome and canonical owners

Stock Levels offers Export CSV for every matching SKU across all pages. It follows
the selected client, SKU/name search, Low/Out only filter and table sort. Each row
contains SKU/name/client, current quantity, stock status, reorder level, warehouse
shipped over 30 days, units per pack, dimensions, cubic feet and package name.
The date selector does not alter current stock or this report.

The existing `listPortalInventory` and `toPortalInventoryDto` remain the owners.
The reader accepts an optional transaction reader for selects AND ledger enrichment.
`inventory-export.ts` collects 500-row pages inside one read-only repeatable-read
transaction so concurrent ledger movements cannot change membership, counts or
quantities halfway through a report. `inventory-csv.ts` only projects approved DTO
fields, quotes CSV cells and neutralizes formula-like text. Negative quantities
remain numbers. No business calculations or client scoping move into the browser.

## Boundaries

- Existing authenticated Inventory route accepts format=csv, validates scope and
  low-stock inputs, and records export filters and generated row count in audit.
- Scope is an intersection with session access. Inactive/orphan rows remain hidden.
- Maximum 10,000 rows / 16 MiB and bounded loop duration. Existing request and DB
  statement timeouts apply. Oversized results fail explicitly with 413; source
  errors return a generic 503. Complete file or error, never silent truncation.
- Private/no-store response; browser preserves server bytes and filename.
- Export shows progress, supports retry, and is disabled while loading/debouncing
  or empty. Changing client, filters, session or page navigation unmount cancels
  the download. Table page changes do not change export scope.
- No migrations, new dependencies, provider actions or business-data writes.

## Verification

Disposable PostgreSQL proves 505-SKU export, list sort parity, client/store/global
scope and cross-client denial, active/orphan exclusions, ledger stock and status,
search/low-stock filtering, concurrent committed ledger changes between pages,
CSV quoting and formula neutralization, negative quantities, row/byte limits,
empty exports and sanitized failures. Existing Inventory filtering/history suite
checks unchanged list behavior.

Browser fixtures prove server byte identity, filename, complete-filter forwarding
from page 2 without pagination, loading/error/retry/empty states, cancelled downloads
on client switch and mobile containment. CI runs both new suites. The existing
no-local-builder guard and mutation harness cover the new API/download boundaries.
Exact release results are recorded in the external release receipt.

Rollback: revert this feature commit. No schema or customer data changes to reverse.
Production checks use public health and signed-out smoke only; authenticated export
content is verified with fixtures instead of downloading customer records.
