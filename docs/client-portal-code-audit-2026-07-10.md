# Client Portal Code Audit — 2026-07-10

## Outcome

The active `portal-client/` frontend remains a backend-shadow renderer. CP-056
replaced the monolithic frontend-owned API contract file with backend-owned,
versioned contracts and small domain clients. HTTP routes, database schema,
billing formulas, status ownership, permissions, and canonical data owners did
not change.

The final validation baseline passes TypeScript, the production build, bundle
budgets, architecture and shadow-renderer guards, failure-state guards, the
active authenticated browser audit, and full-site certification.

## Measurements

Physical line counts include comments and blank lines. Function/component sizes
come from the TypeScript AST.

| Surface | Before | After | Result |
|---|---:|---:|---|
| Active frontend | 117 files / 16,645 lines | 125 files / 17,274 lines | Accessibility and test modules added |
| `portal-client/src/pages/Invoices.tsx` | 632 lines / 538-line component | 396 lines / 342-line component | Refactored |
| `portal-client/src/pages/Returns.tsx` | 531 lines | 306 lines / 274-line component | Drawer and metadata extracted |
| `portal-client/src/components/ui/DataTable.tsx` | 462 lines / 373-line component | 436 lines / 342-line component | Controls and movement logic extracted |
| `portal-client/src/lib/api.ts` | 1,284 lines | 20 lines | Compatibility facade; exception removed |
| `src/routes/client-portal/returns.ts` | 904 lines | 904 lines | Frozen exception; may not grow |
| `StoreConnectModal.tsx` | 484 lines | 484 lines | Kept; already staged internally |
| `Dashboard.tsx` | 357 lines / 318-line component | 357 lines / 318-line component | Below function limit |

New focused modules include billing column/format helpers, the billing shipment
drawer, return detail/presentation modules, dialog-focus behavior, chart data
alternatives, and DataTable column controls.

The CP-056 contract split adds 10 frontend endpoint domains (largest: 105
lines), a 116-line transport module, a 45-line parameter/scope helper, and 11
backend contract domains (largest: 119 lines). All are below the default file
limit.

Generated/vector logo assets are excluded from maintainability measurements.

## Resolved findings

- Modal, Drawer, and mobile navigation now enter, trap, and restore focus; close
  on Escape; lock page scrolling; and expose dialog names. Closed mobile
  navigation is inert.
- The app shell has a skip-to-content link and a stable focusable main target.
- Shared buttons default to `type="button"`; mobile controls use 44px targets.
- DataTable sorting uses real buttons. Clickable rows require an accessible row
  action label/control. Column movement supports keyboard buttons as well as
  pointer drag-and-drop.
- Recharts accessibility is enabled. Charts retain visible focus, use shared
  semantic color tokens, expose collapsible data tables, and provide compact
  day selectors for drill-down charts.
- Invoices and Returns were split without changing backend-owned totals,
  return status/redaction, export behavior, or shipment billing semantics.
- String-based SOT guards now inspect the extracted feature modules while
  retaining their original assertions.
- The active browser audit covers Dashboard, Orders, Inbound, Shipments,
  Returns, Inventory, Analysis, Billing, Connections, and admin Settings at
  375px, 768px, and 1440px. It uses a fixed fake Supabase session, intercepted
  Client Portal DTOs, and blocks external traffic.

## Enforced limits

`npm run audit:client-portal-maintainability` scans active Client Portal
TypeScript using physical LOC and TypeScript AST function sizes:

- Default file limit: 500 lines.
- Default function/component limit: 350 lines.
- Frozen exception: the returns backend route at 904 lines. Growing above its
  baseline fails the audit. The former `api.ts` exception is resolved.

`npm run test:web-bundle-budget` enforces:

| Asset budget | Limit | 2026-07-10 result |
|---|---:|---:|
| CSS raw | 75 KiB | 51,641 bytes |
| CSS gzip | 15 KiB | 9,953 bytes |
| Largest JS raw | 735 KiB | 720,519 bytes |
| Largest JS gzip | 215 KiB | 209,151 bytes |
| Total JS raw | 1.9 MiB | 1,857,776 bytes |
| Total JS gzip | 535 KiB | 523,077 bytes |

## Deferred hotspots

- `src/routes/client-portal/returns.ts`: route splitting remains deferred until
  its contract and SOT guards can migrate together.
- The generated UPS/vector logo remains outside maintainability metrics.
- The chart vendor chunk is within the approved cap but remains the largest
  production chunk; future chart-library/code-splitting work should lower it
  before adding significant chart surface area.
