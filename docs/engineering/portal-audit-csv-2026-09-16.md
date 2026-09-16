# Filtered Audit Log CSV

## Placement contract

The audit route/database selector owns matching events, ordering, store attribution,
admin access and redaction. CSV uses `format=csv` on that same authorized route,
same predicate and same sanitized activity DTO, with page/limit ignored. One SELECT
reads the matching set in database snapshot order (created_at DESC, id DESC), so
new events cannot shift page boundaries during the export. Facet lookups are skipped.
The backend serializer exports recorded activity fields; no raw metadata payloads.
Event timestamps use explicit UTC ISO strings. Session scope and outcome notes
retain their meaning. Quoted UTF-8/BOM CSV escapes spreadsheet formulas, commas,
quotes and newlines. Empty results produce the column header only.

Exports are all-or-nothing: 50,000 events or 16 MiB maximum, with a safe 413 that
asks for narrower filters. The query reads at most 50,001 records to detect overflow;
no partial file is returned. Existing database/request timeouts remain in force.
The browser downloads backend bytes using the existing authenticated file transport.
Filter changes/unmount/sign-out abort pending downloads. Repeated clicks are blocked;
failure offers retry and never exposes raw diagnostics. The limit is visible beside
the button. Date drafts are excluded until Apply dates; pending search disables export.

## Verification/release

PGlite actual-route fixtures compare exported IDs/details with JSON results across
pages and combined filters; test admin denial, empty/header-only, invalid filters,
redaction, escaping and overflow. Browser tests assert downloaded bytes, filter
forwarding, ignored page state, error/retry and pending-export cancellation.
Required gates include audit/contract/scope/redaction, full-site certification and
the auth-logout guard. That guard needed its expected redirect updated after the
prior saved-view release; hosted CI reported only that stale exact-string assertion.

Base/rollback: 90f02a2e52bf3ee735b1806516c65dedbe6dca9b. No dependencies, schema,
migrations, provider calls or production business data changes. Direct main push
and production verification are authorized by the user.

## Verified evidence

- Audit static/PGlite suite passes: 320 matches exported across JSON pages despite
  page=999/limit=1, equal sorted IDs, combined actor/store/date/activity/search
  filters, admin denial before SELECT, redaction, UTF-8/quotes/newlines, formula
  protection, empty header, 50,001-row rejection and byte-budget rejection.
- Fifteen focused Audit browser tests pass, including byte-for-byte downloads at
  390/1440px, all filters without page/limit, safe failure/413/retry, duplicate-click
  prevention, cancellation on filter change and the previous saved-view regressions.
- Auth-logout, contract drift, query/session scope, client/store scope, access
  security, fail-closed scope and carrier/weight redaction pass. Both package
  manifests match their lockfiles; dependency files are unchanged.
- Full-site certification passes: API/portal typechecks, production build/budget,
  maintainability/source guards, architecture/shadow-renderer, bundle redaction,
  action/API contracts, safe label/print checks, eight auth smoke tests, 41 portal
  UI tests and injected failure-state fixtures.
