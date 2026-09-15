# Replacement search, status and pagination

## Placement

User outcome: find replacements by reference or order number, filter by lifecycle
status, and navigate beyond the previous 200-record cutoff. Fix the cutoff in
`listPortalReplacements`, the existing SELECT-only canonical owner, and share one
scoped predicate between page and count. The API adds pagination metadata while
keeping the existing data row DTO. React sends filter/page intent only.

The existing raw order scope helper omits explicit filters for unrestricted users.
The replacement owner must apply requested client/store filters for global users
too, intersecting them with the canonical order authorization scope. Both list
and detail delegate to this owner-level predicate.

## Source contract

- Reference, lifecycle status and requestedAt: replacements.reference/status/
  requested_at; no alternate reference, status rule or date calculation.
- Order number and client: canonical joined orders and clients, scoped by the
  existing rawOrderScopeForAlias. Filter arguments never grant tenant access.
- itemCount: count of canonical replacement_items rows, not unit quantity.
- reasonCode: existing toReasonCode redaction; labels still come from PrepShip's
  validated reason contract. Raw reasons/internal money/provider fields stay out.
- pagination.total: backend count with the exact list scope/search/status;
  newest requested_at then id gives deterministic order. Page/count run together,
  with the existing separate-read snapshot semantics. No schema or index changes.
- Missing replacement schema keeps the existing empty read behavior, now with
  zero pagination metadata. API errors remain recoverable errors.

## UI and verification plan

Reuse useFilteredPage, debounced search, Pagination and QueryState. Keep displayed
rows while paging/filtering within a client, clear across client/session changes,
and show Updating. Empty filtered results explain how to adjust the filters.
Verify PostgreSQL results beyond 200, stable tied-date ordering, search, status,
client/store scope, matching counts, redaction and invalid-page defaults. Exercise
mobile/desktop search/status/page/client transitions and detail navigation in the
browser. Run existing replacement workflow, architecture/contract/redaction and
full-site gates. Tests use disposable data and mocked network; no live replacement
creation, labels, inventory or billing commands.

Release base/rollback: 49db5d32e6b1273dcb38409b2a02f37976840014. Push main and deploy
under standing user authorization, verify frontend/API commit parity and public
auth/readiness. No dependency, migration, configuration or worker changes.

## Verification results

- New actual-route PostgreSQL integration passes: all 210 Alpha records reachable
  with tied dates and no duplicate pages, case-insensitive reference/order search,
  combined status/search totals, item line count, redaction, restricted and global
  client/store filters, scoped details, missing scope, invalid pagination and audit.
- Existing CP-061 integration passes, including order badge lifecycle and absent
  schema behavior. Updated its list assertions for the pagination envelope.
- Five browser tests pass: mobile/desktop search/status/page-size/older-page/detail/
  empty-state flow; single-request search/status/client changes and loading scope.
- Both typechecks, contract drift, CP-061 guard, ten-surface retention, session
  query scope, client/store scope, access security, fail-closed scope and carrier/
  weight redaction guards pass. Both dependency manifest/lockfile checks pass.
- Backend list/query totals are tested on disposable PostgreSQL, not production.
  No performance percentage or production business-data mutation is claimed.
- Full-site certification passes: production build/budgets, architecture and
  source-of-truth, bundle redaction, action/API contracts, label/print validation,
  7 auth smoke tests, 41 portal UI tests and failure-state runtime fixtures.
