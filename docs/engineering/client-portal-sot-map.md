# Client Portal — Source-of-Truth & Mapping Matrix (CP-003)

> **Status:** active. Authored for **CP-003** (Client Portal active mapping/SOT
> cleanup). This document is the canonical map of where each Client Portal
> surface's business truth lives, how it reaches the browser, and which
> guard/test keeps the two aligned.

## Active vs legacy

- **Active Client Portal frontend:** `portal-client/` (Vite + React + Tailwind).
  This is the only deploy/build/verify target for the Client Portal.
- **Active Client Portal backend:** this repo's Hono API — `src/main.ts` mounts
  `/api/client-portal`, and `src/routes/client-portal.ts` owns the route family.
- **Legacy:** `web/` is retained on disk but is **not** the deployed portal.
  Anything that certifies `web/src/...` is legacy-only and must not gate active
  Client Portal completion. See [Stale legacy guards](#stale-legacy-guards-follow-up).

## Source-of-truth laws

1. **Backend / read-model / DTO owns business truth** — scoped data, money,
   rates, inventory counts, billing math, access scope, financial visibility.
2. **The portal frontend renders safe DTO state and sends user intent only.** It
   may hold UI-only state (filters, pagination, the client switcher) and may
   fan out / merge per-client requests, but it must never become the authority
   for rate selection, billing math, inventory truth, client/store scope, or
   financial-visibility decisions.
3. **Wrappers/helpers may translate and render, never decide.** `portal-client`
   API helpers (`portal-client/src/lib/api.ts`) translate params and merge
   scoped responses; the backend re-checks every client/store id, so a frontend
   filter can only ever *narrow* visibility, never widen it.

## Deployment topology

```
Browser ──▶ Vercel (portal-client/dist, static)
            │  rewrite: /api/client-portal/:path*
            ▼
        Render: client-portal-prepship.onrender.com
            │  src/main.ts → app.route('/api/client-portal', …)
            ▼
        src/routes/client-portal.ts  ── reads ──▶ Postgres (scoped)
```

- `vercel.json` proxies the whole `/api/client-portal/*` family to this repo's
  own Render backend with a single catch-all rewrite. The portal no longer
  per-route-proxies into the shared internal PrepShip API — it owns its API.
- Enforced by `npm run guard:client-portal-architecture`.

## SOT / mapping matrix

| Surface | Internal source | Backend owner (route → read-model/DTO) | Portal DTO fields (`portal-client/src/lib/api.ts`) | Frontend consumer | Guard / test | Redaction & scope rule |
|---|---|---|---|---|---|---|
| **Orders list/detail** | `orders` (+ `order_overrides`, `shipments` for latest), `clients`/`stores` for names | `GET /orders`, `GET /orders/:id` → `toPortalOrderDto()` (`src/lib/client-portal/dto.ts`) | `PortalOrder` | `pages/Orders.tsx` (`portalApi.orders`/`order`) | `test:client-portal-orders-selected-rate`, `guard:client-portal-api` | Scope by `clientIds`/`storeIds` (`scope.ts`); financial fields only when `canViewFinancials` |
| **SKU / items / quantity** | `orders.items` JSON (discount lines excluded), `inventory` master | `safeItems()` + `isDiscountLine()` (`dto.ts`); `safeItemQty()` (`dashboard-aggregate.ts`) | `PortalOrder.items[{sku,name,quantity,imageUrl}]` | `pages/Orders.tsx` (qty badges), `pages/Dashboard.tsx` (Top SKUs) | `test:client-portal-orders-selected-rate`, `test:dashboard-bar-chart-top-skus` | `unitPrice` withheld unless `canViewFinancials`; non-shippable/discount rows dropped |
| **Selected Rate vs Best Rate** | `shipments.selectedRateJson` + shipment carrier/service/amount (selected); `order_overrides.bestRateJson` (best) | `toPortalOrderDto()` selected-rate + shippingAccount/shippingService chain (`dto.ts`) | `PortalOrder.selectedRate`, `shippingAccount`, `shippingService`, `bestRateJson?` | `pages/Orders.tsx` (Selected Rate column; **no** Shipping Account/Best Rate columns for clients) | `test:client-portal-orders-selected-rate` (CP-001) | `selectedRate.amount` = `null` unless `canViewFinancials`; raw `bestRateJson` only when financials |
| **Shipments / tracking** | `shipments` | `GET /shipments` → `toPortalShipmentDto()` (`dto.ts`) | `PortalShipment` | `pages/Shipments.tsx` | `guard:client-portal-api`, `test:label-shipment-scope-review` | No raw label URLs/payloads in DTO; scope by `clientIds`/`storeIds` |
| **Inventory stock / effective qty** | `inventory` (+ `packages`, sold-last-30 aggregate) | `GET /inventory`, `GET /inventory-history` → `toPortalInventoryDto()` (`dto.ts`) | `PortalInventory`, `InventoryMovement` | `pages/Inventory.tsx` | `test:inventory-client-scope`, `guard:client-portal-api` | Scope by `clientIds`/`storeIds`; effective stock computed server-side |
| **Dashboard daily orders/units + Top SKUs** | scoped `orders` rows for the date range | `GET /dashboard`, `/daily-counts`, `/daily-shipments` → `dailyOrderUnitsRows()` + `topSkuRows()` + `dailyRevenueRows()` (`dashboard-aggregate.ts`) | `DashboardSummary` (`bySku[].avgShippingPrice`, `daily[{day,orders,units}]`), `DailyCount` | `pages/Dashboard.tsx` (`OrdersUnitsBarChart`, Top SKUs table), `components/charts/Charts.tsx` | `test:dashboard-bar-chart-top-skus` (CP-002), `test:dashboard-client-scope`, `test:dashboard-client-filter` | `avgShippingPrice`/`revenue` = `null` unless `canViewFinancials` (enforced in aggregate, not UI); multi-SKU shipping allocated by qty share (never double-counted) |
| **Billing / invoices / financial visibility** | billing line items, `orders`, `shipments`, markups | `/reports`, `/invoice-details`, `/invoice`, `/billing/status`, `POST /billing/generate`, `/markups` | `BillingSummaryRow`, `BillingInvoiceDetailRow`, `billingVisible`, `MarkupGroup`/`MarkupValue` | `pages/Billing.tsx`, `pages/Invoices.tsx`, `pages/Finance.tsx`, `pages/Settings.tsx` (markups) | `test:billing-client-scope`, `guard:client-portal-api` | `billingVisible` gate (`canViewFinancials`); `billing/generate` + `markups` write paths are admin-only |
| **Access roster / users / roles / scope** | Supabase users + app metadata (`clientIds`/`storeIds`/`role`/`permissions`) | `GET /me`, `/clients`, `/access-list`, `PATCH`/`DELETE /access-list/:id`; `resolveClientPortalScope()`/`assertClientPortalScope()` (`scope.ts`) | `PortalMe`, `PortalClientRow`, `PortalAccessUser`, `AccessUserPatch` | `pages/Settings.tsx`, top-bar client switcher | `test:rbac-permissions`, `test:client-store-scope`, `test:field-level-rbac`, `guard:client-portal-architecture` | Invite-only (no public signup); `client_user`/`read_only_support` require explicit scope; filters narrow only; protected operator account cannot be deactivated/deleted |
| **Integrations / connections** | carrier accounts / store connectors / integrations | `GET /integrations` → `toPortalIntegrationDto()` (`dto.ts`) | `PortalIntegration` (`provider`, `label`, `accountIdentifier`, `source`, `active`, `type`) | `pages/Connections.tsx` | `test:credential-accounts`, `test:client-redaction`, `guard:client-portal-api` | Credentials/tokens/secrets never serialized; `canViewCredentials` gate; account identifiers only, no blobs |
| **Inbound / receiving** | `inbound_shipments` + `inbound_items` | `GET`/`POST /inbound`, `PATCH /inbound/:id/receive`, `POST /inbound/import` → `toPortalInboundDto()` (`dto.ts`) | `PortalInbound`, `PortalInboundItem`, `NewInboundInput` | `pages/Inbound.tsx` | `guard:client-portal-api` (active); `receive-sku-picker` guard is legacy → follow-up | Scope by `clientId`; receive→inventory bump is server-owned |
| **Analysis** | scoped `orders`/`inventory` SKU rollups | `GET /analysis`, `/analysis/sku-orders` | `AnalysisBreakdown`, `AnalysisSkuRow`, `SkuOrdersResult` | `pages/Analysis.tsx` | `test:analysis-client-scope` | Scope by `clientIds`/`storeIds`; `firstStoreId` restricts single-store sessions |

## Active verification commands

These certify the **active** Client Portal stack and currently pass:

```bash
npm run typecheck                              # backend (src/) + portal-client/  ← now active, not web/
npm run build:web                              # builds portal-client/dist
npm run test:client-portal-orders-selected-rate   # CP-001
npm run test:dashboard-bar-chart-top-skus         # CP-002
npm run guard:client-portal-api
npm run guard:client-portal-architecture
npm run test:client-portal-failure-states         # CP-003 follow-up (active failure-state coverage)
```

Legacy `web/` typecheck is preserved but no longer gates the active build:

```bash
npm run typecheck:web:legacy                   # tsc -p web/tsconfig.json (legacy-only)
```

## Stale legacy guards (follow-up)

The following guards hard-read `web/src/components/Views/*` files that no longer
exist; they crash with `ENOENT` and certify the retired `web/` app, not the
active portal. They are **not** part of active Client Portal verification.
Recommended follow-up: re-point each to its `portal-client/src/...` equivalent
*or* rename/annotate it as legacy-only (e.g. a `:web:legacy` suffix) so it can't
be mistaken for active certification. **None should gate active portal work.**

| Guard script | Legacy path read | Recommended action |
|---|---|---|
| ~~`frontend-failure-states-guard.mjs`~~ | — | ✅ **Done this pass** — replaced by the active `client-portal-failure-states-guard.mjs` (see "What CP-003 changed" #5); `guard:frontend-failure-states` + `test:full-site-certification` now run the active guard |
| `source-of-truth-guard.mjs` | Analysis/Dashboard/Orders/Inventory views | Re-point to `portal-client/src/pages/*` or mark legacy-only |
| `orders-ux-guard.mjs`, `orders-request-pressure-guard.mjs`, `orders-startup-requests-guard.mjs` | `OrdersView.tsx` | Re-point to `pages/Orders.tsx` or legacy-only |
| `order-detail-drawer-lazy-guard.mjs`, `secondary-order-detail-lazy-guard.mjs` | Orders/Inventory/Analysis/Billing/Packages views | Re-point or legacy-only |
| `dashboard-chart-lazy-guard.mjs`, `dashboard-first-paint-guard.mjs` | `DashboardView.tsx`/`DashboardCharts.tsx` | Re-point to `pages/Dashboard.tsx` + `components/charts/Charts.tsx` or legacy-only |
| `inventory-default-view-guard.mjs`, `inventory-source-of-truth-guard.mjs`, `receive-sku-picker-guard.mjs` | `InventoryView.tsx` | Re-point to `pages/Inventory.tsx`/`pages/Inbound.tsx` or legacy-only |
| `analysis-table-first-guard.mjs`, `analysis-lazy-table-guard.mjs` | `AnalysisView.tsx` | Re-point to `pages/Analysis.tsx` or legacy-only |
| `best-rate-dims-guard.mjs` | `OrdersView.tsx` | Re-point or legacy-only |
| `test-order-queue-label-guard.mjs` | `OrdersView.tsx` | Internal/operator flow — likely legacy-only |
| `api-observability-metrics-guard.mjs` | `SettingsView.tsx` | Re-point to `pages/Settings.tsx` or legacy-only |

## What CP-003 changed (this pass)

1. **Active typecheck** — root `typecheck` now certifies the backend (`src/`) +
   `portal-client/`; the legacy `web/` typecheck moved to `typecheck:web:legacy`.
2. **Retired a dead active guard** — removed `test:dashboard-orders-units` and
   its `scripts/dashboard-orders-units-guard.mjs` (it read the deleted legacy
   `web/.../DashboardView.tsx`). Active dashboard certification is owned by
   `test:dashboard-bar-chart-top-skus`.
3. **Re-aligned `guard:client-portal-architecture`** to the active SOT: it now
   asserts the current own-backend `vercel.json` rewrite and validates the
   active `portal-client/` login + auth (invite-only, no public signup) instead
   of the legacy `web/` files — without weakening any security assertion.
4. **Authored this SOT/mapping matrix.**
5. **Re-pointed the failure-states guard** — replaced the dead legacy
   `frontend-failure-states-guard.mjs` (it read removed `web/` files) with
   `scripts/client-portal-failure-states-guard.mjs`, which pins the active
   portal's real failure-state model: bounded `fetch` timeouts that throw
   (never swallow), the shared `QueryState` error + `Retry` UI, and the live
   Orders query wiring. `guard:frontend-failure-states` and
   `test:full-site-certification` now run the active guard.

### CP-003 claim accuracy note

The card's headline blocker #1 (a React Router `BrowserRouter future`-prop
typecheck error) does **not** exist on `main`: `portal-client` is on
`react-router-dom` 6.30.3, where that prop is valid, and
`npm --prefix portal-client run typecheck` passes clean. Claims #2 (stale guard
paths) and #3 (root typecheck certified legacy `web/`) were accurate and are
addressed above.

## Deferred (tracked follow-ups)

- Re-point or legacy-scope the remaining stale guards above (the priority one,
  `frontend-failure-states`, is done — see change #5).
- Optional extraction of read-model-heavy blocks from the large
  `src/routes/client-portal.ts` into `src/lib/client-portal/read-models/*`
  (out of scope for this pass to avoid an unreviewable rewrite).
