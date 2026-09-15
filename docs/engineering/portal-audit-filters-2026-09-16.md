# Audit investigation filters

## Placement and outcome

The audit route already pages saved history; date and activity predicates belong
before its LIMIT/OFFSET so every matching historical event remains reachable.
Add filters to the existing admin-only route, keeping actor/store attribution,
metadata redaction, deterministic created_at/id ordering and all-user discovery.

Persisted client_portal_audit_logs.event and created_at own classification and
time. Extract the existing DTO category/outcome rules into one backend owner with
shared vocabularies for its JS classifier and SQL filter twin. Views means data
requests, not proof of human clicks; actions includes requests without claiming
completion. Failed and denied outcomes have separate filters. Unknown events stay
visible under All/activity Action, as before. Hide background excludes the two
existing session/count check categories and never changes stored audit records.

Dates are browser-local calendar days, converted to inclusive-start/exclusive-end
ISO instants. The end is next local midnight, not a fixed 24 hours, to support DST.
The applied range and timezone are visible. Empty bounds mean open/all history.
Invalid ranges are rejected by the backend. Replace the irrelevant global date
control on Audit Log with its own explicit Apply/Clear dates controls.

Frontend only sends intent, using useFilteredPage and debounced search. Query
keys and retained-row boundaries include every filter, so old filtered results
cannot be presented as new results. The endpoint remains admin-only.

## Verification and release

Extend the existing PostgreSQL-in-WASM route test with JS/SQL classification parity,
inclusive/exclusive and open date bounds, malformed filters, historical paging
beyond background events, and persistence preservation. Browser coverage tests
desktop/mobile controls, page resets, cleared dates, user/store combination,
empty/error recovery, plus a DST date range.

Base/rollback: 4612d53e2a078049610d74223d6e6956bf0bc855. No dependencies, schema,
migrations, worker or production data changes. Push main and deploy under standing
authorization; verify exact frontend/API SHA, readiness and public auth gates.

## Completed verification

- Existing audit static/runtime suite passes, including the actual route running
  against PGlite PostgreSQL. New cases prove SQL/DTO classification parity, exact
  and open time boundaries, invalid ranges/filters, all-user discovery, saved-event
  preservation, and intersection of actor/store/search/date/activity filters.
- Filtered paging finds all five failures behind 120 background events with no
  duplicates and accurate hasMore. Admin denial and metadata redaction still pass.
- Four browser cases pass: Manila desktop/mobile controls, Los Angeles's 23-hour
  DST day, and retry after a simulated service failure without losing filters or
  exposing raw diagnostics. Date submission starts one page-one request.
- Backend/frontend typechecks, contract drift, Inbound date-control regression,
  query/session scope, client/store scope, admin access, fail-closed scope and
  carrier/weight redaction checks pass. Manifest/lockfile consistency passes.
- Full-site certification passes: production build/budgets, architecture and
  source-of-truth, bundle redaction, action/API contracts, label/print guards,
  7 auth smoke tests, 41 portal UI tests and failure-state runtime fixtures.
