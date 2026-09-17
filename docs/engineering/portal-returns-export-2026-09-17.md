# Returns CSV export

## Outcome and placement

The Returns page exports all matching returns across pages, with an optional
selected date range. Export CSV reports progress, supports retry and cancels when
the user, credentials or filters change. Empty/loading/failed views cannot start
an export. Existing creation, receiving and label actions remain independent.

The previous route-owned query is extracted into `returns/list.ts`. Both JSON
and CSV call that owner; `returnScopePredicate` authorizes the linked order.
The existing DTO owns reference resolution, status, quantities and redaction.
Validated ISO date bounds filter `returns.created_at` inclusively in UTC. Dates
default to unrestricted so older returns remain visible when opening the page.

`returns/export.ts` owns paging in one read-only repeatable-read snapshot. It
reads item names, SKUs and quantities once per page for scoped return IDs only.
The CSV serializer aligns item cells by item ID and projects the DTO total. It
never derives a new status or quantity. Formula-like text is escaped; quoting
preserves commas, quotes and multiline cells. No provider call, signed label
link, financial field or customer address is exported.

The request returns a complete CSV or a 413/503 error. Limits are 10,000 returns,
16 MiB and a 25-second generation budget within existing request/SQL timeouts.
No migrations, environment changes or worker jobs are required. Rollback is a
normal code revert; no data repair is needed.

## Verification

- Real-Postgres integration: 505 returns across pages; fractional quantities;
  lifecycle versus arrival; shared list/export filters; client/store/order
  isolation including a stale return client assignment; inclusive UTC bounds;
  concurrent status/item changes and inserts; CSV escaping; limits and failures.
- Existing Returns loading regression: exactly two overlapping list reads,
  reference search, scope, pagination, arrival and money behavior unchanged.
- Browser: original backend bytes, selected filters, all-page intent, progress,
  errors, retry, client-switch cancellation and mobile layout, using mock APIs.
- CSV byte guard plus two mutations reject rebuilt or replaced backend files.
- CP-062 and table-sort guards follow the extracted list owner.
- Dedicated browser and integration steps run in GitHub CI.
