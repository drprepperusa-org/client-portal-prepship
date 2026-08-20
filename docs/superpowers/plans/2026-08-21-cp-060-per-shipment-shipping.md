# CP-060 Per-Shipment Shipping Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The SKU drawer classifies each non-voided label's billed shipping to its own standard/expedited class instead of classifying the whole order by the newest label.

**Architecture:** One shared classification module feeds both the analysis route and the sku-orders read model. The read model replaces the newest-label lateral with a per-shipment aggregate joining `billing_line_items.shipment_id`, emits per-class money plus an explicit money state, and the route DTO / frontend render it verbatim.

**Tech Stack:** Hono + drizzle raw SQL (postgres-js), React (portal-client), tsx test scripts, static guard scripts.

## Global Constraints

- Drawer-only: the Analysis TABLE keeps zero shipping fields; `scripts/client-portal-analysis-ship-bucket-guard.mjs` must remain untouched and passing.
- No carrier/service/provider identity crosses the client boundary — class labels only (`standard` / `expedited`).
- The expedited list contents must stay byte-identical to prepship-v4 `REPORTING_EXPEDITED_SERVICES` (13 entries, listed in Task 1).
- Money that cannot be attributed to a label is NEVER given a class; it surfaces via `shippingMoneyState`.
- `npm run typecheck` (root, strict) and `npm --prefix portal-client run typecheck` must pass after every task.
- TypeScript strict mode; TDD adaptation: the DB-backed integration suite only runs in CI (no local Postgres) — write it first anyway; local red/green loop uses the static guard + dto-runtime scripts.

---

### Task 1: Shared classification module

**Files:**
- Create: `src/lib/shipping-class.ts`
- Modify: `src/routes/analysis.ts:11-27` (delete local list, import from lib, keep re-export)
- Modify: `src/services/sku-orders.ts:15` (import path)

**Interfaces:**
- Produces: `EXPEDITED_SERVICES: readonly string[]`, `EXPEDITED_SERVICES_SQL: SQL` (drizzle fragment `ARRAY[...]::text[]`), consumed by Tasks 2 and 5.

- [ ] **Step 1: Create the module**

```ts
// src/lib/shipping-class.ts
// Single source of truth for standard-vs-expedited service classification in
// the Client Portal. Mirrors prepship-v4 REPORTING_EXPEDITED_SERVICES
// (src/services/reporting-projection.ts, PS-418) — the canonical upstream
// owner. If that list changes, this one must change with it; the CP-060 guard
// pins the contents so drift is loud.
import { sql } from 'drizzle-orm';

export const EXPEDITED_SERVICES = [
  'ups_2nd_day_air', 'ups_2nd_day_air_am',
  'ups_next_day_air', 'ups_next_day_air_saver', 'ups_next_day_air_early_am',
  'ups_3_day_select',
  'usps_priority_mail_express',
  'fedex_2day', 'fedex_2day_am',
  'fedex_express_saver',
  'fedex_priority_overnight', 'fedex_standard_overnight', 'fedex_first_overnight',
] as const;

export const EXPEDITED_SERVICES_SQL = sql`ARRAY[${sql.join(
  EXPEDITED_SERVICES.map((s) => sql`${s}`),
  sql`, `
)}]::text[]`;
```

- [ ] **Step 2: Rewire routes/analysis.ts** — delete its local `const EXPEDITED_SERVICES = [...]` and `export const EXPEDITED_SERVICES_SQL = ...`; add `import { EXPEDITED_SERVICES_SQL } from '../lib/shipping-class';` and `export { EXPEDITED_SERVICES_SQL } from '../lib/shipping-class';` (re-export keeps any other importer alive). Keep the v2-parity comment, moving it to the new module.

- [ ] **Step 3: Rewire sku-orders.ts** — change `import { EXPEDITED_SERVICES_SQL } from '../routes/analysis';` to `from '../lib/shipping-class';`.

- [ ] **Step 4: Verify** — `npm run typecheck` passes; `grep -rn "EXPEDITED_SERVICES = \[" src/` shows exactly one definition (the lib).

- [ ] **Step 5: Commit** — `git commit -m "CP-060: single-source the expedited service list"`

---

### Task 2: Read-model rewrite (write the CI integration test first)

**Files:**
- Create: `scripts/integration/client-portal-analysis-cp060.integration.ts`
- Modify: `src/services/sku-orders.ts` (both queries + result types)

**Interfaces:**
- Produces (service result, consumed by Task 3):

```ts
export type ShippingMoneyState =
  | 'attributed' | 'partial_unattributed' | 'unattributed_legacy'
  | 'unbilled' | 'external_label' | 'voided_only';

export type SkuOrderRow = {
  order_id: number; order_number: string; order_date: string | null;
  order_status: string; ship_to_name: string | null;
  carrier_code: string | null; service_code: string | null;
  qty: number; unit_price: string | null; item_name: string | null;
  shipping_cost: string | null;          // SKU per-unit share of total billed
  shipping_total: string | null;         // SKU share of total billed shipping
  shipping_standard: string | null;      // SKU share of std-attributed money
  shipping_expedited: string | null;     // SKU share of exp-attributed money
  shipping_money_state: ShippingMoneyState;
  is_external_shipped: boolean;
};

export type SkuOrdersResult = {
  sku: string; name: string | null; clientId: number | null; totalUnits: number;
  shipCountStandard: number; shipCountExpedited: number;
  shippingStandardTotal: string; shippingExpeditedTotal: string;
  avgShippingStandard: string; avgShippingExpedited: string;
  dailySales: Array<{ day: string; units: number }>;
  orders: SkuOrderRow[];
};
```

- [ ] **Step 1: Write the integration test** (model the harness on `scripts/integration/client-portal-returns-cp058-routes.integration.ts` — same TEST_DATABASE_URL refusal, schema bootstrap, scenario runner). Scenarios, each asserting through `getSkuOrdersForSku({ shippingBasis: 'customer_billed', ... })`:
  1. **Mixed multi-label:** order with 2 labels — std service billed $5 (line has `shipment_id` A), exp service billed $20 (line has `shipment_id` B) → row: `shipping_total 25`, `shipping_standard 5`, `shipping_expedited 20`, state `attributed`; summary counts 1 std + 1 exp order, `avgShippingStandard` uses only $5.
  2. **Single-label std / single-label exp:** totals equal today's behavior; exp order's money now APPEARS (`shipping_expedited` set, state `attributed`).
  3. **Voided-newest trap:** labels [std older, exp newer voided] → exp label excluded, money attributed to std only; nothing classified by the voided label.
  4. **External:** shipped order, zero shipment rows → state `external_label`, all money fields null.
  5. **Unbilled:** non-voided label, zero shipping lines → state `unbilled`.
  6. **Legacy null:** billed line with `shipment_id` NULL only → state `unattributed_legacy`, `shipping_total` set, std/exp null, order excluded from both averages.
  7. **Partial:** one attributed line + one NULL line → state `partial_unattributed`, std/exp cover only the attributed part, `shipping_total` covers all.
  8. **Tenant scope:** `orderScopeSql` for client A hides client B's orders entirely.
  9. **Redaction:** `canViewFinancials: false` nulls all five money fields but keeps `shipping_money_state`.

- [ ] **Step 2: Register it** — package.json: `"test:client-portal-analysis-cp060:integration": "tsx scripts/integration/client-portal-analysis-cp060.integration.ts"`, and add the file to `.github/workflows/integration-tests.yml` after the cp058 line.

- [ ] **Step 3: Rewrite both queries in sku-orders.ts.** Replace the `left join lateral (...) order by s.id desc limit 1) ls on true` block (both queries) with per-order aggregates:

```sql
left join lateral (
  select
    count(*)::int                                                as active_label_count,
    max(s.service_code)                                          as service_code,
    sum(case when cls.is_exp then lbl.amount else 0 end)::numeric        as exp_billed,
    sum(case when not cls.is_exp then lbl.amount else 0 end)::numeric    as std_billed,
    sum(coalesce(lbl.amount, 0))::numeric                        as attributed_billed,
    sum(case when cls.is_exp then lbl.house_amount else 0 end)::numeric  as exp_house,
    sum(case when not cls.is_exp then lbl.house_amount else 0 end)::numeric as std_house,
    sum(coalesce(lbl.house_amount, 0))::numeric                  as house_billed
  from shipments s
  left join lateral (
    select sum(b.total_cost)::numeric as amount
    from billing_line_items b
    where b.shipment_id = s.id and b.line_type = 'shipping'
  ) billed on true
  left join settings pid_markup
    on pid_markup.key = 'markup.' || coalesce(s.provider_account_id, s.label_provider, s.selected_pid)::text
  left join settings carrier_markup
    on carrier_markup.key in ('markup.' || s.carrier_code, 'markup.' || lower(s.carrier_code))
  cross join lateral (
    select
      (coalesce(s.cost, s.label_cost, 0) + coalesce(s.other_cost, 0))::numeric as base_cost,
      case when coalesce(pid_markup.value, carrier_markup.value) ~ '^\\s*\\{'
        then coalesce(pid_markup.value, carrier_markup.value)::jsonb
        else null::jsonb end as markup
  ) cost_model
  cross join lateral (
    select billed.amount as amount,
      case
        when lower(cost_model.markup->>'type') in ('pct', 'percent')
          then cost_model.base_cost * (1 + coalesce(nullif(cost_model.markup->>'value', '')::numeric, 0) / 100)
        when lower(cost_model.markup->>'type') in ('amount', 'flat')
          then cost_model.base_cost + coalesce(nullif(cost_model.markup->>'value', '')::numeric, 0)
        else cost_model.base_cost
      end as house_amount
  ) lbl
  cross join lateral (
    select lower(coalesce(s.service_code, '')) = ANY(${EXPEDITED_SERVICES_SQL}) as is_exp
  ) cls
  where s.order_id = o.id and coalesce(s.voided, false) = false
) labels on true
left join lateral (
  select
    coalesce(sum(b.total_cost), 0)::numeric                                   as order_billed,
    coalesce(sum(b.total_cost) filter (where b.shipment_id is null), 0)::numeric as unattributed_amount,
    count(*) filter (where b.shipment_id is null)::int                        as unattributed_lines
  from billing_line_items b
  where b.order_id = o.id and b.line_type = 'shipping'
) ob on true
cross join lateral (
  select exists (select 1 from shipments s2 where s2.order_id = o.id) as has_any_shipment
) sh
```

Basis switch: for `customer_billed`, `money_total = ob.order_billed`, `money_std = labels.std_billed`, `money_exp = labels.exp_billed`, `money_attributed = labels.attributed_billed`, `money_unattr_lines = ob.unattributed_lines`; for `house_markup`, `money_total = labels.house_billed`, `money_std = labels.std_house`, `money_exp = labels.exp_house`, `money_attributed = labels.house_billed`, `money_unattr_lines = 0`. Keep passing them as columns from `item_rows` (e.g. `label_cost` becomes `money_total` etc.) so the aggregation CTEs stay shape-identical.

State (in `allocated`):

```sql
case
  when coalesce(labels.active_label_count, 0) = 0 and not sh.has_any_shipment
       and r.order_status = 'shipped' then 'external_label'
  when coalesce(labels.active_label_count, 0) = 0 and sh.has_any_shipment then 'voided_only'
  when money_total <= 0 then 'unbilled'
  when money_unattr_lines = 0 then 'attributed'
  when money_attributed > 0 then 'partial_unattributed'
  else 'unattributed_legacy'
end as shipping_money_state
```

Row selects: `shipping_cost = money_total / order_qty_total`, `shipping_total = money_total * qty / order_qty_total`, `shipping_standard = money_std * qty / order_qty_total` (null unless state in ('attributed','partial_unattributed') and money_std > 0), same for expedited. `is_external_shipped = (shipping_money_state = 'external_label') or externally_shipped_flag`. Summary select replaces the three std-only aggregates with per-class: counts of orders with class money > 0 and state permitting, class totals `sum(money_std * qty / order_qty_total)`, per-unit averages `class_total / class_qty`.

- [ ] **Step 4: Update result assembly** — new `SkuOrdersResult` fields; `canViewFinancials: false` nulls `shipping_cost`, `shipping_total`, `shipping_standard`, `shipping_expedited` (keep `shipping_money_state`) and zeroes the summary.

- [ ] **Step 5: Verify locally** — `npm run typecheck` passes; `npx tsx scripts/integration/client-portal-analysis-cp060.integration.ts` exits 2 with the no-TEST_DATABASE_URL refusal (harness alive, suite deferred to CI).

- [ ] **Step 6: Commit** — `git commit -m "CP-060: classify billed shipping per shipment in the SKU drawer read model"`

---

### Task 3: Contracts, route DTO, dto-runtime

**Files:**
- Modify: `src/lib/client-portal/contracts/analysis.ts:39-59`
- Modify: `src/routes/client-portal/analysis.ts:53-79`
- Modify: `scripts/client-portal-analysis-sku-orders-dto-runtime.ts` (extend whitelist assertions — read its existing pattern first and follow it)

**Interfaces:**
- Produces (client contract, consumed by Task 4):

```ts
export type ShippingMoneyState =
  | 'attributed' | 'partial_unattributed' | 'unattributed_legacy'
  | 'unbilled' | 'external_label' | 'voided_only';

export interface SkuOrderRow {
  order_id: number; order_number: string; order_date: string | null;
  order_status: string; ship_to_name: string | null; qty: number;
  unit_price: string | null; item_name: string | null;
  shippingTotal: string | null;
  shippingStandard: string | null;
  shippingExpedited: string | null;
  shippingMoneyState: ShippingMoneyState;
}

export interface SkuOrdersResult {
  sku: string; name: string | null; totalUnits: number;
  avgShippingStandard: string;
  avgShippingExpedited: string;
  averageUnitsPerDay: number;
  dailySales: Array<{ day: string; units: number }>;
  orders: SkuOrderRow[];
}
```

- [ ] **Step 1:** Update the contract exactly as above — `shippingCharge` and `avgShippingCharge` are DELETED (they were std-only money under generic names; that is the live expedited-vanishes bug).
- [ ] **Step 2:** Update `toClientAnalysisSkuOrderDto` / `toClientAnalysisSkuOrdersDto` to map the new service fields 1:1 (`shippingTotal: order.shipping_total`, `shippingStandard: order.shipping_standard`, `shippingExpedited: order.shipping_expedited`, `shippingMoneyState: order.shipping_money_state`, `avgShippingStandard: result.avgShippingStandard`, `avgShippingExpedited: result.avgShippingExpedited`). No other fields added — `carrier_code`/`service_code` still never cross.
- [ ] **Step 3:** Extend the dto-runtime script: assert the per-order whitelist is exactly the contract keys above (fails on `service_code` leak AND on a missing `shippingMoneyState`), and the top-level whitelist likewise.
- [ ] **Step 4:** Run `npx tsx scripts/client-portal-analysis-sku-orders-dto-runtime.ts` → passes. `npm run typecheck` → portal-client compile now FAILS (Analysis.tsx uses deleted fields) — expected red handed to Task 4.
- [ ] **Step 5:** Commit — `git commit -m "CP-060: per-class shipping money in the sku-orders DTO, retire std-only generic fields"`

---

### Task 4: Frontend drawer

**Files:**
- Modify: `portal-client/src/pages/Analysis.tsx:314` (stat tiles), `:380-382` (order row money)

- [ ] **Step 1:** Stats grid — replace the single `Avg shipping charge` tile:

```tsx
<SkuStat label="Avg std shipping" value={money(Number(data?.avgShippingStandard ?? 0))} />
<SkuStat label="Avg expedited" value={money(Number(data?.avgShippingExpedited ?? 0))} />
```

- [ ] **Step 2:** Order row — total plus split/state:

```tsx
{o.shippingTotal && Number(o.shippingTotal) > 0 ? (
  <span className="shrink-0 text-right">
    <span className="tnum text-xs font-medium text-ink-2">{money(Number(o.shippingTotal))}</span>
    {Number(o.shippingStandard ?? 0) > 0 && Number(o.shippingExpedited ?? 0) > 0 && (
      <span className="block tnum text-[10px] text-ink-3">
        std {money(Number(o.shippingStandard))} · exp {money(Number(o.shippingExpedited))}
      </span>
    )}
  </span>
) : (
  SHIPPING_STATE_LABELS[o.shippingMoneyState] && (
    <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-3">
      {SHIPPING_STATE_LABELS[o.shippingMoneyState]}
    </span>
  )
)}
```

with, above the component:

```tsx
const SHIPPING_STATE_LABELS: Partial<Record<string, string>> = {
  unbilled: 'unbilled',
  external_label: 'external label',
  voided_only: 'label voided',
  unattributed_legacy: 'legacy billing',
};
```

(`attributed`/`partial_unattributed` with zero total render nothing, same as today.)
- [ ] **Step 3:** `npm --prefix portal-client run typecheck` passes; `npm run build:web` passes.
- [ ] **Step 4:** Commit — `git commit -m "CP-060: drawer renders total plus std/exp split and explicit money states"`

---

### Task 5: Static guard

**Files:**
- Create: `scripts/client-portal-analysis-cp060-guard.mjs`
- Modify: `package.json` (register `"test:client-portal-analysis-cp060": "node scripts/client-portal-analysis-cp060-guard.mjs"`)

- [ ] **Step 1:** Write the guard (follow the assert/report pattern of `client-portal-analysis-ship-bucket-guard.mjs`). Assertions, each reading file text with comments stripped:
  1. `src/lib/shipping-class.ts` contains all 13 expected service strings and no others between the array brackets (hardcode the 13 in the guard).
  2. Exactly one `EXPEDITED_SERVICES = [` definition across `src/` (the lib).
  3. `src/services/sku-orders.ts` imports `EXPEDITED_SERVICES_SQL` from `../lib/shipping-class` and does NOT contain `order by s.id desc` (the retired newest-label classifier).
  4. `src/routes/analysis.ts` imports from `./../lib/shipping-class` (either import or re-export form).
  5. `src/lib/client-portal/contracts/analysis.ts` contains `shippingMoneyState`, `shippingStandard`, `shippingExpedited`, `avgShippingStandard`, `avgShippingExpedited` and does NOT contain `shippingCharge`.
  6. `src/routes/client-portal/analysis.ts` maps `shipping_money_state` and does not reference `standard_shipping_cost`.
- [ ] **Step 2:** Mutation-check it: temporarily restore `order by s.id desc\n limit 1` text in sku-orders (scratch edit), run guard → must FAIL; revert.
- [ ] **Step 3:** `npm run test:client-portal-analysis-cp060` passes on the real tree; `npm run test:guards` all green (auto-discovers the new script).
- [ ] **Step 4:** Commit — `git commit -m "CP-060: guard pins single-source classification and the per-shipment read model"`

---

### Task 6: Full verification sweep

- [ ] **Step 1:** `npm run typecheck` && `npm --prefix portal-client run typecheck` && `npm run build:web` — all pass.
- [ ] **Step 2:** `npm run test:guards` — all pass, count increased by 1.
- [ ] **Step 3:** `npx tsx scripts/client-portal-analysis-sku-orders-dto-runtime.ts` and the ship-bucket guard individually — pass, proving the Analysis-table contract is untouched.
- [ ] **Step 4:** Push branch, open PR (base main) — CI runs the cp060 integration suite against throwaway Postgres; confirm green before merge. PR body names canonical owner (read model + shared classification module), callers that delegate, and the boundary tests, per PS-336.
