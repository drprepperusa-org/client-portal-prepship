# Mobile client and date controls

## Placement contract

Outcome: expose the existing global client/date controls on narrow screens without
header overflow. Client selection and date editing use scrollable, portalled dialogs
with keyboard focus trapping/restoration, Escape, and touch-sized controls. Date
presets and custom ranges continue to apply only on Apply; Cancel discards drafts.
Existing exclusions for Inbound, Audit log and Search remain. Desktop keeps the same
filter intent and gains the same dialog behavior.

Canonical owners: /api/client-portal/clients supplies the authorized client DTO list;
PortalFiltersProvider owns the selected client and date request intent. Existing
backend selectors remain the only tenant/store authorization and business-data
owners. Date preset logic is reused in DateRangeFilter; no parallel mobile policy.
No business values, statuses, money or totals are computed here.

Imperfect inputs: slow/failed client list, long client names, large client lists,
small/short viewports, uncommitted date edits and switching clients while reads are
pending. Client failure exposes Retry and cannot turn cached data into an enabled
picker. Existing scoped query keys and request cancellation remain unchanged.

Verification: mobile 320/390px and desktop browser flows, client query intent,
date Apply/Cancel, route exclusions, focus/scroll restoration, long-list scrolling,
failure/retry, existing search/saved-view and date/scope/contract guards. No database,
provider, dependency, API or environment change. Existing user authorization permits
main push and live release, with no PR. Rollback is a commit revert.

## Pre-release evidence

- Typecheck (API + portal), production build, bundle budget and bundle redaction pass.
- 11 new browser cases pass: six widths (320, 390, 640, 768, 1024, 1440),
  date Apply/Cancel/custom intent at phone and desktop widths, long-list scrolling
  and focus trapping/restoration, client-list retry and route/date exclusions.
- 10 portal-wide search and 8 saved-view browser regression cases pass.
- Date-range, mobile-nav, Inbound receipts, Orders search, failure states,
  contract drift, access/security, shadow-renderer, architecture, fail-closed scope
  and session query-key guards pass. Source-line-length reports only the known
  AuditInvestigationFilters.tsx:63 baseline failure.
- Desktop/mobile screenshots inspected after dialog transitions completed.
- Main ec2677a CI 35696421251 confirms the same three existing failures:
  source line length, CP-054 stale Topbar assertion, full-site certification
  repeating source line length. No new failed guard is accepted as baseline.
- CI includes the mobile-controls browser suite before the broad static suite.
