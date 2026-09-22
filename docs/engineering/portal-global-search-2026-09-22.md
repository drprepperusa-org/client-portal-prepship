# Portal-wide search

## Placement contract

Outcome: the top search field opens a grouped search page for Orders, Shipments,
Inventory, Returns and Replacements, with a mobile entry point. Search submits a
2–120-character term, fetches the first five matches in each category in parallel,
shows each backend total, and links to the full matching list. Each group owns its
loading, unavailable, empty and retry state. No combined total or relevance rank.

Canonical owners remain the existing authenticated, client-scoped list APIs and
their read models/DTOs. Search supplies page=1, pageSize=5, search and the current
client filter, with no status or date restriction. React projects safe identifier,
client and status display fields; it never scans a cached first page, computes
business facts, or bypasses backend scope. A list link carries the search term;
Orders also receives tab=all. Destination pages adopt URL query intent.

Imperfect inputs are blank/overlong terms, a failed category, and a changed user or
client while requests are pending. Empty/invalid searches issue no search calls;
query keys include session, client, category and term. Aborted/old requests cannot
replace a new scope's result. Failure never appears as a zero-result response.
No mutation or tracking-refresh endpoint is invoked by the search page.

Verification: browser coverage for all five query contracts, complete backend
totals, destination links, reload/back, mobile, invalid terms, independent errors
and client-switch races. Existing owner scope/redaction/contract tests are retained.
No backend, database, provider or environment change is required. Existing explicit
main-push/live-release authorization applies; rollback is a commit revert.

## Verification completed before release

- API and portal typechecks, production build and bundle budget: pass.
- 10 new grouped-search browser cases: pass (all five list links, encoded query,
  reload/back/forward, pending draft cancellation, mobile, empty/invalid terms,
  backend totals, partial failure/retry and delayed client-switch response).
- 8 saved-view and 9 Inventory/Returns/Shipments CSV browser cases: pass.
- Existing Orders search, Inbound receipts, mobile navigation, contract drift,
  access/security, shadow renderer, architecture, fail-closed scope, session query
  scope, bundle redaction and failure-state static/runtime checks: pass.
- Desktop and 390px mobile screenshots reviewed; no horizontal overflow.
- Source-line-length check still reports only the existing 247-character line in
  AuditInvestigationFilters.tsx:63. Baseline main 20b2a4e CI 35694148916 confirms
  the same three existing broad guard failures (source-line-length, CP-054 stale
  Topbar assertion, and full-site certification repeating line length).
- No new migration, environment variable, dependency or API contract.
- Search browser proof added to CI before the broad static gate.
