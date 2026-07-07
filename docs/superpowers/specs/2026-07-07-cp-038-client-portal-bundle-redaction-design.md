# CP-038 — Client Portal browser-bundle redaction (pass 1)

- **Date:** 2026-07-07
- **Ticket:** CP-038 (Trello DR PREPPER, card `lln41DjP`)
- **Status:** Design approved; pending spec review before implementation plan.
- **Baseline:** audit ran on `origin/main @ cddd549`; current worktree HEAD `375a9f8` (one commit later) — findings verified current.

## 1. Problem & threat model

A software-developer customer inspecting DevTools / network responses / **downloaded JS
chunks** of the Client Portal must see **no admin-only cost / rate / markup concepts**.

Key premise: **frontend route guards are not a secrecy boundary.** Lazy-loaded chunks are
downloadable regardless of the route gate, so "the page redirects non-admins" does not keep
its code or DTO names out of a determined client's hands. Server-side RBAC is necessary but
not sufficient: if a concept is admin-only, it should not ship in the customer bundle or in
client-facing DTO names.

## 2. What we found (the reframe)

The backend DTO layer **already passes** the source-of-truth / redaction guards
(CP-009 carrier redaction, CP-018 selected-rate, CP-025 shadow-renderer). Every client-facing
cost-like **value** is already intent-named and canonically sourced. CP-038 is therefore **not**
DTO surgery. The remaining work splits into four distinct piles:

1. **One genuine leak (not cosmetic):** the client Analysis/Dashboard shipping analytics
   **re-derive the customer shipping rate inline from the markup ("profit layer") settings** —
   `base_cost * (1 + markup)` computed inside the analytics query (the `ls` / `marked_cost` lateral
   in `src/routes/analysis.ts:858-887` and `src/services/sku-orders.ts:154-183, 277-306`), where
   `base_cost` is the house carrier cost and `markup` is read live from `settings`
   `markup.<carrier>` / `markup.<pid>`. Two consequences: (a) it is a **parallel re-derivation** of
   the customer shipping rate — a shadow-renderer / SOT violation, since the canonical owner is the
   frozen `billing_line_items` shipping line, not an inline markup recompute that can drift; and
   (b) where a carrier/pid has **no markup configured** it falls through to raw house `base_cost`,
   i.e. raw carrier cost shown to the client. Surfaces:
   - Dashboard "Avg Shipping Price" + a tooltip rendering the literal math
     `shipAlloc ÷ shipUnits = avgShippingPrice` (`getSkuBreakdownFromOrderItems`).
   - Analysis SKU-table avg + the SKU **detail drawer** "Avg ship cost" stat and per-order
     `standard_shipping_cost` chips (`getSkuBreakdownFromOrderItems` + `getSkuOrdersForSku`).
2. **Optics only:** cost-y **keys/labels** whose values are already correct/gated
   (`shippingCost` key, "Box Cost", "Cost summary", "Avg. cost / order").
3. **Markups admin UI:** already `RequireAdmin` **and** code-split into the lazy `Settings`
   chunk (not in the main bundle) — but the chunk is downloadable. Relocation is out of scope
   for this pass (see §8).
4. **No enforcement:** no guard scans the built bundle; `scripts/run-guards.mjs` deliberately
   DENYs build-dependent guards from the static suite.

## 3. Scope (this pass)

**IN (portal-only, no cross-repo):**
- (C) new build-bundle redaction guard — the enforcement linchpin.
- (A) real leak fix — re-source the client avg-shipping metric to the customer's billed charge.
- (B) safe optics renames — key/label only, values unchanged.

**OUT (tracked follow-ups, §8):**
- Relocating the Markups admin UI out of the customer bundle (needs prepship-v4 / admin-only build).
- Renaming the *blessed* DTO keys `costSummary` / `avgCostPerOrder`.

## 4. Design

### A. Re-source avg-shipping to the customer's billed charge (parameterized canonical owner)

**Two** shared helpers re-derive customer shipping inline from markup settings and must be
re-sourced: `getSkuBreakdownFromOrderItems` (`src/routes/analysis.ts:813`) and `getSkuOrdersForSku`
(`src/services/sku-orders.ts:59`). Both are also consumed by the base/legacy-web analytics
(`src/routes/analysis.ts:1055`, `src/routes/dashboard.ts:485`, and the operator Inventory drawer),
which keep the current inline-markup basis. So we **parameterize** each rather than swap the basis
globally.

- Add `shippingBasis: 'house_markup' | 'customer_billed'` to `SkuBreakdownQuery` **and**
  `SkuOrdersInput`, defaulting to `'house_markup'` (the current inline `base_cost × (1+markup)`
  behaviour). The default keeps every existing operator/legacy consumer byte-for-byte unchanged.
- For `'customer_billed'`, the per-order shipping amount (the SQL column currently aliased
  `label_cost` / `marked_cost`) becomes the client's **billed shipping**:
  `coalesce((select sum(b.total_cost) from billing_line_items b where b.order_id = o.id and
  b.line_type = 'shipping'), 0)` — the same canonical billed-shipping owner the Orders list already
  uses for `billedShipping` (`src/lib/client-portal/read-models/orders.ts:47-51`). The rest of the
  allocation (`× qty / order_qty_total`, std/exp classification, `is_external`) is unchanged, so
  only the amount source changes.
- Client-portal consumers pass `'customer_billed'`:
  - `src/routes/client-portal/analysis.ts:23` (SKU table, via `getSkuBreakdownFromOrderItems`)
  - `src/lib/client-portal/read-models/dashboard.ts:56` (Dashboard Top-SKUs)
  - `src/routes/client-portal/analysis.ts:99` (SKU detail drawer, via `getSkuOrdersForSku`)
- **Client boundary key renames** (drawer): the `/analysis/sku-orders` boundary remap
  (`src/routes/client-portal/analysis.ts:113-116`, which already nulls carrier/service) also
  renames `standard_shipping_cost` → `shippingCharge`, `avgStandardShippingCost` →
  `avgShippingCharge`, and drops the redundant `shipping_cost` / `shipping_total` /
  `standard_shipping_total` from the client payload — so no cost-named key reaches the bundle and
  the shared `SkuOrderRow` type stays intact for the operator/legacy consumer.
- `canViewFinancials` redaction is unchanged — both helpers still zero/null shipping and revenue
  for callers without money access.

**Frontend consequences:**
- `portal-client/src/pages/Dashboard.tsx:211` — remove the `shipAlloc ÷ shipUnits =` tooltip math;
  keep the `avgShippingPrice` value. Column header "Avg Shipping Price" stays (now truthful as a
  charge).
- `DashboardTopSkuRow` (`dashboard.ts:38-43`) — drop `shipAlloc` / `shipUnits` from the DTO, and
  from the `portal-client/src/lib/api.ts` type and the Dashboard usage.
- `portal-client/src/pages/Analysis.tsx:283` — relabel "Avg ship cost" → "Avg shipping charge";
  the value re-sources via the same basis and the client key `avgStandardShippingCost` →
  `avgShippingCharge`. The per-order `standard_shipping_cost` chip (`Analysis.tsx:321-322`)
  re-sources to billed shipping; the client-facing per-order DTO key is renamed
  `standard_shipping_cost` → `shippingCharge` at the client-portal analysis boundary (the same
  `/analysis/sku-orders` boundary that already strips carrier/service per CP-009), so the internal
  key never reaches the bundle.

**Data note (intended behaviour):** billed shipping can lag `label_cost` — an order shipped
with a house cost but not yet billed has no billed shipping line. The metric therefore reflects
**billed** orders only; the denominator is "units carrying a billed shipping charge," and a SKU
with no billed shipping renders "—" (identical to today's "no charge" behaviour). This mirrors the
Orders list, which already reads billed shipping.

### B. Safe optics renames (values unchanged; already gated/canonical)

| Surface | From | To | Files |
|---|---|---|---|
| Shipments | DTO key `shippingCost` | `customerShippingRate` | `src/lib/client-portal/dto.ts:354` (+ producer `customer-shipping-rate.ts`), `portal-client/src/lib/api.ts:236`, `Shipments.tsx:124` |
| Billing | label "Box Cost" | "Box Charge" | `portal-client/src/pages/Invoices.tsx:270,399` |
| Finance | label "Avg. cost / order" | "Avg. charge / order" | `portal-client/src/pages/Finance.tsx:47` |
| OrderDetail | label "Cost summary" | "Order charges" | `portal-client/src/components/OrderDetailPanel.tsx:77` |

The Shipments label is already "Customer Shipping Rate"; only the key changes. The DTO keys
`costSummary` and `avgCostPerOrder` are **kept** — `costSummary` is a blessed intent-named field in
the CP-025 SOT matrix, and renaming either would churn the matrix + CP-025 guard for no value
change. Only their visible UI labels change.

### C. Build-bundle redaction guard (enforcement linchpin)

New `scripts/client-portal-bundle-redaction-guard.mjs`:
- Runs **after** `npm --prefix portal-client run build`; reads `portal-client/dist/assets/*.js`
  and FAILs if any forbidden term appears **outside allowlisted chunks**.
- **Forbidden terms** (house/internal vocabulary, curated to avoid false positives on legitimate
  client terms like `customerShippingRate`, `shippingCharge`, `billedShipping`):
  `label_cost`, `labelCost`, `selectedRate`, `selected_rate`, `standard_shipping_cost`,
  `shipAlloc`, `shipUnits`. Deliberately **not** the bare words `margin` or `profit`: `margin`
  ships as a Recharts chart-prop key (`margin={{ top: 8, ... }}`) in the compiled JS and would
  false-positive, and house markup / "profit layer" vocabulary lives only in the allowlisted admin
  `Settings-*.js` chunk. Terms are matched as literal substrings.
- **Allowlist:** the admin `Settings-*.js` chunk may contain markup vocabulary
  (`markup`, `profit layer`, `carrierCode`) — it is admin-gated and its relocation is the tracked
  follow-up (§8). The allowlist is by chunk-filename prefix and is documented with a reference to
  that follow-up so it can be tightened later.
- **Wiring:** build-dependent, so it does **not** join the static `run-guards` suite (which DENYs
  build-dependent guards). Add a `test:client-portal-bundle-redaction` script and invoke it from
  the `test:full-site-certification` chain (which already runs `build:web`) and CI's build job.
- The guard is expected to be **red until A + B land** (red → green).

## 5. File change list (summary)

- **Backend:** `src/routes/analysis.ts` (`shippingBasis` on `SkuBreakdownQuery` + billed-shipping
  branch in `getSkuBreakdownFromOrderItems`), `src/services/sku-orders.ts` (`shippingBasis` on
  `SkuOrdersInput` + billed-shipping branch in both inner queries),
  `src/routes/client-portal/analysis.ts` (pass `customer_billed` to both helpers + drawer boundary
  key renames), `src/lib/client-portal/read-models/dashboard.ts` (pass `customer_billed`; drop
  `shipAlloc`/`shipUnits` from `DashboardTopSkuRow`), `src/lib/client-portal/dto.ts`
  (`shippingCost` → `customerShippingRate`).
- **Frontend:** `portal-client/src/lib/api.ts` (Shipment key; drop `shipAlloc`/`shipUnits`),
  `pages/Dashboard.tsx`, `pages/Analysis.tsx`, `pages/Finance.tsx`, `pages/Invoices.tsx`,
  `components/OrderDetailPanel.tsx`, `pages/Shipments.tsx`.
- **Guard/tooling:** `scripts/client-portal-bundle-redaction-guard.mjs`, `package.json`
  (script + `full-site-certification` wiring).

## 6. Verification

- `npm run typecheck` (root + portal-client).
- `npm --prefix portal-client run build`.
- `node scripts/client-portal-bundle-redaction-guard.mjs` → green.
- Re-run unchanged guards to confirm no SOT regression:
  `test:client-portal-returns-canonical-fields`, `test:client-portal-orders-selected-rate`,
  `test:client-portal-datatable-customization-rbac`, `test:client-portal-carrier-redaction`,
  `test:client-portal-shadow-renderer`.
- `test:client-portal-analytics-parity` — confirm the client Dashboard and Analysis Top-SKUs stay
  in numeric parity under the `customer_billed` basis (both client consumers pass the same basis).
- Manual/DOM: Dashboard avg-shipping shows the billed charge with no allocation-math tooltip;
  Analysis relabeled; a client-scope build contains none of the forbidden terms.

## 7. Safety / constraints

- **No production billing regeneration.** `billing_line_items` is read-only here; the admin app
  (prepship-v4) owns billing writes.
- **Shadow-renderer law preserved:** a single canonical SKU owner, parameterized — not duplicated
  — so admin (house cost) and client (billed charge) remain two projections of one query.
- Admin/legacy analytics remain on the default `house_label_cost` basis, unchanged.
- TypeScript strict; Tailwind-first; theme tokens (no hardcoded hex).

## 8. Follow-ups (tracked separately)

- **CP-038b — Markups relocation:** move the Markups admin UI out of the customer bundle
  (relocate to prepship-v4 or an admin-only build entry). Once done, tighten the bundle-redaction
  guard to drop the `Settings-*.js` allowlist.
- **Optional key de-cost-ification:** rename the blessed DTO keys `costSummary` → `chargeSummary`
  and `avgCostPerOrder` → `avgChargePerOrder`, updating the CP-025 SOT matrix + guard to match.
