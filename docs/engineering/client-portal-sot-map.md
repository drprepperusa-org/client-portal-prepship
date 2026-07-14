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
| **Orders list/detail** | `orders` + normalized `order_items` + latest active `shipments` tracking; `order_overrides` tracking is legacy fallback only; `clients`/`stores` for names | `GET /orders`, `GET /orders/:id` → shared `toPortalOrderDto()` (`src/lib/client-portal/dto.ts`) | `PortalOrder` (`items[]`, `orderedUnits`, `displayTrackingNumber`) | `pages/Orders.tsx` (`portalApi.orders`/`order`) and shared `OrderDetailLoader` | `test:client-portal-orders-canonical-data`, `guard:client-portal-api` | Scope by `clientIds`/`storeIds` (`scope.ts`); financial fields only when `canViewFinancials`; carrier/service identity hard-nulled |
| **SKU / items / quantity** | normalized `order_items` for reporting and order display; `orders.items` JSON is compatibility metadata only; `inventory` master | `getClientPortalSalesMetrics()` / `getSkuBreakdownFromOrderItems()` for Dashboard and Analysis; `toPortalOrderDto()` maps the complete normalized item set and sums `orderedUnits` | `PortalOrder.items[{sku,name,quantity,imageUrl}]`, `PortalOrder.orderedUnits`; `DashboardSummary.units`, `daily[].orderedUnits`, `bySku[]` | `pages/Orders.tsx`, `pages/Dashboard.tsx`, `pages/Analysis.tsx` | `test:client-portal-orders-canonical-data`, `test:client-portal-analytics-parity`, `test:dashboard-bar-chart-top-skus` | `unitPrice`/`lineTotal` withheld unless `canViewFinancials`; no frontend quantity fallback or item cap |
| **Selected Rate vs Best Rate** | `shipments.selectedRateJson` + shipment carrier/service/amount (selected); `order_overrides.bestRateJson` (best) | `toPortalOrderDto()` selected-rate + shippingAccount/shippingService chain (`dto.ts`) | `PortalOrder.selectedRate`, `shippingAccount`, `shippingService`, `bestRateJson?` | `pages/Orders.tsx` (Selected Rate column; **no** Shipping Account/Best Rate columns for clients) | `test:client-portal-orders-selected-rate` (CP-001) | `selectedRate.amount` = `null` unless `canViewFinancials`; raw `bestRateJson` only when financials |
| **Shipments / tracking** | `shipments` | `GET /shipments` → `toPortalShipmentDto()` (`dto.ts`) | `PortalShipment` | `pages/Shipments.tsx` | `guard:client-portal-api`, `test:label-shipment-scope-review` | No raw label URLs/payloads in DTO; scope by `clientIds`/`storeIds` |
| **Inventory stock / effective qty** | `inventory` (+ `packages`, sold-last-30 aggregate) | `GET /inventory`, `GET /inventory-history` → `toPortalInventoryDto()` (`dto.ts`) | `PortalInventory`, `InventoryMovement` | `pages/Inventory.tsx` | `test:inventory-client-scope`, `guard:client-portal-api` | Scope by `clientIds`/`storeIds`; effective stock computed server-side |
| **Dashboard daily orders/units/status/shipments + Top SKUs** | scoped `order_items` + `orders` + `shipments` for the full date range | `GET /dashboard` → `getClientPortalDashboardSummary()`; canonical sales/SKU owner `getSkuBreakdownFromOrderItems()` / `getClientPortalSalesMetrics()`; `buildDashboardDailyRows()` owns period context | `DashboardSummary` (`openOrderCount`, `period`, intent-named `daily[]` metrics, `bySku[]`) | `pages/Dashboard.tsx`, `ChartDayModal`, KPI peek, chart components | `test:client-portal-dashboard-full-scope`, `test:client-portal-analytics-parity`, `test:dashboard-client-filter` | One backend request handles the complete client/store union; no 1,000-row cap or browser totals/ranks; revenue and billed shipping are financially redacted by the canonical owner |
| **Billing / invoices / financial visibility** | billing line items, `orders`, `shipments`, markups | `/reports`, `/invoice-details`, `/invoice`, `/billing/status`, `POST /billing/generate`, `/markups` | `BillingSummaryRow`, `BillingInvoiceDetailRow`, `billingVisible`, `MarkupGroup`/`MarkupValue` | `pages/Billing.tsx`, `pages/Invoices.tsx`, `pages/Finance.tsx`, `pages/Settings.tsx` (markups) | `test:billing-client-scope`, `guard:client-portal-api` | `billingVisible` gate (`canViewFinancials`); `billing/generate` + `markups` write paths are admin-only |
| **Access roster / users / roles / scope** | Supabase users + app metadata (`clientIds`/`storeIds`/`role`/`permissions`) | `GET /me`, `/clients`, `/access-list`, `PATCH`/`DELETE /access-list/:id`; `resolveClientPortalScope()`/`assertClientPortalScope()` (`scope.ts`) | `PortalMe`, `PortalClientRow`, `PortalAccessUser`, `AccessUserPatch` | `pages/Settings.tsx`, top-bar client switcher | `test:rbac-permissions`, `test:client-store-scope`, `test:field-level-rbac`, `guard:client-portal-architecture` | Invite-only (no public signup); `client_user`/`read_only_support` require explicit scope; filters narrow only; protected operator account cannot be deactivated/deleted |
| **Integrations / connections** | carrier accounts / store connectors / integrations (`store_accounts`, RLS) | `GET /integrations` → `toPortalIntegrationDto()` (`dto.ts`); `POST /integrations` (admin-only) → pending `store_accounts` row (`source='portal'`, inactive until operator promotion) | `PortalIntegration` (`provider`, `label`, `accountIdentifier`, `source`, `active`, `type`); `NewIntegrationInput` (credentials write-only, never returned) | `pages/Connections.tsx` (pending = `source='portal'`) | `test:credential-accounts`, `test:client-redaction`, `guard:client-portal-api` (incl. POST assertions) | Credentials/tokens/secrets never serialized or echoed; audit stores field names + masked identifier only; `canViewCredentials` gate; portal submissions can't overwrite live accounts (409 on conflict) |
| **Inbound / receiving** | `inbound_shipments` + `inbound_items` | `GET`/`POST /inbound`, `PATCH /inbound/:id/receive`, `POST /inbound/import` → `toPortalInboundDto()` (`dto.ts`) | `PortalInbound`, `PortalInboundItem`, `NewInboundInput` | `pages/Inbound.tsx` | `guard:client-portal-api` | Scope by `clientId`; receive→inventory bump is server-owned |
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

## Legacy guards — removed ✅

All guards that hard-read the removed `web/src/components/Views/*` files have been
**deleted** (guard files + their `package.json` script entries), so the project no
longer carries crashing legacy guards that could be mistaken for active
certification. None gated active verification or CI (`.github/workflows/ci.yml`
runs only `typecheck` + `build:web`). Removed this work:

`dashboard-chart-lazy`, `dashboard-first-paint`, `analysis-lazy-table`,
`analysis-table-first`, `receive-sku-picker`, `inventory-default-view`,
`inventory-source-of-truth`, `api-observability-metrics`, `orders-ux`,
`orders-request-pressure`, `orders-startup-requests`, `test-order-queue-label`,
`order-detail-drawer-lazy`, `secondary-order-detail-lazy`, `best-rate-dims`,
`source-of-truth` — plus the earlier `dashboard-orders-units`, and
`frontend-failure-states` (replaced by the active `client-portal-failure-states-guard.mjs`).

The retired `web/` app remains on disk; if any of these behaviors need active
coverage they should be re-authored against `portal-client/` (as
`client-portal-failure-states-guard.mjs` was), not revived against `web/`.

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
6. **Removed all dead legacy `web/` guards** — deleted 16 guard scripts (and
   their `package.json` entries) that hard-read removed `web/src/components/Views/*`
   files, so legacy guards can no longer be mistaken for active certification
   (see "Legacy guards — removed").
7. **Unified the discount-line predicate (CP-002 C2-6)** — `isDiscountLine` now
   lives once in `dashboard-aggregate.ts` and is used by both the dashboard
   aggregations (`safeItemQty`, `topSkuRows`) and the order DTO (`dto.ts`), so
   daily unit counts and Top-SKU rollups exclude negative-price promo lines
   exactly like the order item list — one source of truth for "a shippable
   unit." Guarded by new assertions in `test:dashboard-bar-chart-top-skus`.

### CP-003 claim accuracy note

The card's headline blocker #1 (a React Router `BrowserRouter future`-prop
typecheck error) does **not** exist on `main`: `portal-client` is on
`react-router-dom` 6.30.3, where that prop is valid, and
`npm --prefix portal-client run typecheck` passes clean. Claims #2 (stale guard
paths) and #3 (root typecheck certified legacy `web/`) were accurate and are
addressed above.

## Deferred (tracked follow-ups)

- Extraction of read-model-heavy blocks from `src/routes/client-portal.ts` —
  **done** (route 2,160 → 1,245). Layers: `lib/client-portal/predicates.ts`
  (scope/search SQL guardrails), `lib/client-portal/read-models/*` (orders,
  shipments, inventory, integrations, invoice-details, access roster +
  admin-user helpers), and `lib/client-portal/invoice-html.ts` (printable
  invoice renderer). The route file keeps param parsing, RBAC checks, audits,
  route tokens, and the command flows that belong at the HTTP boundary
  (billing/generate, markups, backfill, inbound mutations, access PATCH/DELETE,
  POST /integrations) — deliberately not extracted.
