# PrepShip Source of Truth Matrix

## Purpose

PrepShip uses a layered source-of-truth model. The goal is not to make one
table own every fact. The goal is to make each domain explicit about which
external system, PrepShip table, frozen snapshot, or read model is allowed to
own a fact at each stage of the workflow.

Target model:

```text
External source truth
  -> normalized operational truth
    -> frozen side-effect snapshots
      -> reporting/read-model truth
```

Status key:

- `[OK]` clean/current
- `[MIXED]` transitional or mixed ownership
- `[MISSING]` missing or ambiguous ownership
- `[MUST-FIX]` must be fixed before enterprise production

## Current Layering Rules

- External marketplaces and carriers own facts created outside PrepShip.
- PrepShip Postgres owns normalized operational state used by the warehouse.
- Side effects such as labels, selected rates, billing rows, and inventory
  deductions must be snapshotted at action time.
- Reporting, dashboards, and analysis are read models. They must be
  reproducible and refreshable, not mutation owners.
- Caches such as `rate_cache` are performance artifacts. They are not billing
  or audit truth.
- Client portal reads use `/api/client-portal/*` as a safe DTO boundary over
  operational truth. The portal boundary may narrow by `clientIds` and
  `storeIds`, but it must not become a new source of truth or expose raw
  credentials, provider payloads, internal notes, labels, or unrestricted
  financial fields.

## Domain Matrix

### Orders

Status: `[MIXED]`

External source truth:
- ShipStation, Walmart, eBay, Shopify, Amazon, or future store APIs own the
  original marketplace order facts.

Normalized operational truth:
- `orders` is the local normalized order record.
- Source identity fields such as `source_provider`, `source_account_id`,
  `source_order_id`, and `source_order_number` define external provenance.

Frozen/snapshot truth:
- Terminal local workflow decisions such as locally printed labels and terminal
  shipped/cancelled protection are local operational facts.
- Order-level selected-rate overrides are snapshots only until a shipment
  freezes the final selected rate.

Derived/read-model/cache truth:
- Order list APIs, sidebar counts, and dashboard summaries are read models over
  `orders`, `order_items`, and shipment state.

Mutation owner:
- Order sync services and marketplace import routes.
- Shopify direct order sync (`src/services/shopify-order-sync.ts`) polls client
  Shopify stores (GraphQL Admin API 2026-04, forward-only from the promotion
  anchor `store_accounts.sync_anchor_at`) and persists through the shared
  store-order-import upsert. Buyer-paid Shopify shipping lands in
  `orders.shipping_amount` as record/display data only; the Customer Shipping
  Rate remains owned by frozen billing → projection (CP-040).
- User-facing order mutation routes only for editable `awaiting_shipment`
  orders.

Read/API owner:
- `src/routes/orders.ts`
- dashboard/analysis/inventory routes for read-only derived views.

Freshness/staleness rules:
- Imported order facts are as fresh as the last successful connector sync.
- Local terminal state must not be overwritten by stale external reads.

Audit/provenance requirements:
- Preserve raw external payloads and source identity.
- Any manual override should record actor, timestamp, and reason where possible.

Never recalc after snapshot:
- Terminal workflow transitions caused by a PrepShip label or human shipped
  action.
- External source identity.

Known gaps:
- Store connector ingestion is not yet the only import path.
- Some code still treats `orders.items` JSONB as reporting input.

Next hardening step:
- Make every new importer write the same source identity fields and normalize
  item data into `order_items`.

### Order Items / SKU Analytics

Status: `[MIXED]`

External source truth:
- Marketplace order line payloads.

Normalized operational truth:
- `order_items` is the target canonical table for SKU, quantity, line total,
  client, store, status, and order date analytics.

Frozen/snapshot truth:
- The order-line state at import/sync time should be preserved for billing,
  pick/pack analysis, SKU velocity, and reporting.

Derived/read-model/cache truth:
- Dashboard SKU trends, analysis modal rows, inventory velocity, and billing
  item counts should read from `order_items` or read models built from it.

Mutation owner:
- `src/services/order-items.ts`
- Import/sync flows that refresh order item rows when order payloads change.

Read/API owner:
- `src/routes/dashboard.ts`
- `src/routes/inventory.ts`
- `src/routes/analysis.ts`
- billing services after migration.

Freshness/staleness rules:
- `order_items` should refresh whenever canonical order items change.
- Reporting caches should record generation window and time.

Audit/provenance requirements:
- Preserve the original raw item payload in `orders.items` for compatibility
  and traceability while using `order_items` for analytics.

Never recalc after snapshot:
- Billing item counts once invoice line items are generated.

Known gaps:
- `orders.items` JSONB is still used in billing, frontend helpers, legacy
  inventory seeding, and some docs.

Next hardening step:
- Move billing/reporting reads off `orders.items` and keep JSONB only as raw
  import compatibility.

### Inventory

Status: `[OK]`

External source truth:
- External stores may provide product/catalog facts, but PrepShip owns local
  warehouse stock once inventory is received or deducted.

Normalized operational truth:
- `inventoryQuantity = SUM(inventory_ledger.qty)` is the only on-hand quantity.
- Product/SKU defaults live on inventory rows where PrepShip manages them.

Frozen/snapshot truth:
- Immutable `inventory_ledger` rows own inventory movement history: receives, deductions,
  returns, corrections, and manual adjustments.

Derived/read-model/cache truth:
- Low-stock alerts, days supply, velocity, and enrichment views are read models.

Mutation owner:
- Inventory routes/services.
- Fulfillment deduction services gated by the inventory auto-deduct kill switch.

Read/API owner:
- `src/routes/inventory.ts`
- Dashboard/reporting APIs for stock summaries.

Freshness/staleness rules:
- Current quantity is derived immediately from committed movement rows; no balance cache exists.
- Velocity and days-supply metrics may lag until reporting refresh.

Audit/provenance requirements:
- Every stock change should have a ledger row with source, order/shipment
  reference when applicable, actor/source, and note.

Never recalc after snapshot:
- Historical ledger quantities and deduction reasons.

Known gaps:
- Some inventory seeding/enrichment still scans `orders.items`.

Next hardening step:
- Use `order_items` and reporting metrics for velocity/enrichment instead of
  raw order JSON scans.

### Rates

Status: `[MIXED]`

External source truth:
- Carrier APIs and ShipStation rate APIs own live quotes at quote time.

Normalized operational truth:
- PrepShip rate service normalizes live results, applies filters, blocked
  services, package rules, and markups for display/selection.

Frozen/snapshot truth:
- `shipments.selectedRateJson` owns the rate selected at label time.
- Order override `bestRateJson` is an editable recommendation/selection before
  label purchase, not final billing truth.

Derived/read-model/cache truth:
- `rate_cache` is a cache only.

Mutation owner:
- `src/services/rates.ts`
- Label purchase flow when freezing the selected rate snapshot.

Read/API owner:
- `src/routes/rates.ts`
- order detail/rate UI through approved rate APIs.

Freshness/staleness rules:
- Cached rate rows expire by cache key/version/time and must not override live
  purchase responses.

Audit/provenance requirements:
- Store provider/account/service details on the selected shipment snapshot.

Never recalc after snapshot:
- Selected label rate, carrier account used, service code, and package selected
  for a purchased label.

Known gaps:
- Imported/direct carrier handlers still exist beside the canonical rate
  service.

Next hardening step:
- Enforce one rate normalization/markup path and keep imported handlers as
  thin compatibility wrappers only.

### Carrier Accounts / Credentials

Status: `[MIXED]`

External source truth:
- Carrier providers own credential validity and account capabilities.

Normalized operational truth:
- `carrier_accounts` owns carrier account records and encrypted/secret
  credential payloads.
- `carrier_account_clients` is the target authoritative account-to-client
  assignment table.

Frozen/snapshot truth:
- Shipment rows should store the provider/account identity used to buy a label.

Derived/read-model/cache truth:
- Settings UI, carrier cards, and capability matrix views are read models over
  carrier accounts and assignments.

Mutation owner:
- Carrier account/settings routes and credential verification flows.

Read/API owner:
- `src/routes/carrier-accounts.ts`
- carrier settings APIs and rate/label credential resolution.

Freshness/staleness rules:
- Credential validity is live/external.
- Assignment state is durable in PrepShip.

Audit/provenance requirements:
- Credential create/update/delete/test/use should be audited without exposing
  secret values.

Never recalc after snapshot:
- Carrier account used for a purchased label or manifest.

Known gaps:
- `clients.ssApiKey`, `clients.ssApiSecret`, `clients.ssApiKeyV2`, and
  `clients.rateSourceClientId` still exist as legacy credential paths.

Next hardening step:
- Implement one credential resolver contract:

```ts
type CarrierCredentialResolution = {
  apiKeyV2: string | null
  carrierAccountId: number | null
  clientId: number | null
  sourceClientId: number | null
  source:
    | 'carrier_account_clients'
    | 'client_rate_source'
    | 'client_legacy'
    | 'env_default'
  warnings: string[]
}
```

The resolver should eventually be used by rates, labels, manifests, carrier
verification, and sync where applicable.

### Labels / Shipments

Status: `[OK]` with `[MIXED]` test/mock compatibility

External source truth:
- The carrier/ShipStation owns live label purchase and tracking confirmation.

Normalized operational truth:
- `shipments` owns PrepShip label/shipment records and marketplace
  confirmation state.

Frozen/snapshot truth:
- Tracking number, label cost, label provider, selected rate, service, package,
  account, label date, and marketplace confirmation event history.

Derived/read-model/cache truth:
- Label PDFs, print queue state, shipment status chips, and analytics are
  derived from durable shipment records and queue state. Client Portal
  shipment status uses the backend `portalShipmentStatusSql` expression over
  `shipments.voided` plus persisted `shipments.tracking_status`; tracking-number
  presence is not a lifecycle input.

Mutation owner:
- `src/services/labels.ts`
- direct carrier label persistence helpers.
- print queue services for queue state.

Read/API owner:
- `src/routes/labels.ts`
- orders route shipment joins.
- print queue APIs.

Freshness/staleness rules:
- DB shipment row is production truth.
- External tracking state can be refreshed later but must not rewrite the
  action-time snapshot.

Audit/provenance requirements:
- Capture provider, account, tracking, cost, selected rate, source, and
  confirmation state without leaking label secrets or customer PII.

Never recalc after snapshot:
- Label cost, selected rate, package used, carrier account used, and tracking
  number for the purchased label.

Known gaps:
- `mock_labels` and in-memory/test label state are valid only for test/dev
  compatibility. Production must not treat in-memory mock state as truth.

Next hardening step:
- Keep explicit naming and guards that separate mock/test label state from
  durable production `shipments` truth.

### Manifests

Status: `[MIXED]`

External source truth:
- Carrier/ShipStation owns official manifest acceptance and closeout state.

Normalized operational truth:
- PrepShip manifest records or manifest API responses should own local manifest
  grouping and operator-visible status.

Frozen/snapshot truth:
- Manifested shipment IDs, carrier/provider/account used, manifest date,
  response IDs, costs if applicable, and closeout result.

Derived/read-model/cache truth:
- Manifest page summary, export rows, and operational reports.

Mutation owner:
- Manifest routes/services.

Read/API owner:
- Manifest UI/API.

Freshness/staleness rules:
- Manifest status should be refreshed from provider only by explicit refresh or
  background job.

Audit/provenance requirements:
- Record who created/closed a manifest, provider response, and shipment set.

Never recalc after snapshot:
- The shipment set included in a closed manifest.

Known gaps:
- Manifest source-of-truth ownership is less documented than rates/labels.

Next hardening step:
- Define manifest tables/status fields and require all manifest flows to store
  provider/account provenance.

### Billing

Status: `[MIXED]`

External source truth:
- No external billing platform currently owns PrepShip billable operations.
- Carrier/provider costs are external facts until captured on shipments.

Normalized operational truth:
- `billing_config` owns billing rules and active billing settings.
- Orders, shipments, packages, inventory ledger, and carrier costs are billing
  inputs.

Frozen/snapshot truth:
- `billing_line_items` should be treated as frozen billable records once
  generated.

Derived/read-model/cache truth:
- Billing previews, summaries, and invoice exports are read models over frozen
  line items and source inputs.

Mutation owner:
- Billing services/routes.

Read/API owner:
- Billing APIs and admin billing UI.

Freshness/staleness rules:
- Draft/previews may be recalculated.
- Generated line items should not drift when source config later changes.

Audit/provenance requirements:
- Generated billable lines should preserve enough description, quantity, unit
  cost, total cost, source shipment/order/package/config, and generation time
  to prove why the charge exists.

Never recalc after snapshot:
- Invoiced billing line item amount, quantity, and source explanation.

Known gaps:
- Billing still reads `orders.items` and reconstructs some charges from live
  source rows.

Next hardening step:
- Move SKU/unit billing inputs to `order_items` and snapshot billing config
  values at line-item generation time.

### Reporting / Dashboard / Analysis

Status: `[MIXED]`

External source truth:
- None. Reporting should consume PrepShip operational truth and external-source
  timestamps.

Normalized operational truth:
- Orders, order items, shipments, inventory, billing, and sync state.

Frozen/snapshot truth:
- Generated reporting artifacts should record input window, filters, job ID,
  generated time, and source version/window.

Derived/read-model/cache truth:
- Reporting metrics, analytics cache, dashboard aggregates, and analysis tables.

Mutation owner:
- Reporting/metrics refresh services and worker jobs.

Read/API owner:
- Dashboard, analysis, and reporting routes.

Freshness/staleness rules:
- Every cached/reporting response should expose freshness or generation time.

Audit/provenance requirements:
- Record date window, client/store filters, source tables/windows, and refresh
  job where applicable.

Never recalc after snapshot:
- Published/exported reporting artifacts unless regenerated with a new artifact
  ID/time.

Known gaps:
- Dashboard/analysis and docs still contain some raw `orders.items` assumptions.

Next hardening step:
- Make reporting metrics/read models the standard API input for dashboard and
  analysis pages.

#### CP-021 — Client-portal Dashboard KPI/widget SOT mapping

Each Dashboard KPI/widget below is named after the entity + table it reads, so
two numbers on the same page can never silently mean different things. All
ranked/financial numbers are backend-owned; the frontend renders DTO fields
verbatim (no client-side ranking, revenue, units, or shipping math).

| UI label | Frontend field | Backend DTO field | Canonical table / read-model | Event clock |
| --- | --- | --- | --- | --- |
| Open orders | `dash.data.openOrderCount` | `openOrderCount` | `awaitingActiveOrderCount` over `orders` (live awaiting) | order state (now) |
| Shipped orders (Nd) | `dash.data.period.shippedOrderCount` | `period.shippedOrderCount` | `getClientPortalDashboardSummary` — `orders.order_status='shipped'` grouped by `order_date` | order date |
| Ordered units (Nd) | `dash.data.units` | `units` | `getClientPortalSalesMetrics` — Σ `order_items.quantity` (set-based) | order date |
| Revenue (Nd) | `dash.data.revenue` | `revenue` | `getClientPortalSalesMetrics` — Σ `order_items.unit_price × quantity` (set-based, financially gated) | order date |
| Orders over time (bar) | `dash.data.daily[]` | `daily[].orderedOrders.value`, `daily[].orderedUnits.value` | `getClientPortalDashboardSummary` + `getClientPortalSalesMetrics`; complete scoped SQL aggregate with no row cap | order date |
| Shipments created (bar) | `dash.data.daily[]` | `daily[].shipmentsCreated.value` | `getClientPortalDashboardSummary` — active `shipments` rows grouped by `ship_date` | ship date |
| Top SKUs → SKU / Unit Count Last 30 Days | `dash.data.bySku[].units30` | `bySku[].units30` | `projectDashboardTopSkus` → `getSkuBreakdownFromOrderItems` (`total_qty`, set-based over `order_items`) — SAME query as the Analysis Top-SKUs table | order date |
| Top SKUs → Avg Shipping Price | `dash.data.bySku[].avgShippingPrice` | `bySku[].avgShippingPrice` | canonical billed shipping (`billing_line_items`, `customer_billed`) ÷ charged units; financially gated | billing shipment/order allocation |

Ownership rules established by CP-021:

- Dashboard Top-SKUs (ranking + per-SKU units + Avg Shipping Price) is a thin
  projection over the ONE canonical Analysis SKU query
  (`getSkuBreakdownFromOrderItems`). Because it is the same query for the same
  scope/date window, numeric parity with the Analysis page is structurally
  guaranteed — there is no second definition to drift.
- `getClientPortalDashboardSummary` owns the complete multi-client/store scope
  union, daily status/shipment aggregates, period totals, averages, shares, and
  ranks. No Dashboard business aggregate is capped or merged in the browser.
- Avg Shipping Price has ONE source of truth: canonical customer-billed shipping
  from `billing_line_items`, NOT raw `orders.shippingAmount` or internal label
  cost. Financial redaction lives in the backend owner.
- Labels name the entity: "Shipped orders" (`orders.order_status`) is distinct
  from "Shipments created" (`shipments` rows by `ship_date`); "Ordered units"
  (order-clock `order_items` quantity) is NOT shipped units.

Guard: `scripts/client-portal-dashboard-sot-guard.mjs`
(`npm run test:client-portal-dashboard-sot`).

### Clients / Stores

Status: `[MIXED]`

External source truth:
- Marketplaces and ShipStation own external store IDs and account identifiers.

Normalized operational truth:
- `clients` owns client/customer records.
- Current `clients.storeIds` is a transitional store ownership list.
- Target model should include normalized stores/account mappings.

Frozen/snapshot truth:
- Orders and shipments should store source account/store/provider identity at
  action time.

Derived/read-model/cache truth:
- Sidebar store counts, settings store cards, and assignment chips.

Mutation owner:
- Client/store settings routes and connector account routes.

Read/API owner:
- Init/stores APIs, settings APIs, orders sidebar counts.

Freshness/staleness rules:
- Store assignments are durable PrepShip config.
- External store metadata refreshes only by connector sync or admin action.

Audit/provenance requirements:
- Record store/account assignment changes and source provider identity.

Never recalc after snapshot:
- Source store/account on imported orders and purchased labels.

Known gaps:
- `clients.storeIds` array is not a full enterprise store/account ownership
  model.

Next hardening step:
- Create normalized `stores` and client-store/account mapping model before
  adding more marketplace connectors.

### Sync / Worker State

Status: `[OK]` with operational dependencies

External source truth:
- External APIs own upstream data availability and modified timestamps.

Normalized operational truth:
- Sync settings/watermarks, job queue state, worker status, and advisory locks
  own local sync progress.

Frozen/snapshot truth:
- Sync run results, errors, processed row counts, and recovery/backfill windows.

Derived/read-model/cache truth:
- `/sync/status`, `/worker/status`, UI sync pills, and operational diagnostics.

Mutation owner:
- Sync scheduler, job queue, worker process, and cron/recovery endpoints.

Read/API owner:
- Sync/worker status routes and frontend status components.

Freshness/staleness rules:
- Worker heartbeat and last successful sync must be recent enough for operator
  confidence.
- Watermarks must only advance after durable successful processing.

Audit/provenance requirements:
- Record run mode, account/client scope, since-window, counts, failures, and
  last error without exposing secrets or PII.

Never recalc after snapshot:
- Completed sync run result and watermark advancement reason.

Known gaps:
- Production freshness evidence may require authenticated tokens/operator
  access.

Next hardening step:
- Keep status tooling authenticated and add a redacted signoff artifact for
  production freshness checks.

### Settings / Configuration

Status: `[MIXED]`

External source truth:
- External providers own credential validity and API capabilities.

Normalized operational truth:
- PrepShip settings tables, client config, carrier account config, billing
  config, and environment variables own runtime configuration.

Frozen/snapshot truth:
- Action-time config used for labels, billing lines, inventory deductions, and
  manifests.

Derived/read-model/cache truth:
- Settings UI cards, system status, cache status, and diagnostics.

Mutation owner:
- Settings/admin routes and credential/config services.

Read/API owner:
- Settings routes, init routes, and system status APIs.

Freshness/staleness rules:
- UI status should reflect current persisted config plus live verification
  results where available.

Audit/provenance requirements:
- Config and credential changes should be audited with actor and redacted
  before/after metadata.

Never recalc after snapshot:
- Config values used for frozen billing/label/manifest actions.

Known gaps:
- Some config still lives in legacy client columns or environment-only fallback
  paths.

Next hardening step:
- Define a config precedence resolver per domain and expose provenance in
  diagnostics without exposing secrets.

## Explicit Dual-Truth Areas

### `orders.items` vs `order_items`

Current truth:
- `orders.items` is raw/import compatibility.
- `order_items` is the target canonical item analytics table.

Target truth:
- All SKU analytics, billing item counts, dashboard metrics, picklists, and
  inventory velocity use `order_items`.

Risk if left mixed:
- Different pages can show different quantities, revenue, or SKU velocity.

Safe migration path:
- Keep writing `orders.items`.
- Keep refreshing `order_items`.
- Move read paths domain by domain.
- Add guards so new reporting code does not use raw JSONB directly without a
  temporary whitelist.

Guard/test needed:
- Source-of-truth guard warning for new `orders.items` reporting usage.

### `clients.storeIds` vs Normalized Store Ownership

Current truth:
- `clients.storeIds` is the current assignment mechanism.

Target truth:
- Normalized store/account ownership tables with provider, source account,
  source store ID, client assignment, active/test flags, and sync settings.

Risk if left mixed:
- Store connector identity, order dedupe, sidebar counts, and confirmation
  routing can diverge.

Safe migration path:
- Introduce normalized stores in parallel.
- Backfill from client store IDs.
- Route new connector work through normalized store mappings.

Guard/test needed:
- Guard for new store ownership logic that bypasses the normalized store model
  after it exists.

### Client Credential Fields vs Carrier Account Tables

Current truth:
- `clients.ssApiKey*` and `clients.rateSourceClientId` still serve legacy
  ShipStation credential flows.
- `carrier_accounts` and `carrier_account_clients` are the target account model.

Target truth:
- One credential resolver returns the credential/account assignment with
  provenance.

Risk if left mixed:
- Rates, labels, manifests, and sync can use different accounts for the same
  client/order without clear explanation.

Safe migration path:
- Implement resolver in one place.
- Have all domain services use it.
- Keep legacy client fields only as fallback sources with warnings.

Guard/test needed:
- Guard direct credential lookup patterns outside approved resolver paths.

### Live Rate vs `rate_cache` vs Selected Shipment Rate

Current truth:
- Live provider API is quote truth at fetch time.
- `rate_cache` is a cache.
- `shipments.selectedRateJson` is final action-time selected-rate truth.

Target truth:
- Billing and audit use selected shipment rate, not stale cache.

Risk if left mixed:
- Invoices or reports may change after rates are refetched.

Safe migration path:
- Keep cache for UI speed only.
- Freeze selected rate during label purchase.
- Make billing consume shipment snapshots.

Guard/test needed:
- Guard direct billing use of `rate_cache` as invoice truth.

### Billing Recalculation vs Frozen `billing_line_items`

Current truth:
- Billing can still reconstruct from live orders/items/shipments.
- `billing_line_items` exists as generated billing records.

Target truth:
- Draft previews can recalculate; generated/invoiced line items are frozen.

Risk if left mixed:
- Historical invoices drift when package costs, billing config, rates, or order
  item parsing changes.

Safe migration path:
- Snapshot config and source facts into line items at generation time.
- Treat invoiced rows as immutable except explicit adjustment/credit flows.

Guard/test needed:
- Guard invoiced line item mutation paths and live recalculation used for
  historical invoice totals.

### Reporting Cache vs Operational Tables

Current truth:
- Operational tables own facts.
- Reporting metrics/analytics cache should own prepared read models.

Target truth:
- Dashboard and analysis read from reproducible read models where practical.

Risk if left mixed:
- Pages can duplicate formulas, issue slow queries, or show inconsistent
  numbers.

Safe migration path:
- Move heavy calculations into reporting services.
- Include `generatedAt`, input window, and source filters in cache rows.

Guard/test needed:
- Guard new broad raw order scans in frontend/dashboard paths.

### Mock/In-Memory Labels vs Durable `shipments`

Current truth:
- Mock/test labels are allowed for test mode.
- Durable `shipments` is production label truth.

Target truth:
- In-memory/mock labels are never production source of truth.

Risk if left mixed:
- Production labels can appear missing, duplicate, or unverifiable after process
  restart.

Safe migration path:
- Keep mock code explicitly named and scoped.
- Persist even test labels enough for UI/queue flows.
- Use `shipments` for all production label state.

Guard/test needed:
- Guard production label paths against depending on in-memory label maps.

## Frozen Snapshot Rules

Freeze these at action time:

- selected rate
- carrier account used
- package used
- label cost
- label provider and tracking number
- billed package cost
- billing config values used to generate line items
- inventory deduction reason and quantity
- shipment confirmation status/event history
- manifest shipment set and provider response
- order terminal state transition reason

Live external data can change later. Frozen snapshots remain the proof of what
PrepShip used at the time.

## Guardrail Strategy

The first guard is intentionally warning-oriented. It should:

- fail when this matrix document is missing or loses required sections;
- warn on transitional patterns already present in the repo;
- report likely drift with file path and suggested owner/service;
- stay local and non-destructive;
- require no database credentials or production secrets.

Suggested package script name:

```json
{
  "guard:source-of-truth": "node scripts/source-of-truth-guard.mjs"
}
```

## Recommended Follow-Up Tasks

- Implement the carrier credential resolver contract and migrate rates/labels
  first.
- Migrate billing SKU/unit reads from `orders.items` to `order_items`.
- Define normalized stores/account ownership tables before adding more direct
  marketplace ingestion.
- Make reporting metrics the standard dashboard/analysis input.
- Add immutable adjustment/credit flows for any future billing corrections.

## Client Portal Source-of-Truth Matrix (CP-025)

### Shadow-renderer law (intro)

The Client Portal is a **shadow renderer** of PrepShip / database truth. It
derives every business value — status, bucket, rate, total, count, metric, and
any customer-visible field — from a database / PrepShip-backed canonical owner
(a table, a service, or a shared backend read-model extracted from one). If
PrepShip already shows or uses a value, the Client Portal pulls from that **same
owner**, never a parallel re-derivation.

`portal-client/` may arrange, format, sort, and hide visible rows, and may make
presentation or derived computations **only** when every input is sourced from
database/PrepShip AND the computation does not become an independent source of
truth. Any customer-visible or operationally authoritative computation is pushed
into a **backend DTO / read-model** so PrepShip and the portal share one
definition and cannot drift. Backend Client Portal APIs expose **intent-named
DTO fields** (`customerShippingRate`, `inventoryQuantity`, `warehouseShipped30d`,
`shippingCharged`, `chargeSummary`, `expectedUnits`, …) that delegate to the
canonical owner; generic names are used only when the DTO docs already name the
source + event clock + formula. The Client Portal must never invent source data,
rank/select rates from competing internal fields, create an alternate
billing/inventory/status/redaction truth, silently fall back to a stale/nearby
field, or duplicate a PrepShip calculation in a driftable way.

The authoritative wording of this law lives in `AGENTS.md`
(mirrored to `CLAUDE.md` / `.cursorrules`). This section is the surface-by-surface
mapping that makes the law auditable.

**Classification key** (rightmost column of each table):

- `presentation-only` — the frontend only formats / arranges / hides an
  already-canonical value; no business fact is created.
- `derived-from-canonical` — a computed value, but every input is a canonical
  source and the formula/owner is documented (ideally backend-owned).
- `backend-owned-truth` — the canonical owner itself (a table / service /
  read-model) that other surfaces shadow.

Customer-facing carrier / service / provider / rate identity is **never** shown
(hard-nulled in the DTO). This is a redaction-truth rule, not a presentation
choice — see the Carrier redaction remediation (CP-009/CP-018) below.

### Dashboard

Detailed per-widget mapping lives in the **CP-021 Dashboard KPI/widget SOT
mapping** table above (`### Reporting / Dashboard / Analysis` →
`#### CP-021`). In short: every ranked/financial KPI is backend-owned
(`getClientPortalDashboardSummary`, reusing the canonical
`getSkuBreakdownFromOrderItems` and full-window `getClientPortalSalesMetrics`).
The same DTO owns daily status/shipment facts and period context; the browser
does not fan out, cap, merge, total, average, share, or rank them. Guard:
`scripts/client-portal-dashboard-sot-guard.mjs`.

### Orders

| UI label | Frontend field | Backend DTO field | Canonical owner | Event clock | Classification |
| --- | --- | --- | --- | --- | --- |
| Order # | `orderNumber` | `orderNumber` | `orders.order_number` | order date | presentation-only |
| Status | `orderStatus` | `orderStatus` | `orders.order_status` | order state | presentation-only |
| Order date | `orderDate` | `orderDate` (ISO) | `orders.order_date` | order date | presentation-only |
| Tracking | `displayTrackingNumber` | `displayTrackingNumber` | latest active `shipments.label_tracking` → legacy `shipments.tracking_number`; documented `order_overrides.trackingNumber` fallback only when no active shipment tracking exists | label time | backend-owned-truth (CP-052) |
| Ordered units | `orderedUnits` | `orderedUnits` | Σ complete `order_items.quantity` in `toPortalOrderDto` | order time | derived-from-canonical (backend-owned, CP-052) |
| Carrier / service | (hidden) | `carrierCode`/`serviceCode`/`shippingService` = **null** | hard-nulled in `toPortalOrderDto` | n/a | backend-owned-truth (redaction) |
| Ship-to | `shipToName/City/State` | same | `orders` columns + raw `shipTo` jsonb (client's own recipient) | order time | presentation-only |
| Weight (admin only) | `weightOz` | `weightOz` | `orders.weight_oz`, gated by `scope.isGlobal` in the order read-model | order import / packing update time | presentation-only (operator-only) |
| Shipping charge | `customerShippingRate` | `customerShippingRate` | billed `Σ billing_line_items` (shipping) → fallback `orders.shippingAmount` | billing / order time | derived-from-canonical (backend-owned) |

Owner: `src/lib/client-portal/dto.ts` (`toPortalOrderDto`) over `orders` /
`order_items` / `order_overrides`. Route: `src/routes/client-portal/orders.ts`.
Guards: `client-portal-orders-canonical-data-guard.ts` (complete canonical
items, ordered units, and shipment tracking), `client-portal-orders-selected-rate-guard.mjs` (no internal
selected/label/best rate leaks), `client-portal-orders-search-guard.mjs`,
`client-portal-carrier-redaction-guard.ts` (CP-009/CP-018 redaction).

### Order Detail

| UI label | Frontend field | Backend DTO field | Canonical owner | Event clock | Classification |
| --- | --- | --- | --- | --- | --- |
| Line item name/sku/qty | `items[]` | complete `items[]` (no silent cap) | normalized `order_items`; `orders.items` is compatibility metadata only | order time | backend-owned-truth (CP-052) |
| Line total | `lineTotal` | `lineTotal` | normalized `order_items.line_total` | order time | backend-owned-truth (CP-014/CP-052) |
| Product subtotal | `productSubtotal` | `productSubtotal` | Σ line totals in `toPortalOrderDto` | order time | derived-from-canonical (backend-owned, CP-014) |
| Charge summary receipt | `chargeSummary[]` | `chargeSummary[]` | `buildCostSummary` — reconciles to `orders.orderTotal` to the cent | order time | backend-owned-truth (CP-017/CP-038) |

Owner: one canonical loader — every entry point (Orders list, Shipments drawer)
fetches `/orders/:id` and renders the shared `OrderDetailLoader` /
`OrderDetailPanel` (CP-022), so no surface re-derives detail from a raw list row.
Guard: `client-portal-order-detail-guard.ts`.

### Shipments

| UI label | Frontend field | Backend DTO field | Canonical owner | Event clock | Classification |
| --- | --- | --- | --- | --- | --- |
| Tracking # | `displayTrackingNumber` | `displayTrackingNumber` | `toPortalShipmentDto`: frozen `shipments.label_tracking`, else legacy `shipments.tracking_number` | label time | backend-owned-truth (CP-051) |
| Ship date | `shipDate` | `shipDate` | `shipments.ship_date`/`label_ship_date`/`create_date` | ship date | presentation-only |
| Delivery status | `shipmentStatus` | `shipmentStatus` | `portalShipmentStatusSql`: voided wins; known persisted carrier status passes through; no carrier movement = `label_created`; invalid persisted value = `unavailable` | carrier event; forced manual refresh or hourly background recheck | backend-owned-truth (CP-042/CP-051) |
| Delivered at | `deliveredAt` | `deliveredAt` | `shipments.delivered_at`, using the official carrier or ShipStation per-label delivery event time when available | carrier delivery event | backend-owned-truth (CP-042) |
| Carrier / service | (hidden) | `carrierCode`/`serviceCode` = **null** | hard-nulled in `toPortalShipmentDto` | n/a | backend-owned-truth (redaction) |
| Customer Shipping Rate | `shippingCost` | `shippingCost` (financially gated) | frozen `Σ billing_line_items` (`line_type='shipping'`, by shipment) → strict PrepShip `shipments.selected_rate_json.cShippingRateAmount` snapshot (`customerShippingMoneyPolicyVersion='ps-437-v1'`); never raw cost or a Client Portal formula | PrepShip label/billing freeze | backend-owned-truth (PS-437, gated) |
| Items | `items[]` | `items[]` | shipment `orderItems` → `order_items` | order time | presentation-only |

Owner: `toPortalShipmentDto` over `shipments`. Route:
`src/routes/client-portal/shipments.ts` + read-model
`read-models/shipments.ts`. Tracking writer: `shipment-tracking.ts`; the Client
Portal only renders its persisted result. Writer input order is official carrier
tracking when configured, then ShipStation `/v2/labels/{label_id}/track` using
persisted `shipments.shipstation_label_id`; tracking-number lookup resolves only
a missing label ID. Successful lookups advance `tracking_checked_at`; failures
write `tracking_failed_at`/`tracking_error` without advancing the success clock,
so retry remains eligible. Delivered is terminal. Guards: `client-portal-shipments-status-guard.ts`,
`client-portal-shipments-item-identity-guard.ts`.

### Inventory

| UI label | Frontend field | Backend DTO field | Canonical owner | Event clock | Classification |
| --- | --- | --- | --- | --- | --- |
| On-hand stock | `inventoryQuantity` | `inventoryQuantity` | signed `SUM(inventory_ledger.qty)` via `inventory-stock-math` | movement effective/posted time | backend-owned-truth (PS-439) |
| Stock status (In/Low/Out) | required `stockStatus`; malformed runtime data → `UNAVAILABLE` | `stockStatus` | backend enum in `toPortalInventoryDto` (mirrors read-model `lowStock` predicate) | now | backend-owned-truth (CP-013/CP-053) |
| "Sold" / shipped (30d) | `warehouseShipped30d` | `warehouseShipped30d` | `inventory_ledger` ship rows by ship date — **NOT** ordered/sold units | ship date | backend-owned-truth (CP-023) |
| Reorder level | `reorderLevel` | `reorderLevel` | `inventory.reorderLevel` | now | presentation-only |
| Cubic feet / dims | `cuFt`, `length/width/height` | same | `inventory` dims, override else L×W×H/1728 | now | derived-from-canonical (backend-owned) |

Owner: `toPortalInventoryDto` + read-model `listPortalInventory`
(`inventory` catalog + immutable `inventory_ledger`). Route:
`src/routes/client-portal/inventory.ts`. The `warehouseShipped30d` name is
deliberately SOT-encoded so it can never be confused with Analysis "Ordered
Units". Guards: `client-portal-inventory-sold-label-guard.mjs` (CP-023, ledger
ships not order units), `client-portal-inventory-status-guard.ts` (CP-013).

### Analysis

| UI label | Frontend field | Backend DTO field | Canonical owner | Event clock | Classification |
| --- | --- | --- | --- | --- | --- |
| Ordered units | `totalUnits` | `totalUnits` | `getClientPortalSalesMetrics` — Σ `order_items.quantity` (set-based) | order date | backend-owned-truth (CP-010/049) |
| Revenue | `totalRevenue` | `totalRevenue` | `getClientPortalSalesMetrics` — Σ `unit_price × qty` (financially gated) | order date | backend-owned-truth (CP-010/049) |
| Top-SKU rows | `rows[]` (`sku`, item identity, scoped IDs, `orders`, `pending`, `total_qty`, `total_revenue`, `daily_qty`) | explicit `ClientAnalysisSkuRow` whitelist | `getSkuBreakdownFromOrderItems` (set-based over `order_items`), narrowed at the Client Portal API boundary | order date | backend-owned-truth (CP-047) |
| Std/Exp ship counts | not exposed | not exposed | retained only in the shared backend analysis owner for operator/admin consumers | ship date | backend-owned-truth (CP-020/CP-047) |

Owner: `src/routes/analysis.ts` (`getClientPortalSalesMetrics`, with compatibility
projections for totals/daily revenue, and `getSkuBreakdownFromOrderItems`). The
Dashboard shadows this exact query set — parity is structural, not a re-implementation.
Guards: `client-portal-analytics-parity-guard.mjs` (CP-010),
`client-portal-sales-sot-drift-guard.mjs`,
`client-portal-analysis-ship-bucket-guard.mjs` (CP-020),
`client-portal-analysis-columns-guard.mjs`,
`client-portal-analysis-dto-redaction-guard.mjs` (CP-047).

### Billing reports summary

| UI label | Frontend field | Backend DTO field | Canonical owner | Event clock | Classification |
| --- | --- | --- | --- | --- | --- |
| Charge breakdown | `breakdown[]` | `breakdown[]` (`pick_pack`, `shipping`, …) | `/reports` route over `billing_line_items` | billing time | backend-owned-truth (CP-012) |
| Total charges | `totalCharges` | `totalCharges` | `/reports` route (backend sum) | billing time | backend-owned-truth (CP-012) |
| Billable orders | `billableOrders` | `billableOrders` | `/reports` route (backend count) | billing time | backend-owned-truth (CP-012) |
| Avg charge / order | `avgChargePerOrder` | `avgChargePerOrder` | `totalCharges / billableOrders` (zero-guarded, backend) | billing time | backend-owned-truth (CP-012/CP-038) |

Owner: `src/routes/client-portal/billing.ts` (`/reports`). Redacted
(`billingVisible:false`) for non-financial callers. The routed Billing page
issues one scoped request and reduces nothing. The former unrouted
`Finance.tsx` surface is retired. Guards: `client-portal-contract-drift-guard.mjs`
and `client-portal-active-surfaces-guard.mjs`.

### Billing

| UI label | Frontend field | Backend DTO field | Canonical owner | Event clock | Classification |
| --- | --- | --- | --- | --- | --- |
| Per-client rollup | `pickpack_total`, `shipping_total`, `storage_total`, `package_total`, `row_total` | same | `portalInvoiceSummary` — SQL rollup over `billing_line_items` (no row cap) | billing time | backend-owned-truth |
| Order count | `orders` | `orders` | `portalInvoiceSummary` (`count(distinct)`) | billing time | backend-owned-truth |
| Line-item sort/pagination | ordering | backend order | `read-models/invoice-details.ts` | billing time | presentation-only |

Owner: `read-models/invoice-details.ts` (`portalInvoiceSummary` +
`portalInvoiceDetails`). Qty comes from canonical `order_items`, never from
summed billing-line quantities. **Billing generation authority stays in the
admin app; the portal is read-only** (never re-enable portal auto-generation).
Guards: `client-portal-billing-totals-guard.mjs`,
`client-portal-billing-item-identity-guard.ts`,
`client-portal-billing-line-item-sort-guard.mjs`,
`client-portal-billing-shipment-modal-guard.ts`.

### Invoices / exports

| UI label | Frontend field | Backend DTO field | Canonical owner | Event clock | Classification |
| --- | --- | --- | --- | --- | --- |
| Invoice line items | `items[]` (name/sku/qty) | invoice-detail rows | `read-models/invoice-details.ts` over `billing_line_items` + `order_items` | billing time | backend-owned-truth |
| Printable invoice totals | section totals / amount due | backend totals | invoice read-model (CP-024 — HTML money is backend-owned) | billing time | backend-owned-truth (CP-024) |
| Excel "Export all" | full-range rows | paginated fetch of every line item | invoice-details, page-through (no 5000/1000-row truncation) | billing time | presentation-only |
| Carrier code | (never shipped) | dropped from `invoice-details` SQL + DTO | — | n/a | backend-owned-truth (redaction, CP-018) |

Owner: `read-models/invoice-details.ts`, `Invoices.tsx`. The `.xlsx` stays
client-safe (no carrier/service). Guards:
`client-portal-invoice-items-guard.ts`,
`client-portal-invoice-export-range-guard.mjs`.

### Returns (CP-026 → CP-031)

| UI label | Frontend field | Backend DTO field | Canonical owner | Event clock | Classification |
| --- | --- | --- | --- | --- | --- |
| Return status | `status` | `status` | `returns.status` (workflow table) | return workflow | backend-owned-truth (CP-026) |
| Reason | `reason` | `reason` | `returns.reason` | return workflow | presentation-only |
| Return tracking | `trackingNumber` | `returnTracking` = `coalesce(shipments.labelTracking, shipments.trackingNumber)` | **`shipments`** (label SOT stays there) | label time | backend-owned-truth (CP-026/027) |
| Return reference | `returnReference` | same | persisted `returns.return_reference`; legacy fallback/backfill derives `order_number + '-RETURN'` once | return workflow creation | backend-owned identity |
| Return label PDF | `pdfUrl` | `returnLabelUrl` | `shipments.labelUrl` (never a new URL) | label time | presentation-only |
| Label needs attention | `status` / `deliveryError` | same | `returns.status = 'label_failed'` + redaction-safe `returns.deliveryError` | latest label attempt | backend-owned-truth (CP-043) |
| Return postage | `returnCustomerShippingRate` or explicit pending state | same | PrepShip `customer-shipping-money.ts` rejects missing/all-zero return pricing before a provider call, then freezes the full policy-versioned money tuple on `shipments.selected_rate_json` from exact `selected_rate_cost`; Client Portal exposes or bills the compatibility alias only when it agrees to the cent with that complete tuple | pre-purchase policy check + return label finalization | backend-owned-truth (CP-031/043, PS-435/437) |
| Delivery method/status | `deliveryMethod`/`deliveryStatus` | same | `returns` delivery columns (CP-028 resolver) | delivery event | backend-owned-truth (CP-028) |
| Item (partial qty) | `items[]` | `items[]` | `return_items` → links `order_items` | return workflow | backend-owned-truth (CP-026) |
| Inspection condition | `condition` | `condition` | operator-only receiving route → `return_inspections` (6-value enum) | warehouse inspection | backend-owned-truth (CP-030/045) |
| Client return evidence | evidence notes/media | pending client inspection DTO + `media[]` | scoped client submission in `return_inspections` / `return_inspection_media`; never advances lifecycle | client evidence submission | backend-owned authority boundary (CP-045) |
| Inspection media | `media[]` | `media[]` (`storageRef`) | `return_inspection_media` (metadata only, never the binary); clients may attach only to client evidence submissions | evidence/receiving | backend-owned-truth (CP-030/045) |
| Inspection history | `inspections[]` | append-only inspection DTOs | `return_inspections` | each receiving/inspection save | backend-owned-truth |
| Return activity | `activity[]` | redaction-safe lifecycle events | `return_activity_events`; tracking status sourced from `shipments` updates | source event time | backend-owned-truth |
| Original order milestones | `orderActivity[]` | redaction-safe placed/shipment-created/shipped/delivered events | `orders.order_date` + outbound `shipments` event timestamps | canonical source timestamp | backend-owned-truth |

Owner: `src/db/schema/returns.ts` (`returns` / `return_items` /
`return_inspections` / `return_inspection_media` / `return_activity_events`), route
`src/routes/client-portal/returns.ts`, services `src/services/returns.ts`
(label) + `src/services/return-delivery.ts`. **The new tables never re-declare
label money / tracking / rate — that truth stays on `shipments`.** The route
never rate-shops or picks a carrier; the frontend renders backend fields only.
CP-043 keeps return purchase policy in `src/services/returns.ts`: until a
dedicated return-account field exists, fresh return quotes and purchases use
the explicit DR PREPPER default ShipStation context, bypass display markups,
and persist only a redaction-safe failure summary to the return workflow.
CP-057 adds `return_label_purchase_intents` solely as a side-effect coordinator:
one row per return, one stable provider reference, and transient recovery
snapshots that are cleared after reconciliation. It never replaces the
canonical `shipments` label/tracking/rate/cost record. PS-423 adds renewable,
generation-fenced ownership: ambiguous outcomes remain held even when a
provider lookup returns 404, and only receipt reconciliation or an audited
operator no-effect resolution can advance the operation.
PS-435 adds a fail-closed call to PrepShip's canonical customer-shipping-money
owner before the provider mutation. Candidate provider facts stay server-to-server;
the adapter, return DTO, Billing, and UI receive only the customer-safe amount and
policy provenance. Missing policy renders an explicit pending state and creates no
label. Historical alias/tuple or Billing mismatches fail closed on customer reads
and remain read-only reconciliation findings.
Guards: `client-portal-returns-schema-guard.mjs` (CP-026),
`client-portal-returns-label-guard.mjs` (CP-027, test-only offline mock, no live
postage), `client-portal-returns-delivery-guard.mjs` (CP-028),
`client-portal-returns-ui-guard.mjs` (CP-029, carrier/service-free UI+API),
`client-portal-returns-receiving-guard.mjs` (CP-030/045, scoped evidence/media
writes plus operator-only inspection/lifecycle authority),
`client-portal-returns-cp043-guard.mjs` (fresh raw rate attempt, explicit account
policy, safe diagnostics, and recoverable failure state), and
`client-portal-returns-cp057-guard.mjs` (durable purchase ownership,
external-reference reconciliation, duplicate-postage fixtures, and live
runbook), and `ps-435-return-customer-rate-guard.ts` (pre-purchase pricing
fence, customer-safe response shape, and pending-state disclosure).

Return billing lines reuse that canonical return reference as their displayed
`orderNumber` (for example `2050-RETURN`) while retaining `shipmentId` for
per-label uniqueness. Inspection writes are available from both the receiving
queue and the clicked return drawer through one shared editor with explicit
operator/client modes. `clientPortalCapabilities.canInspectReturns` is the
backend owner for warehouse inspection authority. A scoped client may append a
pending notes/media evidence record only; client requests containing
`receivedAt`, `condition`, or inspection `status` fail closed, and client
submissions never advance `returns.status`. Operators alone record warehouse
receipt/condition/status and advance the return lifecycle. Client media may be
attached only to client evidence submissions; operator inspection media cannot
be altered through the client path. Media stays in the private returns storage
bucket. Images are limited to 15 MB and videos to 25 MB. Inspection/evidence
saves append rows rather than overwriting prior history. The return drawer
merges canonical lifecycle activity, inspection rows, and attachment metadata
for presentation; it never reconstructs carrier, rate, or billing truth.

### Inbound

| UI label | Frontend field | Backend DTO field | Canonical owner | Event clock | Classification |
| --- | --- | --- | --- | --- | --- |
| Reference / supplier / status | `reference`/`supplier`/`status` | same | `inbound_shipments` | inbound workflow | presentation-only |
| Carrier / tracking | `carrier`/`trackingNumber` | same | `inbound_shipments` (inbound carrier, not an outbound label) | inbound time | presentation-only |
| Expected units | `expectedUnits` | `expectedUnits` | Σ `inbound_items.expectedQty` (backend) | inbound time | derived-from-canonical (backend-owned) |
| Received units | `receivedUnits` | `receivedUnits` | Σ `inbound_items.receivedQty` (backend) | receiving | derived-from-canonical (backend-owned) |
| PrepShip received SKU / units | `sku`/`receivedUnits` | same | `inventory.sku` + `inventory_ledger.qty` where `type='receive'` | receipt movement | backend-owned-truth |
| PrepShip received date | `receivedAt` | `receivedAt` | `coalesce(inventory_ledger.effective_at, inventory_ledger.created_at)` | operator-entered receipt date, then persistence time | backend-owned-truth |

Owner: `toPortalInboundDto` over `inbound_shipments` + `inbound_items`. Route:
`src/routes/client-portal/inbound.ts`. Received inventory delegates to
`listPortalInboundReceipts` over the canonical inventory ledger; CP does not
copy receipts into inbound tables or infer multi-SKU batches.

The Client Portal Receive Inventory worksheet is available only to global admins
and scoped operators with `settings:write`. It requires an explicit client and
existing in-scope inventory IDs, records a critical portal audit before mutation,
then writes the entire batch atomically through the canonical `applyMovements`
stock-and-ledger owner. The browser never computes the resulting stock balance.

### Connections

| UI label | Frontend field | Backend DTO field | Canonical owner | Event clock | Classification |
| --- | --- | --- | --- | --- | --- |
| Provider / label | `provider`/`label` | `provider`/`label` | connector rows via `toPortalIntegrationDto` | now | presentation-only |
| Account identifier | `displayAccountIdentifier` | `displayAccountIdentifier` | backend mask of connector `account_identifier`; raw value never crosses the customer DTO | account configuration time | redacted-backend-truth |
| Connection status | `connectionStatus` | `connectionStatus` | `resolvePortalConnectionStatus`: pending from store source; reconnect from safe known error class; degraded from other sync error; otherwise canonical active flag | latest account/sync state | derived-from-canonical (backend-owned) |
| Reconnect guidance | `reconnectReasonCode` | `reconnectReasonCode` | backend mapping of detailed sync error to `authentication_required`, `permissions_required`, or `configuration_required` | latest failed sync | redacted-backend-truth |
| Last sync | `lastSyncedAt` | `lastSyncedAt` | tenant-scoped `store_accounts.last_synced_at` | latest successful store sync | backend-owned-truth |
| Top-bar connection freshness | `connectionStatus`/`lastSyncAt` | GET `/sync-status` | tenant-scoped store connection DTOs; aggregate precedence attention > active > pending > inactive > not connected; timestamp = max successful sync clock | latest account/sync state | derived-from-canonical (backend-owned) |
| Pending request | `connectionStatus='pending'` | POST `/integrations` then `toPortalIntegrationDto` | server-persisted request row (never client-only state) | request time | backend-owned-truth |

Owner: `toPortalIntegrationDto` + read-model `listPortalIntegrations`
(`read-models/integrations.ts`) over `carrier_accounts` +
`carrier_account_clients` + `store_accounts`. Route:
`src/routes/client-portal/integrations.ts`; freshness route:
`src/routes/client-portal/sync.ts`. Raw account identifiers, account source,
active flags, detailed sync errors, credentials/payloads, and global
worker/order/shipment diagnostics are backend-only. Customer JSON receives only
the masked display identifier, exhaustive status/safe reason enums, and
tenant-scoped freshness.

### Rate Sheet

| UI label | Frontend field | Backend DTO field | Canonical owner | Event clock | Classification |
| --- | --- | --- | --- | --- | --- |
| Contracted rates | (honest empty state) | — (no endpoint yet) | operator-managed rate sheet — **not yet a portal endpoint** | n/a | backend-owned-truth (absent) |

`portal-client/src/pages/Rates.tsx` is an **honest placeholder**: storage /
pick-pack / zone pricing is a contracted, operator-managed rate sheet with no
live `/api/client-portal/rate-sheet` endpoint yet. Rather than fabricate
numbers, the page shows an empty state and points to real billed charges in
Invoices — an exemplary application of the shadow-renderer law (it refuses to
invent source data). When the endpoint exists, it must be the canonical owner
and this row becomes a real mapping.

### DJ-approved exceptions

None. No Client Portal surface currently derives an authoritative business value
outside a database / PrepShip-backed canonical owner. Any future exception must
be recorded here with the DJ approval, the exact field, and the justification,
and must still document source inputs, event clock, and formula.

### CP remediation reference

- **CP-009 / CP-018** — carrier / service / provider / rate identity is
  hard-nulled in the order + shipment DTOs and dropped from the invoice-details
  SQL/DTO; the client shows tracking numbers, never carriers.
- **CP-010 / CP-049** — one canonical full-window sales-metrics owner (`getClientPortalSalesMetrics`)
  so Dashboard and Analysis revenue/units cannot drift.
- **CP-012** — Billing report charge breakdown / totals / billable count / avg
  per order are backend-owned (`/reports`), not React reductions.
- **CP-013** — inventory stock status (In/Low/Out) is a backend enum shared by
  the filter and the badge.
- **CP-014** — product line totals + subtotal are backend-owned money.
- **CP-017** — the order cost-summary receipt is a backend read-model that
  always reconciles to `orderTotal` to the cent.
- **CP-020** — Analysis Std/Exp columns pair the shipment COUNT with the SAME
  cost-gated filter as the quantity.
- **CP-021** — Dashboard KPIs/widgets are named after entity+table and are
  backend-owned; Top-SKUs reuses the canonical Analysis SKU query.
- **CP-022** — one canonical order-detail loader across every entry point.
- **CP-023** — inventory "sold" is warehouse ledger ships (`warehouseShipped30d`,
  ship date), not ordered units.
- **CP-024** — printable-invoice money totals are backend-owned; the Excel
  export stays carrier/service-free.
- **CP-026 → CP-031** — returns workflow/item/inspection/media tables own only
  workflow detail; label money + tracking stay on `shipments`; no portal-side
  rate-shopping; offline-mock labels only for test clients; operator-gated receiving.

