# Rate sheet editing

## Settings shortcut

Global admins can also open **Settings → Rate Sheet**, beside Billing, to search client accounts and switch rate editing on or off. Each switch sends only `canEditRateSheet` to the existing audited access API; it never resubmits roles or client assignments. The displayed state comes from the refreshed access roster, and a denied save does not optimistically enable editing. The Access edit modal remains available and reads the same permissions.

This is a presentation-only entry point. The canonical fresh-admin grant checks, PrepShip rate-writing permission checks, and assigned-client boundaries are unchanged. Browser coverage verifies grant/revoke, permission-only payloads, Access consistency, search, keyboard interaction, mobile layout, failed writes, and hiding the tab from scoped account managers.

Admins use Settings → Access → select a client user → Edit → **Allow adding and editing rate sheets**. The grant is off by default and is stored in admin-owned Supabase app metadata as `rate-sheet:write`. It never adds broad financial or settings permissions. Grant/revoke requires a fresh active admin lookup and the existing mandatory access audit.

The Rate Sheet gets its editing capability from PrepShip. Authorized users can add/edit service rates, edit an existing client box price, or add a priced box. Each request forwards that user's bearer token to `/billing/rate-sheet/*`; no privileged service token is substituted.

PrepShip's `rate-sheet-access.ts` verifies current metadata and assigned clients on every save. `rate-sheet-commands.ts` delegates to `billing-rate-configuration.ts` and `billing-package-box.ts`. Those owners write shared `billing_config` / `client_package_prices` tables with required transactional audit. PrepShip's existing pricing editors use the same owners. Neither frontend calculates authoritative pricing, and no portal-specific rates table exists. Refresh either app to see saved rates; historical invoice lines are not regenerated.

User input and stale JWT grants are the entry points for invalid data. Backend field/precision validation, live grant checks and client/package scoping fail closed. React only collects values and displays backend results. Unrelated legacy zero-price package associations remain hidden; deliberately added free boxes remain visible.

Proof: `npm run test:rate-sheet-permissions`, relevant-package scoped-read test, existing access/architecture guards, and `web/e2e/client-portal-rate-sheet.spec.js` (admin switch, service and box saves, denial, client filtering, mobile). All mutation tests use disposable fixtures; no production grants or pricing were changed while implementing this feature.

Release PrepShip backend before the portal. Until the upstream capability endpoint is ready, the portal stays read-only.

## Local verification, 2026-11-07

Both builds and typechecks pass. The new permission/proxy tests, client-price isolation tests,
and seven Rate Sheet/admin browser scenarios pass. PrepShip's configuration transaction tests
cover immediate revocation, cross-client denial, audit rollback, explicit free boxes and
publishing a client price over an inherited catalog default.

## Release check repairs, 2026-11-07

The receiving-worksheet customization guard now permits only that user-scoped table's
approved client reordering; other tables retain the shared admin/global gate. Export
checks pin both server-generated CSV and XLSX transports and still reject rebuilding
files locally (25/25 mutation cases killed). The monthly-period integration is enrolled
in CI and passes against a disposable local database.

Returns' status filter is extracted as a presentation-only component to meet the
function-size limit. Browser fixtures explicitly open optional hidden columns and
supply the canonical billing-column policy; they retain all customer-data assertions.
Full-site certification passes, including all 41 portal UI scenarios, and all 15
focused Rate Sheet/inbound export and customization scenarios pass.

The shared Supabase server client explicitly supplies the documented ws transport for
Node 20. Rate permission tests remove the native WebSocket constructor before importing
the client, covering the CI compatibility failure without changing permission rules.
The source of truth remains PrepShip's shared pricing and access owners; no production
account grants, prices, invoices, shipments or marketplace actions were changed in testing.

All 196 local release guards passed. CI browser jobs are pinned to Ubuntu 24.04 because the installed Playwright version cannot install Chromium on Ubuntu 26.04. The pinned upstream finalization contract also matches through the authenticated GitHub connection; the CI-specific PREPSHIP_CONTRACT_TOKEN was reported expired and is being renewed separately.

The token was renewed and all four hosted cross-repository parity checks passed.
Remaining browser fixtures now supply the canonical billing-column policy, assert
inbound SKU/name cells separately, and require Returns exports to preserve the list's
date filters. Repaired scenarios, all 22 export/finalization scenarios, and all 16
production-dashboard loading scenarios pass without changing application behavior.
