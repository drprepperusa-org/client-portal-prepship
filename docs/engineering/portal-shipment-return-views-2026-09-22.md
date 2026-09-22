# Saved views for Shipments and Returns

## Placement contract

Outcome: save and reopen search, status, sort and page size on Shipments and
Returns. Restore page 1, cancel pending search drafts and fetch current data.
Reuse SavedViewsBar and its account/client/page storage isolation. Page-local
client choices supply the effective storage bucket. Keep the current client and
Returns order URL constraint; never restore scope IDs from storage.

Canonical owners remain listPortalShipments/toPortalShipmentDto and
returns/list.ts with returnScopePredicate. Existing DTO statuses, counts, money,
tracking identity, event clocks and CSV exports are unchanged. No new business
calculation. The untrusted input is browser storage; saved-views.ts allowlists
page-specific status/sort values and rejects extra keys. Query key builders are
shared by hooks and exact invalidation so reopening an active/cached view fetches
fresh backend data without using a duplicate cache identity.

Tests: browser restore/reload, first page, fresh requests, CSV intent, local/global
client isolation, preserved order constraint, malformed storage, mobile layout,
and existing Orders/Inventory views. Typecheck, build, architecture,
shadow-renderer, contract/scope/redaction and focused shipment/return guards.
No backend/schema/provider change. Existing direct-main/live authorization applies.
Only mocked APIs in browser tests; no labels, tracking refreshes or live data writes.
Rollback: revert the code; stored preferences are inert without the controls.

## Verification

- Typecheck, production build, architecture, shadow-renderer, contract drift,
  client/store scope, redaction, page sizes, table sorting, session cache,
  shipment identity/status, return fields/scope/UI/arrival and bundle checks pass.
- 30 browser cases pass: existing Orders/Inventory saved views, six new
  Shipments/Returns cases, both CSV regression suites and portal search.
- Desktop and 390px mobile screenshots reviewed; controls and save dialogs fit.
- Existing hosted saved-view step includes the new cases without CI changes.
- Full-site certification passed, including maintainability, production bundle,
  portal smoke, complete UI suite and failure-state checks.
