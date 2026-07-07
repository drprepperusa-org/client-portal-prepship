# CP-038 Client-Portal Bundle Redaction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the Client Portal browser bundle exposes no admin-only shipping-cost concepts — re-source the Analysis/Dashboard shipping analytics from an inline markup re-derivation to the canonical billed shipping, apply safe key/label renames, and add a build-bundle redaction guard to keep it that way.

**Architecture:** Two shared analytics helpers (`getSkuBreakdownFromOrderItems`, `getSkuOrdersForSku`) currently compute shipping as `base_cost × (1 + markup)` inline from the `settings` markup config. We parameterize each with `shippingBasis` (default `house_markup` = unchanged for operator/legacy; client passes `customer_billed`, which sums `billing_line_items` shipping lines). The client-portal boundary renames the drawer keys, the frontend drops the internal allocation tooltip and relabels, and a new build-dependent guard greps the compiled bundle.

**Tech Stack:** TypeScript (strict), Hono + Drizzle (raw `sql` templates) on the backend, Vite + React + Tailwind in `portal-client/`, Node `.mjs` static guard scripts.

## Global Constraints

- TypeScript strict mode: all code must pass `npm run typecheck` (root) and portal-client typecheck.
- **No production billing regeneration.** `billing_line_items` is read-only in this repo; the admin app (prepship-v4) owns billing writes.
- **Shadow-renderer law:** the client derives shipping from the ONE canonical owner (`billing_line_items` shipping line via a parameter), never a duplicated re-derivation. Operator/legacy consumers stay on the default basis.
- Tailwind-first; theme tokens only (no hardcoded hex) for any UI touch.
- Do not push (local commits only) unless explicitly told.
- Static guards must be clean-worktree-safe and CRLF-tolerant (use flexible regexes, not byte-exact matches).
- The bundle-redaction guard is **build-dependent** — it must NOT be added to the static `run-guards` suite (which excludes build-dependent guards); it runs after `build:web`.
- Default `shippingBasis` string value is exactly `'house_markup'`; the client opt-in value is exactly `'customer_billed'`.

---

### Task 0: Worktree prerequisites (build works)

**Files:**
- Modify: none (environment only)

**Interfaces:**
- Produces: a worktree where `npm --prefix portal-client run build` succeeds — required by Tasks 1 and 8.

- [ ] **Step 1: Ensure `.env` is present**

Run: `test -f .env && echo present || cp ../../../.env .env`
(The repo `.env` lives in the main checkout at the repo root; it is gitignored, so copying it in does not change the diff.)

- [ ] **Step 2: Install root + portal-client dependencies**

```bash
npm install
npm --prefix portal-client install
```

- [ ] **Step 3: Verify the portal-client build succeeds**

Run: `npm --prefix portal-client run build`
Expected: build completes; `portal-client/dist/assets/*.js` exist.

- [ ] **Step 4: No commit** (environment only — nothing to commit).

---

### Task 1: Build-bundle redaction guard (acceptance test — starts RED)

**Files:**
- Create: `scripts/client-portal-bundle-redaction-guard.mjs`
- Modify: `package.json` (add `test:client-portal-bundle-redaction` script)

**Interfaces:**
- Produces: `scripts/client-portal-bundle-redaction-guard.mjs` — scans `portal-client/dist/assets/*.js`, exits non-zero if any forbidden term appears outside the allowlisted admin `Settings-*.js` chunk. Consumed by Task 8 (wired into `test:full-site-certification`).

- [ ] **Step 1: Write the guard**

Create `scripts/client-portal-bundle-redaction-guard.mjs`:

```js
// CP-038 — client-portal built-bundle redaction guard.
//
// Frontend route guards are NOT a secrecy boundary — a client can download any lazy
// chunk — so this asserts the COMPILED output, not source. After
// `npm --prefix portal-client run build`, it scans portal-client/dist/assets/*.js and
// FAILs if admin/internal house-cost vocabulary appears in a client-loadable chunk.
//
// BUILD-DEPENDENT: intentionally NOT in the static run-guards suite (which excludes
// build-dependent guards). Runs after build:web in test:full-site-certification + CI.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const assetsDir = path.join(root, 'portal-client/dist/assets');

// Specific house/internal tokens only. Deliberately NOT bare `margin`/`profit`:
// `margin` ships as a Recharts chart-prop key in the compiled JS, and markup /
// "profit layer" vocabulary lives only in the allowlisted admin Settings chunk.
const FORBIDDEN = [
  'label_cost',
  'labelCost',
  'selectedRate',
  'selected_rate',
  'standard_shipping_cost',
  'shipAlloc',
  'shipUnits',
];

// Chunks allowed to contain admin vocabulary. The Markups admin UI is RequireAdmin-gated
// and code-split; relocating it out of the customer bundle is the tracked follow-up
// (CP-038b). Until then its chunk is allowlisted by filename prefix.
const ALLOWLIST_PREFIXES = ['Settings-'];
const isAllowlisted = (file) => ALLOWLIST_PREFIXES.some((p) => file.startsWith(p));

if (!fs.existsSync(assetsDir)) {
  console.error(`FAIL bundle-redaction: ${assetsDir} not found — run \`npm --prefix portal-client run build\` first.`);
  process.exit(1);
}
const jsFiles = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
if (jsFiles.length === 0) {
  console.error('FAIL bundle-redaction: no JS assets in the build output.');
  process.exit(1);
}

let failed = false;
for (const file of jsFiles) {
  if (isAllowlisted(file)) {
    console.log(`skip  ${file} (allowlisted admin chunk)`);
    continue;
  }
  const text = fs.readFileSync(path.join(assetsDir, file), 'utf8');
  for (const term of FORBIDDEN) {
    if (text.includes(term)) {
      console.error(`FAIL  ${file} contains forbidden term "${term}"`);
      failed = true;
    }
  }
}

if (failed) {
  console.error('\nbundle-redaction guard FAILED — admin/internal vocabulary in a client chunk.');
  process.exit(1);
}
console.log(`\nbundle-redaction guard passed (${jsFiles.length} chunks scanned).`);
```

- [ ] **Step 2: Add the package.json script**

In `package.json` `scripts`, add (next to the other client-portal guards):

```json
"test:client-portal-bundle-redaction": "node scripts/client-portal-bundle-redaction-guard.mjs",
```

- [ ] **Step 3: Run the guard against the CURRENT build to verify it fails**

Run: `npm --prefix portal-client run build && node scripts/client-portal-bundle-redaction-guard.mjs`
Expected: **FAIL** — reports `standard_shipping_cost`, `shipAlloc`, and/or `shipUnits` in the Dashboard/Analysis chunks. This confirms the guard detects the real leak. (It goes green in Task 8 after the re-source lands.)

- [ ] **Step 4: Commit**

```bash
git add scripts/client-portal-bundle-redaction-guard.mjs package.json
git commit -m "test(cp-038): add build-bundle redaction guard (red until re-source lands)"
```

---

### Task 2: Re-source `getSkuBreakdownFromOrderItems` (Dashboard + Analysis table)

**Files:**
- Modify: `src/routes/analysis.ts` (the `SkuBreakdownQuery` type near its definition, and `getSkuBreakdownFromOrderItems` at :813; the `label_cost` column at :847)

**Interfaces:**
- Consumes: nothing new.
- Produces: `getSkuBreakdownFromOrderItems(q)` honours `q.shippingBasis`; `'customer_billed'` sources the per-order shipping amount from `billing_line_items` (`line_type='shipping'`). `SkuBreakdownQuery` gains `shippingBasis?: 'house_markup' | 'customer_billed'`.

- [ ] **Step 1: Add `shippingBasis` to the `SkuBreakdownQuery` type**

Find the `SkuBreakdownQuery` type/interface in `src/routes/analysis.ts` (defined above `getSkuBreakdownFromOrderItems`). Add the optional field:

```ts
  /** CP-038: shipping amount basis. Default 'house_markup' = the legacy inline
   *  base_cost*(1+markup) re-derivation (operator/legacy). 'customer_billed' sums the
   *  canonical billing_line_items shipping line — used by the client portal. */
  shippingBasis?: 'house_markup' | 'customer_billed';
```

- [ ] **Step 2: Build the basis expression inside `getSkuBreakdownFromOrderItems`**

In `src/routes/analysis.ts`, inside `getSkuBreakdownFromOrderItems`, just before the `const rows = await db.execute<SkuBreakdownRow>(sql\`` block (around line 837), add:

```ts
  // CP-038: client portal passes 'customer_billed' to read the canonical billed shipping
  // (billing_line_items) instead of the inline base_cost*(1+markup) re-derivation. `o` is
  // the orders alias inside item_rows; the billing subquery inherits its scope.
  const shippingAmountExpr =
    q.shippingBasis === 'customer_billed'
      ? sql`coalesce((select sum(b.total_cost) from billing_line_items b where b.order_id = o.id and b.line_type = 'shipping'), 0)`
      : sql`coalesce(ls.label_cost, 0)`;
```

- [ ] **Step 3: Use the basis expression for the `label_cost` column**

In the `item_rows` CTE, replace the existing line 847:

```
        coalesce(ls.label_cost, 0)                                          as label_cost,
```

with:

```
        ${shippingAmountExpr}                                               as label_cost,
```

(The internal column keeps the name `label_cost`; downstream std/exp/total_shipping sums and std/exp classification are unchanged. Client-facing keys are renamed later at the boundary/DTO.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: CLEAN (no errors in `analysis.ts`).

- [ ] **Step 5: Commit**

```bash
git add src/routes/analysis.ts
git commit -m "feat(cp-038): parameterize getSkuBreakdownFromOrderItems shippingBasis"
```

---

### Task 3: Re-source `getSkuOrdersForSku` (Analysis SKU detail drawer)

**Files:**
- Modify: `src/services/sku-orders.ts` (the `SkuOrdersInput` type :45-57; the two inner queries — `marked_cost`→`label_cost` at :146 and :267)

**Interfaces:**
- Produces: `getSkuOrdersForSku(input)` honours `input.shippingBasis`; `'customer_billed'` sources per-order shipping from `billing_line_items`. `SkuOrdersInput` gains `shippingBasis?: 'house_markup' | 'customer_billed'`.

- [ ] **Step 1: Add `shippingBasis` to `SkuOrdersInput`**

In `src/services/sku-orders.ts`, add to the `SkuOrdersInput` type (after `canViewFinancials`):

```ts
  /** CP-038: 'house_markup' (default, operator/legacy inline markup) or 'customer_billed'
   *  (client portal — canonical billing_line_items shipping). */
  shippingBasis?: 'house_markup' | 'customer_billed';
```

- [ ] **Step 2: Build the basis expression once, near the top of `getSkuOrdersForSku`**

After `const { sku, canViewFinancials } = input;` (line 60), add:

```ts
  // CP-038: see getSkuBreakdownFromOrderItems. `o` is the orders alias in both inner queries.
  const shippingAmountExpr =
    input.shippingBasis === 'customer_billed'
      ? sql`coalesce((select sum(b.total_cost) from billing_line_items b where b.order_id = o.id and b.line_type = 'shipping'), 0)`
      : sql`coalesce(ls.marked_cost, 0)`;
```

- [ ] **Step 3: Use it in the shipping-summary query**

In the first `db.execute` (the `shippingSummary` query), replace line 146:

```
        coalesce(ls.marked_cost, 0)                                        as label_cost,
```

with:

```
        ${shippingAmountExpr}                                              as label_cost,
```

- [ ] **Step 4: Use it in the rows query**

In the second `db.execute` (the `rows` query), replace line 267:

```
        coalesce(ls.marked_cost, 0)                                        as label_cost,
```

with:

```
        ${shippingAmountExpr}                                              as label_cost,
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: CLEAN.

- [ ] **Step 6: Commit**

```bash
git add src/services/sku-orders.ts
git commit -m "feat(cp-038): parameterize getSkuOrdersForSku shippingBasis"
```

---

### Task 4: Client-portal consumers + boundary renames + read-model + wiring guard

**Files:**
- Modify: `src/routes/client-portal/analysis.ts` (pass `customer_billed` at :23 and :99; boundary remap at :113-116)
- Modify: `src/lib/client-portal/read-models/dashboard.ts` (pass `customer_billed` at :56; drop `shipAlloc`/`shipUnits` from `DashboardTopSkuRow` :38-43 and the mapping :59-75)
- Create: `scripts/client-portal-shipping-resource-guard.mjs`
- Modify: `package.json` (add `test:client-portal-shipping-resource`)

**Interfaces:**
- Consumes: `shippingBasis` from Tasks 2-3.
- Produces: `DashboardTopSkuRow` no longer has `shipAlloc`/`shipUnits`; the `/analysis/sku-orders` client payload exposes `shippingCharge` + `avgShippingCharge` (no `*_cost`/`*_total` shipping keys).

- [ ] **Step 1: Dashboard read-model passes `customer_billed` and drops the allocation keys**

In `src/lib/client-portal/read-models/dashboard.ts`:
- In `dashboardTopSkus`, change the call `const result = await getSkuBreakdownFromOrderItems(q);` (line 56) to `const result = await getSkuBreakdownFromOrderItems({ ...q, shippingBasis: 'customer_billed' });`.
- In `DashboardTopSkuRow` (lines 38-43), delete the `shipAlloc` and `shipUnits` fields and the doc comment referencing "$shipAlloc ÷ shipUnits".
- In the `.map` (lines 66-74), delete the `shipAlloc` and `shipUnits` computed properties and the now-unused `shipAlloc`/`shipUnits` locals; keep `avgShippingPrice`.

- [ ] **Step 2: Client-portal analysis route passes `customer_billed` to both helpers + renames drawer keys**

In `src/routes/client-portal/analysis.ts`:
- In the `getSkuBreakdownFromOrderItems({ ... })` call (lines 23-36), add `shippingBasis: 'customer_billed',`.
- In the `getSkuOrdersForSku({ ... })` call (lines 99-107), add `shippingBasis: 'customer_billed',`.
- Replace the sku-orders response remap (lines 113-116) with a remap that also renames/drops shipping keys:

```ts
  return c.json({
    ...result,
    avgShippingCharge: result.avgStandardShippingCost,
    avgStandardShippingCost: undefined,
    // CP-018 + CP-038: strip carrier/service identity AND rename the per-order shipping
    // key to a client-facing charge; drop the redundant internal *_cost/*_total variants.
    orders: result.orders.map((o) => ({
      order_id: o.order_id,
      order_number: o.order_number,
      order_date: o.order_date,
      order_status: o.order_status,
      ship_to_name: o.ship_to_name,
      carrier_code: null,
      service_code: null,
      qty: o.qty,
      unit_price: o.unit_price,
      item_name: o.item_name,
      shippingCharge: o.standard_shipping_cost,
      is_external_shipped: o.is_external_shipped,
    })),
  });
```

- [ ] **Step 3: Write the re-source wiring guard**

Create `scripts/client-portal-shipping-resource-guard.mjs`:

```js
// CP-038 — client-portal shipping re-source wiring guard (STATIC).
// Pins that the client-portal analytics read the CANONICAL billed shipping
// (shippingBasis: 'customer_billed') from billing_line_items, never the inline-markup
// house basis, while operator/legacy consumers keep the default. A future edit cannot
// silently revert the client to the inline re-derivation.
import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const read = (rel) => (fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : '');
let failed = false;
const assert = (c, m) => { if (c) console.log(`PASS ${m}`); else { console.error(`FAIL ${m}`); failed = true; } };

const analysis = read('src/routes/analysis.ts');
const skuOrders = read('src/services/sku-orders.ts');
const cpAnalysis = read('src/routes/client-portal/analysis.ts');
const dashRm = read('src/lib/client-portal/read-models/dashboard.ts');
const baseDash = read('src/routes/dashboard.ts');

// 1. Both shared helpers accept a shippingBasis and source billed shipping for customer_billed.
assert(/shippingBasis/.test(analysis), 'getSkuBreakdownFromOrderItems accepts shippingBasis');
assert(/shippingBasis/.test(skuOrders), 'getSkuOrdersForSku accepts shippingBasis');
assert(/billing_line_items[\s\S]{0,120}line_type\s*=\s*'shipping'/.test(analysis), 'analysis customer_billed sums billing_line_items shipping');
assert(/billing_line_items[\s\S]{0,120}line_type\s*=\s*'shipping'/.test(skuOrders), 'sku-orders customer_billed sums billing_line_items shipping');
// 2. Client consumers pass customer_billed (breakdown + sku-orders in the route; dashboard read-model).
assert((cpAnalysis.match(/shippingBasis:\s*'customer_billed'/g) || []).length >= 2, 'client-portal analysis passes customer_billed to both helpers');
assert(/shippingBasis:\s*'customer_billed'/.test(dashRm), 'client dashboard read-model passes customer_billed');
// 3. Base/legacy consumers keep the default (do NOT force customer_billed).
assert(!/shippingBasis:\s*'customer_billed'/.test(baseDash), 'base dashboard route keeps default (house_markup)');
// 4. Client boundary exposes a charge-named drawer key.
assert(/shippingCharge/.test(cpAnalysis) && /avgShippingCharge/.test(cpAnalysis), 'sku-orders boundary exposes shippingCharge / avgShippingCharge');
// 5. Dashboard client row dropped the internal allocation keys.
assert(!/shipAlloc/.test(dashRm) && !/shipUnits/.test(dashRm), 'DashboardTopSkuRow dropped shipAlloc/shipUnits');

const pkg = JSON.parse(read('package.json'));
assert(pkg.scripts?.['test:client-portal-shipping-resource'] === 'node scripts/client-portal-shipping-resource-guard.mjs', 'package.json exposes test:client-portal-shipping-resource');

if (failed) process.exit(1);
console.log('\nCP-038 client-portal shipping re-source guard passed.');
```

- [ ] **Step 4: Add the package.json script**

In `package.json` `scripts`, add:

```json
"test:client-portal-shipping-resource": "node scripts/client-portal-shipping-resource-guard.mjs",
```

- [ ] **Step 5: Run the wiring guard + typecheck**

Run: `node scripts/client-portal-shipping-resource-guard.mjs`
Expected: all PASS.
Run: `npx tsc --noEmit -p tsconfig.json`
Expected: CLEAN.

- [ ] **Step 6: Commit**

```bash
git add src/routes/client-portal/analysis.ts src/lib/client-portal/read-models/dashboard.ts scripts/client-portal-shipping-resource-guard.mjs package.json
git commit -m "feat(cp-038): client portal reads canonical billed shipping + re-source guard"
```

---

### Task 5: Rename `shippingCost` → `customerShippingRate` (Shipments)

**Files:**
- Modify: `src/lib/client-portal/dto.ts:354` (the Shipment DTO field)
- Modify: `portal-client/src/lib/api.ts:236` (`PortalShipment` interface field)
- Modify: `portal-client/src/pages/Shipments.tsx:124` (the accessor)

**Interfaces:**
- Produces: the Shipments DTO exposes `customerShippingRate` (value unchanged).

- [ ] **Step 1: Rename the backend DTO field**

In `src/lib/client-portal/dto.ts` around line 354, rename the object key `shippingCost` to `customerShippingRate` (keep the same value expression). Check the file for any other `shippingCost` reference in that Shipment builder and rename consistently.

- [ ] **Step 2: Rename the frontend type + accessor**

In `portal-client/src/lib/api.ts` around line 236, in the `PortalShipment` interface rename `shippingCost` to `customerShippingRate` (same type).
In `portal-client/src/pages/Shipments.tsx` around line 124, change the column accessor from `shippingCost` to `customerShippingRate` (the header label already reads "Customer Shipping Rate").

- [ ] **Step 3: Typecheck both projects**

Run: `npx tsc --noEmit -p tsconfig.json && npm --prefix portal-client run typecheck`
Expected: CLEAN (a leftover `shippingCost` reference would surface here).

- [ ] **Step 4: Commit**

```bash
git add src/lib/client-portal/dto.ts portal-client/src/lib/api.ts portal-client/src/pages/Shipments.tsx
git commit -m "refactor(cp-038): Shipments DTO key shippingCost -> customerShippingRate"
```

---

### Task 6: Frontend — Dashboard + Analysis leak cleanup

**Files:**
- Modify: `portal-client/src/pages/Dashboard.tsx:211` (remove allocation-math tooltip; drop `shipAlloc`/`shipUnits` usage)
- Modify: `portal-client/src/pages/Analysis.tsx:283,321-322` (relabel; new drawer keys)
- Modify: `portal-client/src/lib/api.ts` (Dashboard top-SKU row type: drop `shipAlloc`/`shipUnits`; sku-orders response type: `standard_shipping_cost`→`shippingCharge`, `avgStandardShippingCost`→`avgShippingCharge`, drop `shipping_cost`/`shipping_total`/`standard_shipping_total`)

**Interfaces:**
- Consumes: the re-sourced DTOs from Tasks 4-5.

- [ ] **Step 1: Update the frontend types in `api.ts`**

In `portal-client/src/lib/api.ts`:
- In the Dashboard top-SKU row type (the `bySku` element type), remove the `shipAlloc` and `shipUnits` fields (keep `avgShippingPrice`).
- In the sku-orders response type: on the per-order row type rename `standard_shipping_cost` → `shippingCharge` and remove `shipping_cost`, `shipping_total`, `standard_shipping_total`, `carrier_code`, `service_code` if present as non-null; on the result type rename `avgStandardShippingCost` → `avgShippingCharge`.

- [ ] **Step 2: Dashboard — remove the allocation-math tooltip**

In `portal-client/src/pages/Dashboard.tsx`, replace the tooltip block at lines 209-215 (the branch rendering `` `${money(s.shipAlloc)} ÷ ${s.shipUnits} units = ${money(s.avgShippingPrice)}` ``) with a plain value (no internal math):

```tsx
                            ) : (
                              <span className="tnum">{money(s.avgShippingPrice)}</span>
                            )}
```

Remove any remaining `s.shipAlloc` / `s.shipUnits` references in this file.

- [ ] **Step 3: Analysis — relabel + new drawer keys**

In `portal-client/src/pages/Analysis.tsx`:
- Line 283: change `<SkuStat label="Avg ship cost" value={money(Number(data?.avgStandardShippingCost ?? 0))} />` to `<SkuStat label="Avg shipping charge" value={money(Number(data?.avgShippingCharge ?? 0))} />`.
- Lines 321-322: change the per-order chip condition/value from `o.standard_shipping_cost` to `o.shippingCharge` (both the `&&` guard and the `money(Number(...))` call).

- [ ] **Step 4: Typecheck portal-client**

Run: `npm --prefix portal-client run typecheck`
Expected: CLEAN (a leftover `shipAlloc`/`standard_shipping_cost`/`avgStandardShippingCost` reference surfaces here).

- [ ] **Step 5: Commit**

```bash
git add portal-client/src/pages/Dashboard.tsx portal-client/src/pages/Analysis.tsx portal-client/src/lib/api.ts
git commit -m "refactor(cp-038): Dashboard/Analysis show billed shipping charge, drop internal allocation vocab"
```

---

### Task 7: Frontend — optics label renames (Billing / Finance / OrderDetail)

**Files:**
- Modify: `portal-client/src/pages/Invoices.tsx:270,399` ("Box Cost" → "Box Charge")
- Modify: `portal-client/src/pages/Finance.tsx:47` ("Avg. cost / order" → "Avg. charge / order")
- Modify: `portal-client/src/components/OrderDetailPanel.tsx:77` ("Cost summary" → "Order charges")

**Interfaces:**
- Consumes/Produces: label text only; no DTO/key changes (the underlying keys `packageTotal`, `avgCostPerOrder`, `costSummary` are unchanged and remain blessed in the SOT matrix).

- [ ] **Step 1: Rename the visible labels**

- `Invoices.tsx` lines 270 and 399: change the header text `Box Cost` → `Box Charge`.
- `Finance.tsx` line 47: change the card label `Avg. cost / order` → `Avg. charge / order`.
- `OrderDetailPanel.tsx` line 77: change the section label `Cost summary` → `Order charges`.

- [ ] **Step 2: Typecheck portal-client**

Run: `npm --prefix portal-client run typecheck`
Expected: CLEAN.

- [ ] **Step 3: Commit**

```bash
git add portal-client/src/pages/Invoices.tsx portal-client/src/pages/Finance.tsx portal-client/src/components/OrderDetailPanel.tsx
git commit -m "refactor(cp-038): relabel Box Charge / Avg charge per order / Order charges"
```

---

### Task 8: Final verification — guard green + wire into certification

**Files:**
- Modify: `package.json` (`test:full-site-certification` chain — add the bundle-redaction guard after `build:web`)

**Interfaces:**
- Consumes: everything from Tasks 1-7.

- [ ] **Step 1: Rebuild the portal-client bundle**

Run: `npm --prefix portal-client run build`
Expected: build succeeds.

- [ ] **Step 2: Run the bundle-redaction guard — now GREEN**

Run: `node scripts/client-portal-bundle-redaction-guard.mjs`
Expected: **PASS** — `bundle-redaction guard passed (N chunks scanned).` (The forbidden terms are gone from the client chunks; the admin `Settings-*.js` chunk is skipped.)

- [ ] **Step 3: Wire the guard into `test:full-site-certification`**

In `package.json`, in the `test:full-site-certification` script, insert `&& npm run test:client-portal-bundle-redaction` immediately after `npm run build:web`. Example:

```
"test:full-site-certification": "npm run typecheck && npm run build:web && npm run test:client-portal-bundle-redaction && npm run guard:site-actions && npm run test:api-contracts && npm run test:shipstation-label-url && npm run test:print-queue-invalid-label && npm run test:portal-smoke && npm run test:client-portal-failure-states"
```

- [ ] **Step 4: Run the unchanged SOT/redaction guards — confirm no regression**

Run each; expected PASS:

```bash
node scripts/client-portal-shipping-resource-guard.mjs
npm run test:client-portal-returns-canonical-fields
npm run test:client-portal-orders-selected-rate
npm run test:client-portal-datatable-customization-rbac
npm run test:client-portal-carrier-redaction
npm run test:client-portal-shadow-renderer
```

(If `test:client-portal-analytics-parity` exists, run it too — Dashboard and Analysis both pass `customer_billed`, so parity holds.)

- [ ] **Step 5: Full typecheck**

Run: `npx tsc --noEmit -p tsconfig.json && npm --prefix portal-client run typecheck`
Expected: CLEAN.

- [ ] **Step 6: Commit**

```bash
git add package.json
git commit -m "test(cp-038): wire bundle-redaction guard into full-site-certification"
```

---

## Self-Review (completed)

**Spec coverage:** §4A re-source → Tasks 2,3,4,6; §4B optics renames → Tasks 5,7; §4C guard → Tasks 1,8; §3 scope (portal-only, Markups deferred) honoured — the guard allowlists `Settings-*.js` rather than touching Markups. Env prerequisite (memory: fresh worktree needs `.env` + portal-client install) → Task 0.

**Placeholder scan:** no TBD/TODO; every code step shows exact code or exact line-anchored rename instructions.

**Type consistency:** `shippingBasis: 'house_markup' | 'customer_billed'` used identically in Tasks 2/3/4; `shippingCharge`/`avgShippingCharge` used consistently across the boundary (Task 4) and the frontend (Task 6); `customerShippingRate` consistent across Task 5's three files.

## Follow-ups (not in this plan)

- **CP-038b:** relocate the Markups admin UI out of the customer bundle (prepship-v4 / admin-only build), then drop the `Settings-*.js` allowlist from the bundle-redaction guard.
- Optional: rename the blessed DTO keys `costSummary`/`avgCostPerOrder` (+ update the CP-025 SOT matrix + guard).
