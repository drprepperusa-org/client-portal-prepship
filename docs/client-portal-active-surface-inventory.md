# Client Portal active surface inventory

This inventory is the deployment boundary for the Vite application in
`portal-client/`. Only routes reachable from `portal-client/src/App.tsx` count
as active Client Portal UI.

| Route | Page owner | Notes |
| --- | --- | --- |
| `/` | `Dashboard.tsx` | Authenticated landing page |
| `/orders` | `Orders.tsx` | Order list and shared order detail |
| `/inbound` | `Inbound.tsx` | Inbound creation and receiving |
| `/shipments` | `Shipments.tsx` | Shipment and tracking display |
| `/returns` | `Returns.tsx` | Returns workflow |
| `/inventory` | `Inventory.tsx` | Inventory and movement history |
| `/analysis` | `Analysis.tsx` | Backend-owned analysis read models |
| `/billing` | `Billing.tsx` | Billing shell; imports `Invoices.tsx` as its reachable invoice implementation |
| `/rates` | `Rates.tsx` | Rate-sheet presentation |
| `/connections` | `Connections.tsx` | Tenant-scoped integrations |
| `/audit-log` | `AuditLog.tsx` | Capability-gated audit surface |
| `/settings` | `Settings.tsx` | Capability-gated access and settings |
| `/components` | `Components.tsx` | Authenticated component reference |

`/reports` and `/invoices` are compatibility redirects to `/billing`.
`/login` and `/activate` are the unauthenticated and activation entry points.

## Retired and legacy surfaces

- `Finance.tsx` was never imported or routed and is retired. Its reports data
  remains reachable through the canonical Billing surface.
- `portal-client/src/lib/portalScope.ts` is retired. Backend authorization scope
  now owns the full client/store union; browser filters only narrow requests.
- `scripts/client-portal-finance-sot-guard.mjs` is retired with the dead page.
- `web/` is the retained legacy admin frontend. It is not part of the active
  Client Portal build or certification.
- Legacy-only static checks are quarantined as
  `scripts/legacy-admin-api-guard.mjs` and
  `scripts/legacy-admin-backend-connectivity-guard.mjs`. Their package scripts
  use the `legacy:` prefix, so active guard discovery cannot mistake them for
  Client Portal certification.

## Contract boundary

Backend-owned, versioned DTO contracts live under
`src/lib/client-portal/contracts/`. The frontend domain clients under
`portal-client/src/lib/api/domains/` import those contracts through the
`@client-portal-contracts/*` type-only alias. `portal-client/src/lib/api.ts` is
only the compatibility facade.
