# Shopify Direct Client Store Connect — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portal clients connect their own Shopify store (shop domain + Admin API token, live-validated), the operator approves, and PrepShip's scheduler polls the store's new orders directly from the Shopify GraphQL Admin API into the existing orders pipeline, attributed to that client.

**Architecture:** Credentials ride the existing `store_accounts` rails (`source='portal'`, `active=false` until promotion). A real Shopify connector (`src/connectors/store/shopify.ts`) owns GraphQL calls + normalization; a new `shopify-order-sync` service orchestrates polling through the existing `upsertNormalizedStoreOrders()` (PS-031). Promotion now also activates and stamps the forward-only anchor. Portal shows sync status; rates stay on the untouched CP-040 resolver.

**Tech Stack:** TypeScript (strict), Hono routes, drizzle + raw postgres-js SQL, Shopify GraphQL Admin API **2026-04** (queries below are schema-validated), React/Vite portal (`portal-client/`), repo guard system (`node:assert/strict` scripts auto-discovered from `package.json` `test:*`/`guard:*` names).

**Spec:** `docs/superpowers/specs/2026-07-08-shopify-client-store-connect-design.md`

## Global Constraints

- `npm run typecheck` must pass after every task (runs root tsc AND portal-client typecheck).
- Commit locally after every task. **NEVER push** — repo rule: no backend pushes without permission.
- Migration is ADDITIVE only (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).
- Credentials are NEVER echoed in responses, audit rows, or logs — audit records field NAMES only (existing behavior; extend it, never weaken it).
- Portal submissions are ALWAYS `source='portal'`, `active=false`. Sync reads ONLY `source='admin' AND active=true` rows.
- Buyer-paid Shopify shipping goes to `orders.shipping_amount` for display/record ONLY — it is never a Customer Shipping Rate input (CP-040).
- Guard scripts must be CRLF-tolerant (no `$` end-of-line anchors; prefer `[\s\S]*` and substring checks) and clean-worktree-safe.
- Shopify API version is pinned: `2026-04`. Requests time out at 8s. Least privilege: docs/UI tell clients to grant `read_orders` only.
- New npm scripts named `test:*` or `guard:*` are auto-run by `npm run test:guards` UNLESS the name matches the DENY regex in `scripts/run-guards.mjs` (names containing `integration` are excluded — use that for DB-bound tests).

---

### Task 1: Additive migration — sync state columns on `store_accounts`

**Files:**
- Create: `drizzle/0037_store_account_sync_state.sql`

**Interfaces:**
- Consumes: existing `store_accounts` table (drizzle/0027_credential_accounts_source_of_truth.sql).
- Produces: columns `sync_anchor_at`, `sync_cursor_at`, `last_synced_at`, `last_sync_error`, `sync_failure_count` used by Tasks 4, 5, 10, 13.

- [ ] **Step 1: Create the migration file**

```sql
-- Shopify direct client store connect (spec 2026-07-08).
-- Additive sync bookkeeping for store_accounts. Forward-only order sync:
--   sync_anchor_at  — stamped at promotion (portal->admin); orders created
--                     before this instant are never imported.
--   sync_cursor_at  — incremental updated_at watermark; only advances after a
--                     page is fully persisted.
--   last_synced_at  — last successful sync tick for this account.
--   last_sync_error — machine-readable last failure ('auth' pauses after 3).
--   sync_failure_count — consecutive auth failures (reset on success).

ALTER TABLE "store_accounts" ADD COLUMN IF NOT EXISTS "sync_anchor_at" timestamp with time zone;
ALTER TABLE "store_accounts" ADD COLUMN IF NOT EXISTS "sync_cursor_at" timestamp with time zone;
ALTER TABLE "store_accounts" ADD COLUMN IF NOT EXISTS "last_synced_at" timestamp with time zone;
ALTER TABLE "store_accounts" ADD COLUMN IF NOT EXISTS "last_sync_error" text;
ALTER TABLE "store_accounts" ADD COLUMN IF NOT EXISTS "sync_failure_count" integer DEFAULT 0 NOT NULL;
```

- [ ] **Step 2: Typecheck (sanity, no TS touched)**

Run: `npm run typecheck`
Expected: PASS (exit 0)

- [ ] **Step 3: Commit**

```bash
git add drizzle/0037_store_account_sync_state.sql
git commit -m "feat(shopify-connect): add store_accounts sync-state migration"
```

---

### Task 2: Shopify connector — pure normalization functions (TDD)

**Files:**
- Modify: `src/connectors/store/shopify.ts` (currently a 23-line stub — keep `createShopifyStoreConnector` / `shopifyStoreConnector` exports intact)
- Create: `scripts/shopify-order-normalization-test.ts`
- Modify: `package.json` (add script `"test:shopify-order-normalization": "tsx scripts/shopify-order-normalization-test.ts"` — alphabetical placement near the other `test:` entries)

**Interfaces:**
- Consumes: `buildNormalizedOrderSource` from `src/services/normalized-order-persistence.ts`; `NormalizedStoreOrder` type from `src/services/store-order-import.ts`; `syntheticStoreIdForCredentialAccount` from `src/services/credential-accounts.ts`.
- Produces (used by Tasks 3, 4, 7, 13):
  - `SHOPIFY_ADMIN_API_VERSION: string` (`'2026-04'`)
  - `normalizeShopDomain(input: string): string | null`
  - `mapShopifyOrderStatus(node: { cancelledAt?: string | null; displayFulfillmentStatus?: string | null }): { orderStatus: string; externallyShipped: boolean }`
  - `type ShopifyOrderNode` (shape of one GraphQL order node)
  - `normalizeShopifyOrder(node: ShopifyOrderNode, ctx: { accountId: number; clientId: number | null; anchor: Date }): NormalizedStoreOrder | null`

- [ ] **Step 1: Write the failing test**

Create `scripts/shopify-order-normalization-test.ts`:

```ts
// Behavioral test for the pure Shopify normalization layer. No DB, no network.
// Runs in `npm run test:guards` via the test:shopify-order-normalization script.
import assert from 'node:assert/strict';
import {
  SHOPIFY_ADMIN_API_VERSION,
  normalizeShopDomain,
  mapShopifyOrderStatus,
  normalizeShopifyOrder,
  type ShopifyOrderNode,
} from '../src/connectors/store/shopify';

// ── normalizeShopDomain ──
assert.equal(normalizeShopDomain('mybrand.myshopify.com'), 'mybrand.myshopify.com');
assert.equal(normalizeShopDomain('  HTTPS://MyBrand.myshopify.com/admin '), 'mybrand.myshopify.com');
assert.equal(normalizeShopDomain('mybrand'), 'mybrand.myshopify.com');
assert.equal(normalizeShopDomain('store.example.com'), null, 'custom domains are rejected');
assert.equal(normalizeShopDomain(''), null);
assert.equal(normalizeShopDomain('bad domain!'), null);

// ── mapShopifyOrderStatus ──
assert.deepEqual(
  mapShopifyOrderStatus({ cancelledAt: '2026-07-01T00:00:00Z', displayFulfillmentStatus: 'FULFILLED' }),
  { orderStatus: 'cancelled', externallyShipped: false },
  'cancelledAt wins over fulfillment',
);
assert.deepEqual(
  mapShopifyOrderStatus({ cancelledAt: null, displayFulfillmentStatus: 'FULFILLED' }),
  { orderStatus: 'shipped', externallyShipped: true },
);
assert.deepEqual(
  mapShopifyOrderStatus({ cancelledAt: null, displayFulfillmentStatus: 'UNFULFILLED' }),
  { orderStatus: 'awaiting_shipment', externallyShipped: false },
);
assert.deepEqual(
  mapShopifyOrderStatus({ cancelledAt: null, displayFulfillmentStatus: 'PARTIALLY_FULFILLED' }),
  { orderStatus: 'awaiting_shipment', externallyShipped: false },
  'partial fulfillment stays actionable',
);

// ── normalizeShopifyOrder ──
const NODE: ShopifyOrderNode = {
  id: 'gid://shopify/Order/5551234',
  legacyResourceId: '5551234',
  name: '#1001',
  createdAt: '2026-07-08T10:00:00Z',
  updatedAt: '2026-07-08T10:05:00Z',
  cancelledAt: null,
  displayFulfillmentStatus: 'UNFULFILLED',
  email: 'buyer@example.com',
  shippingAddress: { name: 'Pat Buyer', city: 'Austin', provinceCode: 'TX', zip: '78701' },
  currentTotalPriceSet: { shopMoney: { amount: '49.99' } },
  totalShippingPriceSet: { shopMoney: { amount: '7.25' } },
  lineItems: {
    nodes: [
      {
        sku: 'SKU-1',
        title: 'Widget',
        quantity: 2,
        originalUnitPriceSet: { shopMoney: { amount: '19.99' } },
        image: { url: 'https://cdn.shopify.com/widget.png' },
      },
      { sku: null, title: 'No-SKU line', quantity: 1, originalUnitPriceSet: { shopMoney: { amount: '10.01' } }, image: null },
    ],
  },
};
const ANCHOR = new Date('2026-07-08T00:00:00Z');
const normalized = normalizeShopifyOrder(NODE, { accountId: 42, clientId: 7, anchor: ANCHOR });
assert.ok(normalized, 'order after anchor normalizes');
assert.equal(normalized!.source.sourceProvider, 'shopify');
assert.equal(normalized!.source.sourceAccountId, 'store-account:42');
assert.equal(normalized!.source.sourceOrderId, '5551234');
assert.equal(normalized!.source.sourceOrderNumber, '#1001');
assert.equal(normalized!.externalOrderId, 'shopify-5551234');
assert.equal(normalized!.orderNumber, '#1001');
assert.equal(normalized!.orderStatus, 'awaiting_shipment');
assert.equal(normalized!.clientId, 7);
assert.equal(normalized!.storeId, 9_200_000 + 42, 'synthetic shopify store id');
assert.equal(normalized!.customerEmail, 'buyer@example.com');
assert.equal(normalized!.shipToName, 'Pat Buyer');
assert.equal(normalized!.shipToCity, 'Austin');
assert.equal(normalized!.shipToState, 'TX');
assert.equal(normalized!.shipToPostalCode, '78701');
assert.equal(normalized!.orderTotal, '49.99');
assert.equal(normalized!.shippingAmount, '7.25', 'buyer-paid shipping is display/record only (CP-040)');
assert.equal(normalized!.weightOz, null, 'v1 leaves weight for the operator');
const items = normalized!.items as Array<Record<string, unknown>>;
assert.equal(items.length, 2);
assert.deepEqual(items[0], {
  sku: 'SKU-1',
  name: 'Widget',
  quantity: 2,
  unitPrice: '19.99',
  imageUrl: 'https://cdn.shopify.com/widget.png',
});

// Forward-only floor: created before anchor -> null (never imported).
const oldNode: ShopifyOrderNode = { ...NODE, createdAt: '2026-07-07T23:59:59Z', legacyResourceId: '111' };
assert.equal(normalizeShopifyOrder(oldNode, { accountId: 42, clientId: 7, anchor: ANCHOR }), null);

assert.equal(SHOPIFY_ADMIN_API_VERSION, '2026-04');
console.log('PASS shopify order normalization');
```

- [ ] **Step 2: Register the npm script and run the test to verify it fails**

Add to `package.json` scripts:

```json
"test:shopify-order-normalization": "tsx scripts/shopify-order-normalization-test.ts",
```

Run: `npm run test:shopify-order-normalization`
Expected: FAIL — `SyntaxError`/`TypeError`: the module has no export named `normalizeShopDomain`.

- [ ] **Step 3: Implement the pure functions**

Append to `src/connectors/store/shopify.ts` (below the existing stub exports):

```ts
import { buildNormalizedOrderSource } from '../../services/normalized-order-persistence';
import { syntheticStoreIdForCredentialAccount } from '../../services/credential-accounts';
import type { NormalizedStoreOrder } from '../../services/store-order-import';

export const SHOPIFY_ADMIN_API_VERSION = '2026-04';

/**
 * Canonicalize a client-entered shop domain to `<shop>.myshopify.com`.
 * Custom storefront domains are rejected — the connect UI instructs clients to
 * use their .myshopify.com domain (the canonical identity Shopify reports).
 */
export function normalizeShopDomain(input: string): string | null {
  const trimmed = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  if (!trimmed) return null;
  if (/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(trimmed)) return trimmed;
  if (/^[a-z0-9][a-z0-9-]*$/.test(trimmed)) return `${trimmed}.myshopify.com`;
  return null;
}

/**
 * Canonical status mapping (spec 2026-07-08): cancellation wins; a fully
 * fulfilled order was shipped by someone else (externallyShipped) since
 * PrepShip only imports forward from approval; everything else is actionable.
 */
export function mapShopifyOrderStatus(node: {
  cancelledAt?: string | null;
  displayFulfillmentStatus?: string | null;
}): { orderStatus: string; externallyShipped: boolean } {
  if (node.cancelledAt) return { orderStatus: 'cancelled', externallyShipped: false };
  if ((node.displayFulfillmentStatus ?? '').toUpperCase() === 'FULFILLED') {
    return { orderStatus: 'shipped', externallyShipped: true };
  }
  return { orderStatus: 'awaiting_shipment', externallyShipped: false };
}

/** One order node from the PrepShipOrdersSince GraphQL query (2026-04). */
export type ShopifyOrderNode = {
  id: string;
  legacyResourceId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  displayFulfillmentStatus: string | null;
  email: string | null;
  shippingAddress: { name: string | null; city: string | null; provinceCode: string | null; zip: string | null } | null;
  currentTotalPriceSet: { shopMoney: { amount: string } } | null;
  totalShippingPriceSet: { shopMoney: { amount: string } } | null;
  lineItems: {
    nodes: Array<{
      sku: string | null;
      title: string | null;
      quantity: number | null;
      originalUnitPriceSet: { shopMoney: { amount: string } } | null;
      image: { url: string | null } | null;
    }>;
  };
};

/**
 * Shopify order -> NormalizedStoreOrder for upsertNormalizedStoreOrders().
 * Returns null when the order was created before the forward-only anchor.
 * weightOz stays null in v1 — the operator fills weight before rating.
 * shippingAmount is the buyer-paid checkout total: display/record only,
 * never a Customer Shipping Rate input (CP-040).
 */
export function normalizeShopifyOrder(
  node: ShopifyOrderNode,
  ctx: { accountId: number; clientId: number | null; anchor: Date },
): NormalizedStoreOrder | null {
  const createdAt = new Date(node.createdAt);
  if (!Number.isFinite(createdAt.getTime()) || createdAt < ctx.anchor) return null;

  const { orderStatus, externallyShipped } = mapShopifyOrderStatus(node);
  const raw = node as unknown as Record<string, unknown>;

  return {
    externalOrderId: `shopify-${node.legacyResourceId}`,
    source: buildNormalizedOrderSource({
      sourceProvider: 'shopify',
      sourceAccountId: `store-account:${ctx.accountId}`,
      sourceOrderId: node.legacyResourceId,
      sourceOrderNumber: node.name,
      raw,
    }),
    orderNumber: node.name,
    orderStatus,
    orderDate: createdAt,
    clientId: ctx.clientId,
    storeId: syntheticStoreIdForCredentialAccount('shopify', ctx.accountId),
    customerEmail: node.email ?? null,
    shipToName: node.shippingAddress?.name ?? null,
    shipToCity: node.shippingAddress?.city ?? null,
    shipToState: node.shippingAddress?.provinceCode ?? null,
    shipToPostalCode: node.shippingAddress?.zip ?? null,
    carrierCode: null,
    serviceCode: null,
    weightOz: null,
    orderTotal: node.currentTotalPriceSet?.shopMoney?.amount ?? '0',
    shippingAmount: node.totalShippingPriceSet?.shopMoney?.amount ?? '0',
    items: node.lineItems.nodes.map((li) => ({
      sku: li.sku ?? '',
      name: li.title ?? null,
      quantity: li.quantity ?? 0,
      unitPrice: li.originalUnitPriceSet?.shopMoney?.amount ?? '0',
      imageUrl: li.image?.url ?? null,
    })),
    raw,
    externallyShipped,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:shopify-order-normalization`
Expected: `PASS shopify order normalization`, exit 0.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/connectors/store/shopify.ts scripts/shopify-order-normalization-test.ts package.json
git commit -m "feat(shopify-connect): pure Shopify order normalization + status mapping"
```

---

### Task 3: Shopify connector — GraphQL HTTP layer (TDD, injectable fetch)

**Files:**
- Modify: `src/connectors/store/shopify.ts`
- Modify: `scripts/shopify-order-normalization-test.ts` (append HTTP-layer tests with a fake fetch)

**Interfaces:**
- Consumes: Task 2 exports.
- Produces (used by Tasks 4, 7, 13):
  - `type ShopifyFetch = typeof fetch`
  - `SHOP_VERIFY_QUERY: string`, `ORDERS_SINCE_QUERY: string` (schema-validated against 2026-04; `read_orders` scope suffices)
  - `verifyShopifyCredentials(args: { shopDomain: string; accessToken: string; fetchImpl?: ShopifyFetch }): Promise<{ ok: true; shopName: string; myshopifyDomain: string } | { ok: false; reason: 'auth' | 'network' | 'invalid_domain' }>`
  - `fetchShopifyOrdersSince(args: { shopDomain: string; accessToken: string; updatedAtMin: Date; pageSize?: number; fetchImpl?: ShopifyFetch }): Promise<{ ok: true; orders: ShopifyOrderNode[] } | { ok: false; reason: 'auth' | 'network' | 'throttled' | 'graphql' }>`

- [ ] **Step 1: Append failing tests**

Append to `scripts/shopify-order-normalization-test.ts` (before the final `console.log`; move that line to the end):

```ts
// ── HTTP layer with fake fetch ──
import {
  verifyShopifyCredentials,
  fetchShopifyOrdersSince,
  type ShopifyFetch,
} from '../src/connectors/store/shopify';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// verify: happy path
{
  const fakeFetch: ShopifyFetch = async (url) => {
    assert.ok(String(url).includes('mybrand.myshopify.com/admin/api/2026-04/graphql.json'));
    return jsonResponse(200, { data: { shop: { name: 'My Brand', myshopifyDomain: 'mybrand.myshopify.com' } } });
  };
  const r = await verifyShopifyCredentials({ shopDomain: 'mybrand.myshopify.com', accessToken: 't', fetchImpl: fakeFetch });
  assert.deepEqual(r, { ok: true, shopName: 'My Brand', myshopifyDomain: 'mybrand.myshopify.com' });
}

// verify: bad token -> auth
{
  const fakeFetch: ShopifyFetch = async () => jsonResponse(401, { errors: 'Invalid API key or access token' });
  const r = await verifyShopifyCredentials({ shopDomain: 'mybrand.myshopify.com', accessToken: 'bad', fetchImpl: fakeFetch });
  assert.deepEqual(r, { ok: false, reason: 'auth' });
}

// verify: invalid domain never calls fetch
{
  const fakeFetch: ShopifyFetch = async () => {
    throw new Error('must not be called');
  };
  const r = await verifyShopifyCredentials({ shopDomain: 'store.example.com', accessToken: 't', fetchImpl: fakeFetch });
  assert.deepEqual(r, { ok: false, reason: 'invalid_domain' });
}

// orders: two pages, then throttle-retry on page two
{
  const page = (nodes: unknown[], hasNextPage: boolean, endCursor: string | null) => ({
    data: { orders: { pageInfo: { hasNextPage, endCursor }, nodes } },
  });
  const orderNode = (id: string, updatedAt: string) => ({
    id: `gid://shopify/Order/${id}`,
    legacyResourceId: id,
    name: `#${id}`,
    createdAt: '2026-07-08T10:00:00Z',
    updatedAt,
    cancelledAt: null,
    displayFulfillmentStatus: 'UNFULFILLED',
    email: null,
    shippingAddress: null,
    currentTotalPriceSet: { shopMoney: { amount: '1.00' } },
    totalShippingPriceSet: { shopMoney: { amount: '0.00' } },
    lineItems: { nodes: [] },
  });
  let call = 0;
  const fakeFetch: ShopifyFetch = async (_url, init) => {
    call += 1;
    const body = JSON.parse(String(init?.body ?? '{}')) as { variables?: { after?: string | null } };
    if (call === 1) {
      assert.equal(body.variables?.after ?? null, null, 'first page has no cursor');
      return jsonResponse(200, page([orderNode('1', '2026-07-08T10:01:00Z')], true, 'cursor-1'));
    }
    if (call === 2) {
      assert.equal(body.variables?.after, 'cursor-1', 'second page passes the cursor');
      return jsonResponse(200, { errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] });
    }
    return jsonResponse(200, page([orderNode('2', '2026-07-08T10:02:00Z')], false, null));
  };
  const r = await fetchShopifyOrdersSince({
    shopDomain: 'mybrand.myshopify.com',
    accessToken: 't',
    updatedAtMin: new Date('2026-07-08T00:00:00Z'),
    fetchImpl: fakeFetch,
  });
  assert.ok(r.ok, 'throttled page retries and succeeds');
  if (r.ok) {
    assert.equal(r.orders.length, 2);
    assert.equal(r.orders[1]!.legacyResourceId, '2');
  }
  assert.equal(call, 3, 'exactly one retry for the throttled page');
}

// orders: auth failure surfaces as reason 'auth'
{
  const fakeFetch: ShopifyFetch = async () => jsonResponse(403, {});
  const r = await fetchShopifyOrdersSince({
    shopDomain: 'mybrand.myshopify.com',
    accessToken: 'revoked',
    updatedAtMin: new Date(),
    fetchImpl: fakeFetch,
  });
  assert.deepEqual(r, { ok: false, reason: 'auth' });
}
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:shopify-order-normalization`
Expected: FAIL — no export named `verifyShopifyCredentials`.

- [ ] **Step 3: Implement the HTTP layer**

Append to `src/connectors/store/shopify.ts`:

```ts
export type ShopifyFetch = typeof fetch;

/** Schema-validated against Admin API 2026-04. Scope: read_orders. */
export const SHOP_VERIFY_QUERY = `query PrepShipShopVerify {
  shop { name myshopifyDomain }
}`;

/** Schema-validated against Admin API 2026-04. Scope: read_orders. */
export const ORDERS_SINCE_QUERY = `query PrepShipOrdersSince($first: Int!, $after: String, $search: String) {
  orders(first: $first, after: $after, query: $search, sortKey: UPDATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      legacyResourceId
      name
      createdAt
      updatedAt
      cancelledAt
      displayFulfillmentStatus
      email
      shippingAddress { name city provinceCode zip }
      currentTotalPriceSet { shopMoney { amount } }
      totalShippingPriceSet { shopMoney { amount } }
      lineItems(first: 100) {
        nodes {
          sku
          title
          quantity
          originalUnitPriceSet { shopMoney { amount } }
          image { url }
        }
      }
    }
  }
}`;

type GraphqlResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; reason: 'auth' | 'network' | 'throttled' | 'graphql' };

const REQUEST_TIMEOUT_MS = 8_000;
const THROTTLE_RETRY_DELAY_MS = 1_500;

async function shopifyGraphql(args: {
  shopDomain: string;
  accessToken: string;
  query: string;
  variables?: Record<string, unknown>;
  fetchImpl?: ShopifyFetch;
}): Promise<GraphqlResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(
      `https://${args.shopDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': args.accessToken,
        },
        body: JSON.stringify({ query: args.query, variables: args.variables ?? {} }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    // 401/403 = bad/revoked token; 404 = shop not found. All mean "reconnect".
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      return { ok: false, reason: 'auth' };
    }
    if (!res.ok) return { ok: false, reason: 'network' };
    const json = (await res.json()) as {
      data?: Record<string, unknown>;
      errors?: Array<{ extensions?: { code?: string } }>;
    };
    if (json.errors?.some((e) => e?.extensions?.code === 'THROTTLED')) {
      return { ok: false, reason: 'throttled' };
    }
    if (json.errors?.length) return { ok: false, reason: 'graphql' };
    if (!json.data) return { ok: false, reason: 'graphql' };
    return { ok: true, data: json.data };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

/**
 * Live credential check. Called from the portal validate endpoint AND at
 * submit time (the canonical myshopifyDomain is always derived server-side).
 * Never log or persist anything from here except shopName/myshopifyDomain.
 */
export async function verifyShopifyCredentials(args: {
  shopDomain: string;
  accessToken: string;
  fetchImpl?: ShopifyFetch;
}): Promise<
  | { ok: true; shopName: string; myshopifyDomain: string }
  | { ok: false; reason: 'auth' | 'network' | 'invalid_domain' }
> {
  const domain = normalizeShopDomain(args.shopDomain);
  if (!domain) return { ok: false, reason: 'invalid_domain' };
  const result = await shopifyGraphql({
    shopDomain: domain,
    accessToken: args.accessToken,
    query: SHOP_VERIFY_QUERY,
    fetchImpl: args.fetchImpl,
  });
  if (!result.ok) {
    return { ok: false, reason: result.reason === 'auth' ? 'auth' : 'network' };
  }
  const shop = result.data.shop as { name?: string; myshopifyDomain?: string } | undefined;
  if (!shop?.myshopifyDomain) return { ok: false, reason: 'network' };
  return { ok: true, shopName: shop.name ?? shop.myshopifyDomain, myshopifyDomain: shop.myshopifyDomain };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pull every order updated at/after updatedAtMin, oldest-updated first.
 * One throttle retry per page (token-bucket restore is ~50 pts/s; a single
 * short wait covers the poll cadence). Any other failure aborts the batch —
 * the caller's cursor only advances on full success, so nothing is skipped.
 */
export async function fetchShopifyOrdersSince(args: {
  shopDomain: string;
  accessToken: string;
  updatedAtMin: Date;
  pageSize?: number;
  fetchImpl?: ShopifyFetch;
}): Promise<{ ok: true; orders: ShopifyOrderNode[] } | { ok: false; reason: 'auth' | 'network' | 'throttled' | 'graphql' }> {
  const search = `updated_at:>='${args.updatedAtMin.toISOString()}'`;
  const first = args.pageSize ?? 50;
  const orders: ShopifyOrderNode[] = [];
  let after: string | null = null;

  for (let page = 0; page < 40; page += 1) {
    let result = await shopifyGraphql({
      shopDomain: args.shopDomain,
      accessToken: args.accessToken,
      query: ORDERS_SINCE_QUERY,
      variables: { first, after, search },
      fetchImpl: args.fetchImpl,
    });
    if (!result.ok && result.reason === 'throttled') {
      await sleep(THROTTLE_RETRY_DELAY_MS);
      result = await shopifyGraphql({
        shopDomain: args.shopDomain,
        accessToken: args.accessToken,
        query: ORDERS_SINCE_QUERY,
        variables: { first, after, search },
        fetchImpl: args.fetchImpl,
      });
    }
    if (!result.ok) return { ok: false, reason: result.reason };

    const connection = result.data.orders as {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: ShopifyOrderNode[];
    };
    orders.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) return { ok: true, orders };
    after = connection.pageInfo.endCursor;
  }
  // 40 pages x 50 = 2000 orders in one tick — treat as done; the next tick continues.
  return { ok: true, orders };
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm run test:shopify-order-normalization`
Expected: `PASS shopify order normalization`.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/connectors/store/shopify.ts scripts/shopify-order-normalization-test.ts
git commit -m "feat(shopify-connect): GraphQL verify + forward-only order fetch with throttle retry"
```

---

### Task 4: `shopify-order-sync` service + `SHOPIFY_SYNC_ENABLED` env flag

**Files:**
- Create: `src/services/shopify-order-sync.ts`
- Modify: `src/lib/env.ts` (add one flag next to the other feature flags, e.g. after `RETURNS_SHOPIFY_DELIVERY`)

**Interfaces:**
- Consumes: Task 2/3 connector exports; `upsertNormalizedStoreOrders` from `src/services/store-order-import.ts`; `db` from `src/db/client.ts`; `env` from `src/lib/env.ts`.
- Produces (used by Tasks 6, 9, 13): `syncShopifyOrders(opts?: { fetchImpl?: ShopifyFetch }): Promise<{ accounts: number; synced: number; errors: number }>`

- [ ] **Step 1: Add the env flag**

In `src/lib/env.ts`, directly below the `RETURNS_SHOPIFY_DELIVERY: booleanFlag(false),` line, add:

```ts
  // Shopify direct client store connect — master switch for the order-sync
  // poller. Off by default so deploy != activate.
  SHOPIFY_SYNC_ENABLED: booleanFlag(false),
```

- [ ] **Step 2: Create the sync service**

Create `src/services/shopify-order-sync.ts`:

```ts
// Shopify direct order sync (spec docs/superpowers/specs/2026-07-08-*.md).
// Orchestration only — the connector owns Shopify API calls + normalization.
//
// SECURITY SPINE: this service may only read store_accounts rows where
// source = 'admin' AND active = true. Portal-submitted rows (source='portal',
// active=false) are invisible here until an operator promotes them.
// Pinned by scripts/shopify-sync-source-guard.mjs.
import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { env } from '../lib/env';
import {
  fetchShopifyOrdersSince,
  normalizeShopifyOrder,
  normalizeShopDomain,
  type ShopifyFetch,
  type ShopifyOrderNode,
} from '../connectors/store/shopify';
import { upsertNormalizedStoreOrders, type NormalizedStoreOrder } from './store-order-import';

const AUTH_PAUSE_THRESHOLD = 3;

type ShopifyAccountRow = {
  id: number;
  clientId: number | null;
  accountIdentifier: string | null;
  credentials: Record<string, unknown> | null;
  syncAnchorAt: Date | string;
  syncCursorAt: Date | string | null;
};

function toDate(value: Date | string | null): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

async function loadActiveShopifyAccounts(): Promise<ShopifyAccountRow[]> {
  const rows = await db.execute<ShopifyAccountRow>(sql`
    select id,
           client_id as "clientId",
           account_identifier as "accountIdentifier",
           credentials,
           sync_anchor_at as "syncAnchorAt",
           sync_cursor_at as "syncCursorAt"
    from store_accounts
    where provider = 'shopify'
      and source = 'admin'
      and active = true
      and sync_anchor_at is not null
      and not (coalesce(last_sync_error, '') = 'auth' and sync_failure_count >= ${AUTH_PAUSE_THRESHOLD})
    order by id
  `);
  return rows;
}

async function recordSuccess(accountId: number, cursor: Date): Promise<void> {
  await db.execute(sql`
    update store_accounts
    set sync_cursor_at = ${cursor.toISOString()}::timestamptz,
        last_synced_at = now(),
        last_sync_error = null,
        sync_failure_count = 0,
        updated_at = now()
    where id = ${accountId}
  `);
}

async function recordFailure(accountId: number, reason: string): Promise<void> {
  await db.execute(sql`
    update store_accounts
    set last_sync_error = ${reason},
        sync_failure_count = case when ${reason} = 'auth' then sync_failure_count + 1 else sync_failure_count end,
        updated_at = now()
    where id = ${accountId}
  `);
}

async function syncOneAccount(
  account: ShopifyAccountRow,
  fetchImpl: ShopifyFetch | undefined,
): Promise<number> {
  const credentials = (account.credentials ?? {}) as { shopDomain?: unknown; accessToken?: unknown };
  const shopDomain =
    normalizeShopDomain(String(account.accountIdentifier ?? '')) ??
    normalizeShopDomain(String(credentials.shopDomain ?? ''));
  const accessToken = typeof credentials.accessToken === 'string' ? credentials.accessToken : '';
  const anchor = toDate(account.syncAnchorAt);
  if (!shopDomain || !accessToken || !anchor) {
    await recordFailure(account.id, 'misconfigured');
    return 0;
  }
  if (account.clientId == null) {
    // Attribution is the whole point — never import unattributed orders.
    await recordFailure(account.id, 'no-client');
    return 0;
  }

  const updatedAtMin = toDate(account.syncCursorAt) ?? anchor;
  const fetched = await fetchShopifyOrdersSince({ shopDomain, accessToken, updatedAtMin, fetchImpl });
  if (!fetched.ok) {
    await recordFailure(account.id, fetched.reason);
    return 0;
  }

  const normalized: NormalizedStoreOrder[] = [];
  let maxUpdatedAt = updatedAtMin;
  for (const node of fetched.orders as ShopifyOrderNode[]) {
    const updatedAt = toDate(node.updatedAt);
    if (updatedAt && updatedAt > maxUpdatedAt) maxUpdatedAt = updatedAt;
    try {
      const order = normalizeShopifyOrder(node, {
        accountId: account.id,
        clientId: account.clientId,
        anchor,
      });
      if (order) normalized.push(order);
    } catch (err) {
      // One malformed order never aborts the batch.
      console.warn(
        `[shopify-sync] account ${account.id}: skipping malformed order ${node?.legacyResourceId ?? '?'}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const synced = normalized.length ? await upsertNormalizedStoreOrders(normalized) : 0;
  // Cursor only advances after the batch is fully persisted (crash-safe: a
  // re-run of the same window is an idempotent upsert).
  await recordSuccess(account.id, maxUpdatedAt);
  return synced;
}

export async function syncShopifyOrders(
  opts: { fetchImpl?: ShopifyFetch } = {},
): Promise<{ accounts: number; synced: number; errors: number }> {
  if (!env.SHOPIFY_SYNC_ENABLED) return { accounts: 0, synced: 0, errors: 0 };

  const accounts = await loadActiveShopifyAccounts();
  let synced = 0;
  let errors = 0;
  for (const account of accounts) {
    try {
      synced += await syncOneAccount(account, opts.fetchImpl);
    } catch (err) {
      // Per-account isolation: one broken store never blocks the others.
      errors += 1;
      console.error(
        `[shopify-sync] account ${account.id} failed:`,
        err instanceof Error ? err.message : err,
      );
      await recordFailure(account.id, 'internal').catch(() => undefined);
    }
  }
  return { accounts: accounts.length, synced, errors };
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/services/shopify-order-sync.ts src/lib/env.ts
git commit -m "feat(shopify-connect): forward-only shopify order sync service behind SHOPIFY_SYNC_ENABLED"
```

---

### Task 5: Promotion = activation + anchor stamp

Promotion today (`PATCH /api/store-accounts?id=N` → `patchCredentialAccount`) flips `source` only — **nothing ever sets `active=true`**, so a promoted store would never sync. Close the gap: for `store_accounts`, promoting to `'admin'` also activates and stamps the forward-only anchor (idempotently).

**Files:**
- Modify: `src/services/credential-accounts.ts:230-275` (`patchCredentialAccount`)

**Interfaces:**
- Consumes: `CredentialAccountPatchInput` (unchanged — no API surface change).
- Produces: promotion semantics used by Tasks 6, 8, 13. Anchor stamp SQL fragment `sync_anchor_at = COALESCE(sync_anchor_at, NOW())` is pinned by the Task 6 guard.

- [ ] **Step 1: Replace the two source-updating branches**

In `patchCredentialAccount`, replace the `if (patch.hasSource && patch.hasLabel)` block with:

```ts
  // store_accounts promotion to 'admin' IS the operator approval: it
  // activates the account and stamps the forward-only sync anchor exactly
  // once (COALESCE keeps re-promotion from moving the anchor).
  const promotesStore = table === 'store_accounts' && patch.hasSource && patch.source === 'admin';

  if (patch.hasSource && patch.hasLabel) {
    if (promotesStore) {
      const rows = (await sql`
        UPDATE ${sql(table)}
        SET source = ${patch.source},
            label = ${patch.labelGoesNull ? null : patch.label},
            active = true,
            sync_anchor_at = COALESCE(sync_anchor_at, NOW()),
            updated_at = NOW()
        WHERE id = ${id}
        RETURNING id, client_id AS "clientId", provider, label,
                  account_identifier AS "accountIdentifier",
                  source, active, created_at AS "createdAt"
      `) as CredentialAccountRow[];
      return rows[0] ?? null;
    }
    const rows = (await sql`
      UPDATE ${sql(table)}
      SET source = ${patch.source},
          label = ${patch.labelGoesNull ? null : patch.label},
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, client_id AS "clientId", provider, label,
                account_identifier AS "accountIdentifier",
                source, active, created_at AS "createdAt"
    `) as CredentialAccountRow[];
    return rows[0] ?? null;
  }
```

and replace the `if (patch.hasSource)` block with:

```ts
  if (patch.hasSource) {
    if (promotesStore) {
      const rows = (await sql`
        UPDATE ${sql(table)}
        SET source = ${patch.source},
            active = true,
            sync_anchor_at = COALESCE(sync_anchor_at, NOW()),
            updated_at = NOW()
        WHERE id = ${id}
        RETURNING id, client_id AS "clientId", provider, label,
                  account_identifier AS "accountIdentifier",
                  source, active, created_at AS "createdAt"
      `) as CredentialAccountRow[];
      return rows[0] ?? null;
    }
    const rows = (await sql`
      UPDATE ${sql(table)}
      SET source = ${patch.source}, updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, client_id AS "clientId", provider, label,
                account_identifier AS "accountIdentifier",
                source, active, created_at AS "createdAt"
    `) as CredentialAccountRow[];
    return rows[0] ?? null;
  }
```

(The `hasLabel`-only branch and the trailing `return null` stay unchanged. Note: demoting `'admin' → 'portal'` intentionally does NOT deactivate — deactivation stays a manual DB/admin operation; only promotion gains side effects.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/services/credential-accounts.ts
git commit -m "feat(shopify-connect): store-account promotion activates + stamps forward-only sync anchor"
```

---

### Task 6: Static guard — sync source pins

**Files:**
- Create: `scripts/shopify-sync-source-guard.mjs`
- Modify: `package.json` (add `"guard:shopify-sync-source": "node scripts/shopify-sync-source-guard.mjs"`)

**Interfaces:**
- Consumes: source text of Tasks 1-5 files.
- Produces: auto-runs in `npm run test:guards` (name matches `^guard:` and misses the DENY regex).

- [ ] **Step 1: Write the guard (it should PASS immediately — it pins Tasks 1-5)**

Create `scripts/shopify-sync-source-guard.mjs`:

```js
// Pins the Shopify sync security spine (spec 2026-07-08):
//  - sync reads ONLY source='admin' AND active=true store_accounts
//  - forward-only anchor + cursor columns exist in the migration
//  - promotion stamps the anchor idempotently and activates
//  - the poller is gated behind SHOPIFY_SYNC_ENABLED
// CRLF-tolerant: substring checks only, no end-of-line anchors.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const syncSrc = readFileSync('src/services/shopify-order-sync.ts', 'utf8');
assert(syncSrc.includes("source = 'admin'"), 'shopify sync must filter source=admin');
assert(syncSrc.includes('active = true'), 'shopify sync must filter active=true');
assert(syncSrc.includes('sync_anchor_at is not null'), 'shopify sync must require a stamped anchor');
assert(syncSrc.includes('SHOPIFY_SYNC_ENABLED'), 'shopify sync must be flag-gated');
assert(syncSrc.includes('sync_failure_count'), 'shopify sync must track consecutive auth failures');

const migration = readFileSync('drizzle/0037_store_account_sync_state.sql', 'utf8');
for (const col of ['sync_anchor_at', 'sync_cursor_at', 'last_synced_at', 'last_sync_error', 'sync_failure_count']) {
  assert(migration.includes(col), `migration 0037 missing column ${col}`);
}

const credSrc = readFileSync('src/services/credential-accounts.ts', 'utf8');
assert(
  credSrc.includes('sync_anchor_at = COALESCE(sync_anchor_at, NOW())'),
  'store-account promotion must stamp the sync anchor idempotently',
);
assert(
  credSrc.includes("table === 'store_accounts' && patch.hasSource && patch.source === 'admin'"),
  'promotion side effects must be scoped to store_accounts admin promotion',
);

const connectorSrc = readFileSync('src/connectors/store/shopify.ts', 'utf8');
assert(connectorSrc.includes("SHOPIFY_ADMIN_API_VERSION = '2026-04'"), 'Shopify API version must stay pinned');
assert(connectorSrc.includes('X-Shopify-Access-Token'), 'connector must use token header auth');

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
assert(
  pkg.scripts?.['guard:shopify-sync-source'] === 'node scripts/shopify-sync-source-guard.mjs',
  'package.json must expose guard:shopify-sync-source',
);
assert(
  pkg.scripts?.['test:shopify-order-normalization'] === 'tsx scripts/shopify-order-normalization-test.ts',
  'package.json must expose test:shopify-order-normalization',
);
console.log('PASS shopify sync source guard');
```

- [ ] **Step 2: Register and run**

Add to `package.json` scripts:

```json
"guard:shopify-sync-source": "node scripts/shopify-sync-source-guard.mjs",
```

Run: `npm run guard:shopify-sync-source`
Expected: `PASS shopify sync source guard`.

Run: `npm run test:guards`
Expected: all guards pass including the two new scripts.

- [ ] **Step 3: Commit**

```bash
git add scripts/shopify-sync-source-guard.mjs package.json
git commit -m "guard(shopify-connect): pin sync source filter, anchor stamp, and API version"
```

---

### Task 7: Portal API — submit unlock, live validation, reconnect

**Files:**
- Create: `src/lib/client-portal/integration-submission.ts` (pure helpers: client attribution + rate limiter — unit-testable without Hono)
- Modify: `src/routes/client-portal/integrations.ts`
- Modify: `scripts/shopify-order-normalization-test.ts` (append helper tests)

**Interfaces:**
- Consumes: `verifyShopifyCredentials`, `normalizeShopDomain` (Task 3); existing route utilities (`scopeOrResponse`, `isClientPortalScope`, `recordPortalAudit`, `normalizeCredentialAccountBody`, `toPortalIntegrationDto`, `isAdminEmail`).
- Produces (used by Tasks 8, 11, 12, 13):
  - `resolveSubmittedClientId(args: { isAdmin: boolean; clientIds: number[]; bodyClientId: number | null }): { ok: true; clientId: number | null } | { ok: false; status: 400 | 403; error: string }`
  - `checkValidationRateLimit(userId: string, now?: number): boolean` (true = allowed; 5/min/user)
  - Routes: `POST /api/client-portal/integrations/validate`, `PATCH /api/client-portal/integrations/:id/credentials`, and the unlocked `POST /api/client-portal/integrations`.

- [ ] **Step 1: Write failing tests for the pure helpers**

Append to `scripts/shopify-order-normalization-test.ts`:

```ts
// ── portal submission helpers ──
import {
  resolveSubmittedClientId,
  checkValidationRateLimit,
} from '../src/lib/client-portal/integration-submission';

// Admins keep today's behavior: body clientId passes through (nullable).
assert.deepEqual(
  resolveSubmittedClientId({ isAdmin: true, clientIds: [], bodyClientId: 12 }),
  { ok: true, clientId: 12 },
);
assert.deepEqual(
  resolveSubmittedClientId({ isAdmin: true, clientIds: [], bodyClientId: null }),
  { ok: true, clientId: null },
);
// Clients are FORCED to their own scope.
assert.deepEqual(
  resolveSubmittedClientId({ isAdmin: false, clientIds: [7], bodyClientId: null }),
  { ok: true, clientId: 7 },
);
assert.deepEqual(
  resolveSubmittedClientId({ isAdmin: false, clientIds: [7, 9], bodyClientId: 9 }),
  { ok: true, clientId: 9 },
);
const crossClient = resolveSubmittedClientId({ isAdmin: false, clientIds: [7], bodyClientId: 12 });
assert.ok(!crossClient.ok && crossClient.status === 403, 'cross-client injection is rejected');
const noScope = resolveSubmittedClientId({ isAdmin: false, clientIds: [], bodyClientId: null });
assert.ok(!noScope.ok && noScope.status === 403, 'no client scope -> 403');
const ambiguous = resolveSubmittedClientId({ isAdmin: false, clientIds: [7, 9], bodyClientId: null });
assert.ok(!ambiguous.ok && ambiguous.status === 400, 'multi-client scope requires explicit clientId');

// Rate limiter: 5 allowed per rolling minute, 6th refused, new window resets.
const T0 = 1_750_000_000_000;
for (let i = 0; i < 5; i += 1) {
  assert.equal(checkValidationRateLimit('user-a', T0 + i * 1000), true, `attempt ${i + 1} allowed`);
}
assert.equal(checkValidationRateLimit('user-a', T0 + 5_000), false, '6th attempt inside window refused');
assert.equal(checkValidationRateLimit('user-b', T0 + 5_000), true, 'other users unaffected');
assert.equal(checkValidationRateLimit('user-a', T0 + 61_000), true, 'window reset re-allows');
```

Run: `npm run test:shopify-order-normalization`
Expected: FAIL — cannot find module `../src/lib/client-portal/integration-submission`.

- [ ] **Step 2: Implement the pure helpers**

Create `src/lib/client-portal/integration-submission.ts`:

```ts
// Pure helpers for the portal store-connect flow (spec 2026-07-08).
// Kept Hono-free so the guard-suite test can exercise them directly.

/**
 * Client attribution for portal store submissions. Admins keep the legacy
 * pass-through; everyone else is FORCED into their own client scope — a
 * spoofed body clientId can never attach a store to another client.
 */
export function resolveSubmittedClientId(args: {
  isAdmin: boolean;
  clientIds: number[];
  bodyClientId: number | null;
}): { ok: true; clientId: number | null } | { ok: false; status: 400 | 403; error: string } {
  if (args.isAdmin) return { ok: true, clientId: args.bodyClientId };
  if (!args.clientIds.length) {
    return { ok: false, status: 403, error: 'your account has no client scope' };
  }
  if (args.bodyClientId != null) {
    return args.clientIds.includes(args.bodyClientId)
      ? { ok: true, clientId: args.bodyClientId }
      : { ok: false, status: 403, error: 'client not in your scope' };
  }
  if (args.clientIds.length === 1) return { ok: true, clientId: args.clientIds[0]! };
  return { ok: false, status: 400, error: 'clientId required when your scope spans multiple clients' };
}

const VALIDATION_WINDOW_MS = 60_000;
const VALIDATION_MAX_ATTEMPTS = 5;
const validationAttempts = new Map<string, { count: number; windowStart: number }>();

/**
 * In-memory per-user limiter for the live credential check (5/min) so the
 * endpoint can't be used as a token-probing oracle. Same pattern as the
 * label-creation limiter in src/services/labels.ts.
 */
export function checkValidationRateLimit(userId: string, now: number = Date.now()): boolean {
  const entry = validationAttempts.get(userId);
  if (!entry || now - entry.windowStart >= VALIDATION_WINDOW_MS) {
    validationAttempts.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= VALIDATION_MAX_ATTEMPTS) return false;
  entry.count += 1;
  return true;
}
```

Run: `npm run test:shopify-order-normalization`
Expected: `PASS shopify order normalization`.

- [ ] **Step 3: Rewrite the integrations route**

Replace the full contents of `src/routes/client-portal/integrations.ts` with:

```ts
// Client-portal sub-router — extracted from the former single-file
// src/routes/client-portal.ts. Mounted at '/' by that file (now a thin
// aggregator), so these relative paths keep their /api/client-portal/* surface.
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { isAdminEmail } from '../../lib/admin-emails';
import { CREDENTIAL_PROVIDER_PATTERN, maskAccountIdentifier, normalizeCredentialAccountBody } from '../../lib/credential-accounts';
import { recordPortalAudit } from '../../lib/client-portal/audit';
import { isClientPortalScope } from '../../lib/client-portal/scope';
import { toPortalIntegrationDto } from '../../lib/client-portal/dto';
import { listPortalIntegrations } from '../../lib/client-portal/read-models/integrations';
import { scopeOrResponse } from '../../lib/client-portal/query-params';
import {
  checkValidationRateLimit,
  resolveSubmittedClientId,
} from '../../lib/client-portal/integration-submission';
import { verifyShopifyCredentials } from '../../connectors/store/shopify';

const app = new Hono();

// One generic connect-failure message: never reveal shop-exists vs
// token-wrong (no token-probing oracle). Details go to server logs only.
const SHOPIFY_CONNECT_ERROR =
  "Couldn't connect — check your shop domain and Admin API access token.";

app.get('/integrations', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const { data, carrierCount, storeCount } = await listPortalIntegrations(scope);
  await recordPortalAudit('portal.integrations.list', scope, { carriers: carrierCount, stores: storeCount });
  return c.json({ data });
});

// Live credential check for pre-submit UX feedback ONLY — nothing from the
// browser is trusted at submit time (submit re-verifies server-side).
// Rate-limited per user; response carries shop name/domain and NOTHING else.
app.post('/integrations/validate', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!checkValidationRateLimit(scope.userId)) {
    return c.json({ error: 'too many validation attempts — wait a minute and retry' }, 429);
  }

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  const provider = String(body?.provider ?? '').toLowerCase();
  if (provider !== 'shopify') {
    return c.json({ error: 'live validation is only available for shopify' }, 400);
  }
  const credentials =
    body?.credentials && typeof body.credentials === 'object' && !Array.isArray(body.credentials)
      ? (body.credentials as Record<string, unknown>)
      : {};
  const shopDomain = String(credentials.shopDomain ?? '');
  const accessToken = String(credentials.accessToken ?? '');
  if (!shopDomain.trim() || !accessToken.trim()) {
    return c.json({ error: SHOPIFY_CONNECT_ERROR }, 422);
  }

  const result = await verifyShopifyCredentials({ shopDomain, accessToken });
  await recordPortalAudit('portal.integrations.validate', scope, {
    provider,
    ok: result.ok,
    accountIdentifier: result.ok ? maskAccountIdentifier(result.myshopifyDomain) : null,
  });
  if (!result.ok) return c.json({ error: SHOPIFY_CONNECT_ERROR }, 422);
  return c.json({ data: { ok: true, shopName: result.shopName, myshopifyDomain: result.myshopifyDomain } });
});

// Submit a store connection from the portal (M7, unlocked for client users
// 2026-07-08). The account is created with source='portal' AND active=false,
// so no sync/worker path can use the submitted credentials until an operator
// vets and promotes it ('portal' -> 'admin') in the internal app. Credentials
// are stored via the same store_accounts rails as the internal API
// (RLS-protected) and are NEVER echoed back in the response or audit trail —
// field names only. Non-admin callers are FORCED into their own client scope.
app.post('/integrations', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const isAdmin = isAdminEmail(scope.email) || scope.role === 'admin';

  let rawBody: Record<string, unknown>;
  try {
    rawBody = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  const account = normalizeCredentialAccountBody(rawBody, 'portal');
  // Portal submissions can never claim admin provenance, whatever the body says.
  account.source = 'portal';
  if (!CREDENTIAL_PROVIDER_PATTERN.test(account.provider)) {
    return c.json({ error: 'invalid provider' }, 400);
  }
  if (!account.label?.trim()) return c.json({ error: 'store name required' }, 400);
  if (!account.credentialKeys.length) return c.json({ error: 'credentials required' }, 400);
  if (JSON.stringify(account.credentials).length > 20_000) {
    return c.json({ error: 'credentials too large' }, 400);
  }

  const attribution = resolveSubmittedClientId({
    isAdmin,
    clientIds: scope.clientIds,
    bodyClientId: account.clientId,
  });
  if (!attribution.ok) return c.json({ error: attribution.error }, attribution.status);
  account.clientId = attribution.clientId;

  // Shopify submits re-verify server-side; the canonical myshopify domain
  // ALWAYS comes from Shopify's answer, never from the browser.
  if (account.provider === 'shopify') {
    const shopDomain = String((account.credentials as Record<string, unknown>).shopDomain ?? '');
    const accessToken = String((account.credentials as Record<string, unknown>).accessToken ?? '');
    const verified = await verifyShopifyCredentials({ shopDomain, accessToken });
    if (!verified.ok) return c.json({ error: SHOPIFY_CONNECT_ERROR }, 422);
    account.accountIdentifier = verified.myshopifyDomain;
  }

  try {
    // Plain INSERT (not the shared upsert): ON CONFLICT DO NOTHING so a portal
    // submission can never overwrite the credentials of an existing live
    // account with the same client/provider/identifier — duplicates get a 409.
    const rows = await db.execute<{
      id: number;
      clientId: number | null;
      provider: string | null;
      label: string | null;
      accountIdentifier: string | null;
      source: string | null;
      active: boolean | null;
      createdAt: Date | string | null;
      updatedAt: Date | string | null;
    }>(sql`
      insert into store_accounts (client_id, provider, label, account_identifier, credentials, source, active)
      values (
        ${account.clientId},
        ${account.provider},
        ${account.label},
        ${account.accountIdentifier},
        ${JSON.stringify(account.credentials)}::jsonb,
        'portal',
        false
      )
      on conflict (coalesce(client_id, -1), provider, coalesce(account_identifier, '')) do nothing
      returning id,
                client_id as "clientId",
                provider,
                label,
                account_identifier as "accountIdentifier",
                source,
                active,
                created_at as "createdAt",
                updated_at as "updatedAt"
    `);
    const row = rows[0];
    if (!row) {
      return c.json({ error: 'A connection for this store already exists.' }, 409);
    }
    await recordPortalAudit('portal.integrations.request', scope, {
      provider: account.provider,
      clientId: account.clientId,
      accountIdentifier: maskAccountIdentifier(account.accountIdentifier),
      credentialFields: account.credentialKeys,
    });
    return c.json({ data: toPortalIntegrationDto({ ...row, type: 'store' }) }, 201);
  } catch (err) {
    console.warn('[client-portal] store connection request failed:', err);
    return c.json({ error: 'store connections are unavailable right now' }, 503);
  }
});

// Reconnect: replace the credentials on the caller's OWN shopify store after
// its token was revoked (last_sync_error='auth'). The new credentials must
// pass live verification for the SAME canonical shop domain. source/active are
// untouched — a promoted store stays promoted; sync resumes next tick.
app.patch('/integrations/:id/credentials', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'invalid id' }, 400);
  if (!checkValidationRateLimit(scope.userId)) {
    return c.json({ error: 'too many validation attempts — wait a minute and retry' }, 429);
  }

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  const credentials =
    body?.credentials && typeof body.credentials === 'object' && !Array.isArray(body.credentials)
      ? (body.credentials as Record<string, unknown>)
      : {};
  const accessToken = String(credentials.accessToken ?? '');
  if (!accessToken.trim()) return c.json({ error: 'credentials required' }, 400);

  const isAdmin = isAdminEmail(scope.email) || scope.role === 'admin';
  const rows = await db.execute<{
    id: number;
    clientId: number | null;
    provider: string | null;
    accountIdentifier: string | null;
    lastSyncError: string | null;
  }>(sql`
    select id, client_id as "clientId", provider,
           account_identifier as "accountIdentifier",
           last_sync_error as "lastSyncError"
    from store_accounts
    where id = ${id}
  `);
  const row = rows[0];
  if (!row || row.provider !== 'shopify') return c.json({ error: 'store not found' }, 404);
  if (!isAdmin && (row.clientId == null || !scope.clientIds.includes(row.clientId))) {
    return c.json({ error: 'store not found' }, 404);
  }
  if (row.lastSyncError !== 'auth') {
    return c.json({ error: 'this store does not need reconnection' }, 409);
  }

  const verified = await verifyShopifyCredentials({
    shopDomain: String(row.accountIdentifier ?? ''),
    accessToken,
  });
  if (!verified.ok || verified.myshopifyDomain !== row.accountIdentifier) {
    return c.json({ error: SHOPIFY_CONNECT_ERROR }, 422);
  }

  await db.execute(sql`
    update store_accounts
    set credentials = jsonb_build_object(
          'shopDomain', ${verified.myshopifyDomain}::text,
          'accessToken', ${accessToken}::text
        ),
        last_sync_error = null,
        sync_failure_count = 0,
        updated_at = now()
    where id = ${id}
  `);
  await recordPortalAudit('portal.integrations.reconnect', scope, {
    provider: 'shopify',
    clientId: row.clientId,
    accountIdentifier: maskAccountIdentifier(row.accountIdentifier),
    credentialFields: ['accessToken', 'shopDomain'],
  });
  return c.json({ data: { ok: true } });
});

export default app;
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm run test:shopify-order-normalization`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/client-portal/integration-submission.ts src/routes/client-portal/integrations.ts scripts/shopify-order-normalization-test.ts
git commit -m "feat(shopify-connect): portal submit unlock + live validation + reconnect endpoint"
```

---

### Task 8: Static guard — portal store-connect safety pins

**Files:**
- Create: `scripts/portal-store-connect-guard.mjs`
- Modify: `package.json` (add `"guard:portal-store-connect": "node scripts/portal-store-connect-guard.mjs"`)

**Interfaces:**
- Consumes: source text of Task 7 files.
- Produces: auto-runs in `npm run test:guards`.

- [ ] **Step 1: Write the guard**

Create `scripts/portal-store-connect-guard.mjs`:

```js
// Pins the portal store-connect trust boundary (spec 2026-07-08):
//  - portal submissions stay source='portal', active=false
//  - non-admin clientId is forced from scope (resolveSubmittedClientId)
//  - shopify canonical domain is derived server-side at submit
//  - validate/reconnect are rate-limited and never echo credentials
// CRLF-tolerant: substring checks only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync('src/routes/client-portal/integrations.ts', 'utf8');
assert(route.includes("account.source = 'portal'"), 'portal submit must force source=portal');
assert(route.includes("'portal',\n        false"), 'portal submit must insert active=false');
assert(route.includes('resolveSubmittedClientId'), 'portal submit must force clientId from scope');
assert(route.includes('checkValidationRateLimit'), 'validate/reconnect must be rate-limited');
assert(route.includes('verified.myshopifyDomain'), 'shopify identifier must come from live verification');
assert(!route.includes('accessToken:'), 'route must never build a response containing a token');
assert(route.includes('credentialFields'), 'audit rows record credential field NAMES only');
assert(!route.includes('admin required'), 'submit endpoint must be open to client users');

const helpers = readFileSync('src/lib/client-portal/integration-submission.ts', 'utf8');
assert(helpers.includes('clientIds.includes(args.bodyClientId)'), 'cross-client injection check must exist');
assert(helpers.includes('VALIDATION_MAX_ATTEMPTS = 5'), 'validation limiter is 5 attempts/window');

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
assert(
  pkg.scripts?.['guard:portal-store-connect'] === 'node scripts/portal-store-connect-guard.mjs',
  'package.json must expose guard:portal-store-connect',
);
console.log('PASS portal store connect guard');
```

- [ ] **Step 2: Register + run**

Add to `package.json` scripts:

```json
"guard:portal-store-connect": "node scripts/portal-store-connect-guard.mjs",
```

Run: `npm run guard:portal-store-connect`
Expected: `PASS portal store connect guard`.

Run: `npm run test:guards`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add scripts/portal-store-connect-guard.mjs package.json
git commit -m "guard(shopify-connect): pin portal submit trust boundary"
```

---

### Task 9: Scheduler + cron wiring

**Files:**
- Modify: `src/services/sync-scheduler.ts` (mirror the `runShipmentSync` pattern at lines ~167-187 and its scheduling at ~377-383; add cleanup in `stopSyncScheduler`)
- Modify: `src/routes/cron.ts` (new secret-gated endpoint)

**Interfaces:**
- Consumes: `syncShopifyOrders` (Task 4), `env.SHOPIFY_SYNC_ENABLED`, existing `runHeavySchedulerJob`.
- Produces: in-process tick every 3 min (staggered +45s) + `POST /api/cron/sync-shopify-orders` safety net.

- [ ] **Step 1: Add the scheduler tick**

In `src/services/sync-scheduler.ts`:

(a) Import at top alongside the other service imports:

```ts
import { syncShopifyOrders } from './shopify-order-sync';
```

(b) Next to the other interval constants (near `ORDER_SYNC_INTERVAL_MS`):

```ts
const SHOPIFY_SYNC_INTERVAL_MS = 3 * 60 * 1000;
const SHOPIFY_SYNC_STAGGER_MS = 45 * 1000;
```

(c) Next to the other running-flags/timer handles:

```ts
let shopifySyncRunning = false;
let shopifyTimer: ReturnType<typeof setInterval> | null = null;
```

(d) Below `runOrderSync` add the wrapper (same shape):

```ts
export async function runShopifySync(): Promise<void> {
  if (!env.SHOPIFY_SYNC_ENABLED) return;
  if (shopifySyncRunning) {
    console.log('[scheduler] shopify sync already running — skipping tick');
    return;
  }
  shopifySyncRunning = true;
  try {
    const result = await runHeavySchedulerJob('shopify orders sync', () => syncShopifyOrders({}));
    if (!result) return;
    console.log(
      `[scheduler] shopify orders synced: ${result.synced} rows across ${result.accounts} store(s), ${result.errors} error(s)`,
    );
  } catch (err) {
    console.error('[scheduler] shopify sync failed:', err instanceof Error ? err.message : err);
  } finally {
    shopifySyncRunning = false;
  }
}
```

(e) In `startSyncScheduler`, after the existing order-sync kickoff block (`setTimeout(... runOrderSync ...)`), add — NOTE: unlike the ShipStation block this is NOT inside the `SHIPSTATION_API_KEY` gate; place it after that gated block so Shopify sync runs even without ShipStation configured:

```ts
  if (env.SHOPIFY_SYNC_ENABLED) {
    setTimeout(() => {
      void runShopifySync();
      shopifyTimer = setInterval(() => void runShopifySync(), SHOPIFY_SYNC_INTERVAL_MS);
    }, STARTUP_DELAY_MS + SHOPIFY_SYNC_STAGGER_MS);
  }
```

(f) In `stopSyncScheduler`, alongside the other `clearInterval` calls:

```ts
  if (shopifyTimer) {
    clearInterval(shopifyTimer);
    shopifyTimer = null;
  }
```

- [ ] **Step 2: Add the cron safety-net endpoint**

In `src/routes/cron.ts`, import `syncShopifyOrders` next to the other sync imports and add below the `/sync-shipments` handlers:

```ts
app.post('/sync-shopify-orders', async (c) => {
  const result = await syncShopifyOrders({});
  return c.json(result);
});
```

- [ ] **Step 3: Typecheck + guards**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run test:guards`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/services/sync-scheduler.ts src/routes/cron.ts
git commit -m "feat(shopify-connect): schedule shopify order sync + cron safety net"
```

---

### Task 10: Read-model + DTO expose sync status (backward-safe)

**Files:**
- Modify: `src/lib/client-portal/read-models/integrations.ts` (`storeAccountRows`)
- Modify: `src/lib/client-portal/dto.ts` (`toPortalIntegrationDto`, lines 449-481)

**Interfaces:**
- Consumes: migration 0037 columns.
- Produces (used by Tasks 11, 12): DTO gains `lastSyncError: string | null`, `lastSyncedAt: string | null`.

- [ ] **Step 1: Extend the store select — with a fallback for un-migrated DBs**

In `storeAccountRows` (`src/lib/client-portal/read-models/integrations.ts:24-57`), replace the body of the `try` block's SQL with a two-attempt select — new columns first, legacy shape on failure (the existing outer `try/catch` already degrades to `[]`; we add a middle tier so a missing 0037 migration doesn't hide stores):

```ts
async function storeAccountRows(scope: ClientPortalScope) {
  type StoreRow = {
    id: number;
    clientId: number | null;
    provider: string | null;
    label: string | null;
    accountIdentifier: string | null;
    source: string | null;
    active: boolean | null;
    createdAt: Date | string | null;
    updatedAt: Date | string | null;
    lastSyncError?: string | null;
    lastSyncedAt?: Date | string | null;
  };
  const scopeFilter = scope.isRestricted && scope.clientIds.length
    ? sql`and client_id in (${sql.join(scope.clientIds.map((id) => sql`${id}`), sql`, `)})`
    : sql``;
  try {
    let rows: StoreRow[];
    try {
      rows = await db.execute<StoreRow>(sql`
        select id,
               client_id as "clientId",
               provider,
               label,
               account_identifier as "accountIdentifier",
               source,
               active,
               created_at as "createdAt",
               updated_at as "updatedAt",
               last_sync_error as "lastSyncError",
               last_synced_at as "lastSyncedAt"
        from store_accounts
        where (coalesce(active, true) = true or source = 'portal')
          ${scopeFilter}
        order by created_at desc
        limit 200
      `);
    } catch {
      // Deployment predates migration 0037 — fall back to the legacy shape.
      rows = await db.execute<StoreRow>(sql`
        select id,
               client_id as "clientId",
               provider,
               label,
               account_identifier as "accountIdentifier",
               source,
               active,
               created_at as "createdAt",
               updated_at as "updatedAt"
        from store_accounts
        where (coalesce(active, true) = true or source = 'portal')
          ${scopeFilter}
        order by created_at desc
        limit 200
      `);
    }
    return rows.map((row) => toPortalIntegrationDto({ ...row, type: 'store' }));
  } catch (err) {
    console.warn('[client-portal] store account list unavailable:', err);
    return [];
  }
}
```

- [ ] **Step 2: Extend the DTO**

In `toPortalIntegrationDto` (`src/lib/client-portal/dto.ts`), add to the parameter type:

```ts
  lastSyncError?: string | null;
  lastSyncedAt?: Date | string | null;
```

and to the returned object (before the closing brace):

```ts
    lastSyncError: row.lastSyncError ?? null,
    lastSyncedAt: iso(row.lastSyncedAt ?? null),
```

- [ ] **Step 3: Typecheck + guards**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run test:guards`
Expected: all pass (DTO exposes sync status only — no carrier/service/rate identity, so redaction guards stay green).

- [ ] **Step 4: Commit**

```bash
git add src/lib/client-portal/read-models/integrations.ts src/lib/client-portal/dto.ts
git commit -m "feat(shopify-connect): expose store sync status in portal integrations DTO"
```

---

### Task 11: Portal UI — api client + Shopify validation flow in the connect modal

**Files:**
- Modify: `portal-client/src/lib/api.ts` (types + `validateIntegration` + `reconnectIntegration` + `apiPatch` helper if absent)
- Modify: `portal-client/src/components/store/StoreConnectModal.tsx`

**Interfaces:**
- Consumes: Task 7 endpoints; Task 10 DTO fields.
- Produces (used by Task 12):
  - `PortalIntegration` gains `lastSyncError: string | null; lastSyncedAt: string | null;`
  - `IntegrationValidationResult = { ok: boolean; shopName?: string; myshopifyDomain?: string }`
  - `portalApi.validateIntegration(token, body: { provider: string; credentials: Record<string, string> })`
  - `portalApi.reconnectIntegration(token, id: number, credentials: Record<string, string>)`
  - `StoreConnectModal` prop `onValidate?: (draft: ConnectDraft) => Promise<IntegrationValidationResult>`

- [ ] **Step 1: api.ts additions**

Extend the `PortalIntegration` interface (at `portal-client/src/lib/api.ts:426-437`) with:

```ts
  lastSyncError: string | null;
  lastSyncedAt: string | null;
```

Check `portal-client/src/lib/api.ts:109-126` for an existing PATCH helper next to `apiPost`. If one exists, use it and skip this snippet; otherwise add beside `apiPost`:

```ts
const apiPatch = <T>(token: string, path: string, body: unknown) => apiSend<T>('PATCH', token, path, body);
```

Add the result type near `NewIntegrationInput` (~line 442):

```ts
export interface IntegrationValidationResult {
  ok: boolean;
  shopName?: string;
  myshopifyDomain?: string;
}
```

Add inside the `portalApi` object next to `createIntegration` (~line 1145):

```ts
  /** Live pre-submit credential check (Shopify). Rate-limited server-side. */
  validateIntegration: (token: string, body: { provider: string; credentials: Record<string, string> }) =>
    apiPost<{ data: IntegrationValidationResult }>(token, '/api/client-portal/integrations/validate', body),
  /** Replace the token on an auth-broken store connection (reconnect). */
  reconnectIntegration: (token: string, id: number, credentials: Record<string, string>) =>
    apiPatch<{ data: { ok: boolean } }>(token, `/api/client-portal/integrations/${id}/credentials`, { credentials }),
```

- [ ] **Step 2: StoreConnectModal — Shopify guide + validation states**

In `portal-client/src/components/store/StoreConnectModal.tsx`:

(a) Extend the component signature:

```tsx
export function StoreConnectModal({
  open,
  onClose,
  onConnect,
  onValidate,
}: {
  open: boolean;
  onClose: () => void;
  onConnect: (draft: ConnectDraft) => void;
  onValidate?: (draft: ConnectDraft) => Promise<{ ok: boolean; shopName?: string; myshopifyDomain?: string }>;
}) {
```

(b) Add state next to the existing `useState` hooks:

```tsx
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<{ ok: boolean; message: string } | null>(null);
```

Reset both inside the existing `reset()` function (`setValidating(false); setValidation(null);`).

(c) In the credentials stage, when `platform?.id === 'shopify'`, render a token guide above the credential fields (Tailwind, theme tokens, glass style consistent with the modal):

```tsx
{platform?.id === 'shopify' && (
  <div className="rounded-glass border border-white/10 bg-white/5 p-3 text-xs leading-relaxed text-ink/70">
    <p className="font-medium text-ink/90">How to get your Admin API access token</p>
    <ol className="mt-1 list-decimal space-y-0.5 pl-4">
      <li>In Shopify admin: <span className="font-medium">Settings → Apps and sales channels → Develop apps</span></li>
      <li>Create an app (name it e.g. “PrepShip”), open <span className="font-medium">Configure Admin API scopes</span></li>
      <li>Enable <code className="rounded bg-white/10 px-1">read_orders</code> only, then <span className="font-medium">Install app</span></li>
      <li>Copy the <span className="font-medium">Admin API access token</span> (shown once) and paste it below</li>
    </ol>
    <p className="mt-1 flex items-center gap-1 text-ink/50"><ShieldCheck className="h-3.5 w-3.5" /> PrepShip only asks for read-only order access.</p>
  </div>
)}
```

(d) Replace the existing credentials-stage form submit handler (the function currently doing `if (validate()) setStage('review')`) with this async version — for Shopify with `onValidate` present it validates live before advancing to review:

```tsx
async function submitCreds(e: FormEvent) {
  e.preventDefault();
  if (!validate() || !platform) return;
  if (platform.id === 'shopify' && onValidate) {
    setValidating(true);
    setValidation(null);
    try {
      const result = await onValidate({ platform, storeName, values });
      if (!result.ok) {
        setValidation({ ok: false, message: "Couldn't connect — check your shop domain and Admin API access token." });
        return;
      }
      setValidation({ ok: true, message: `Connected to ${result.myshopifyDomain ?? 'your store'} — pending PrepShip approval after submit.` });
      setStage('review');
    } finally {
      setValidating(false);
    }
    return;
  }
  setStage('review');
}
```

Render the `validation` message under the fields (green check for ok, red for failure — existing modal error styles) and disable the continue button while `validating` (label: `Validating…`).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (root + portal-client).

- [ ] **Step 4: Commit**

```bash
git add portal-client/src/lib/api.ts portal-client/src/components/store/StoreConnectModal.tsx
git commit -m "feat(portal): shopify token guide + live validation in store connect modal"
```

---

### Task 12: Portal UI — unlock Connections for clients + status badges + reconnect

**Files:**
- Modify: `portal-client/src/pages/Connections.tsx`

**Interfaces:**
- Consumes: Task 10 DTO fields, Task 11 api functions + modal prop.
- Produces: client-visible connect button, per-card status, reconnect affordance.

- [ ] **Step 1: Unlock the modal + wire validation**

In `Connections.tsx`:

(a) Remove the `isAdmin &&` gate at the modal render (line ~121) and on the "Connect store" button so every portal user can open it, and pass the validator:

```tsx
<StoreConnectModal
  open={modalOpen}
  onClose={() => setModalOpen(false)}
  onConnect={handleConnect}
  onValidate={async (draft) => {
    if (!accessToken) return { ok: false };
    try {
      const res = await portalApi.validateIntegration(accessToken, {
        provider: draft.platform.id,
        credentials: draft.values,
      });
      return res.data;
    } catch {
      return { ok: false };
    }
  }}
/>
```

(b) Update the `handleConnect` success toast copy to match the flow: `'${draft.storeName} is connected and pending PrepShip approval.'`

- [ ] **Step 2: Status badges on store cards**

Add a status helper at module level:

```tsx
type StoreConnStatus = 'pending' | 'active' | 'reconnect' | 'inactive';

function storeStatus(i: PortalIntegration): StoreConnStatus {
  if (i.lastSyncError === 'auth') return 'reconnect';
  if (i.source === 'portal') return 'pending';
  return i.active ? 'active' : 'inactive';
}

const STATUS_BADGE: Record<StoreConnStatus, { label: string; className: string }> = {
  pending: { label: 'Pending approval', className: 'bg-amber-500/15 text-amber-600 dark:text-amber-300' },
  active: { label: 'Active — syncing', className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300' },
  reconnect: { label: 'Reconnect needed', className: 'bg-rose-500/15 text-rose-600 dark:text-rose-300' },
  inactive: { label: 'Inactive', className: 'bg-slate-500/15 text-slate-500 dark:text-slate-300' },
};
```

Render on each store-type card (next to the existing label/identifier):

```tsx
{integration.type === 'store' && (() => {
  const status = STATUS_BADGE[storeStatus(integration)];
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', status.className)}>
      {status.label}
    </span>
  );
})()}
```

- [ ] **Step 3: Reconnect affordance**

For store cards with `storeStatus(integration) === 'reconnect'`, render a small inline form (single password input for the new Admin API token + submit) that calls:

```tsx
async function handleReconnect(id: number, token: string) {
  if (!accessToken) return;
  try {
    await portalApi.reconnectIntegration(accessToken, id, { accessToken: token });
    await qc.invalidateQueries({ queryKey: ['integrations'] });
    toast.success('Reconnected', 'Order sync will resume within a few minutes.');
  } catch (err) {
    toast.error('Could not reconnect', err instanceof Error ? err.message : 'Check the token and try again.');
  }
}
```

Add this component at module level in `Connections.tsx` and render it inside reconnect-status store cards as `<ReconnectForm onSubmit={(token) => handleReconnect(integration.id!, token)} />`:

```tsx
function ReconnectForm({ onSubmit }: { onSubmit: (token: string) => Promise<void> }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-2 flex items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!token.trim() || busy) return;
        setBusy(true);
        try {
          await onSubmit(token.trim());
          setToken('');
        } finally {
          setBusy(false);
        }
      }}
    >
      <input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="New Admin API access token"
        aria-label="New Admin API access token"
        className="glass w-full rounded-glass border border-white/10 bg-white/5 px-2 py-1 text-xs text-ink placeholder:text-ink/40 focus:outline-none focus:ring-1 focus:ring-white/30"
      />
      <Button type="submit" size="sm" disabled={busy || !token.trim()}>
        {busy ? 'Updating…' : 'Update token'}
      </Button>
    </form>
  );
}
```

(Reuse the page's existing `useState`/`Button` imports; match the surrounding card's input styling if it differs from the classes above.)

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run build:web`
Expected: portal-client builds clean.

- [ ] **Step 5: Commit**

```bash
git add portal-client/src/pages/Connections.tsx
git commit -m "feat(portal): client store connect unlock, sync status badges, reconnect flow"
```

---

### Task 13: Behavioral integration test (throwaway DB) + CI

**Files:**
- Create: `scripts/integration/shopify-connect.integration.ts`
- Modify: `package.json` (add `"test:shopify-connect-integration": "tsx scripts/integration/shopify-connect.integration.ts"` — the name contains `integration`, so run-guards DENY-skips it; it is CI/dev-run only)
- Modify: `.github/workflows/integration-tests.yml` (add one step after the existing suite: `- name: Run shopify connect integration suite` / `run: npm run test:shopify-connect-integration`)

**Interfaces:**
- Consumes: everything from Tasks 1-10; `setupTestEnv()` from `scripts/integration/guard.ts`; migration SQL files `drizzle/0027_credential_accounts_source_of_truth.sql` + `drizzle/0037_store_account_sync_state.sql` (store_accounts is NOT in the drizzle schema, so `drizzle-kit push` does not create it — this test applies those two files itself, idempotently).
- Produces: end-to-end proof — submit shape → promote activates+anchors → sync attributes orders → auth failure pauses after 3.

- [ ] **Step 1: Write the integration test**

Create `scripts/integration/shopify-connect.integration.ts`:

```ts
// Behavioral test for the Shopify direct store connect pipeline
// (spec docs/superpowers/specs/2026-07-08-shopify-client-store-connect-design.md).
// Needs TEST_DATABASE_URL (throwaway DB) — refuses prod. Run:
//   npm run test:client-portal-integration:setup   (drizzle schema)
//   npm run test:shopify-connect-integration
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { setupTestEnv } from './guard';

setupTestEnv();
process.env.SHOPIFY_SYNC_ENABLED = 'true';

const { db, sql: pgClient } = await import('../../src/db/client');
const { patchCredentialAccount } = await import('../../src/services/credential-accounts');
const { syncShopifyOrders } = await import('../../src/services/shopify-order-sync');
const { listPortalIntegrations } = await import('../../src/lib/client-portal/read-models/integrations');

let failures = 0;
function check(cond: boolean, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.error(`  ✗ ${msg}`);
    failures += 1;
  }
}
function eq(actual: unknown, expected: unknown, msg: string): void {
  const same = actual === expected || Number(actual) === Number(expected);
  check(same, `${msg} (got ${String(actual)}, want ${String(expected)})`);
}

// store_accounts lives outside the drizzle schema — apply its migrations directly.
for (const file of [
  'drizzle/0027_credential_accounts_source_of_truth.sql',
  'drizzle/0037_store_account_sync_state.sql',
]) {
  for (const stmt of readFileSync(file, 'utf8').split(';')) {
    const trimmed = stmt.trim();
    if (trimmed) await pgClient.unsafe(trimmed);
  }
}

// ── seed ──
await db.execute(sql`delete from store_accounts where provider = 'shopify'`);
await db.execute(sql`delete from orders where source_provider = 'shopify'`);
// If clients has additional NOT NULL columns in your schema, copy the client
// seed shape from scripts/integration/client-portal.integration.ts instead.
const clientRows = await db.execute<{ id: number }>(sql`
  insert into clients (name) values ('Shopify Test Client') returning id
`);
const clientId = clientRows[0]!.id;
// Rate-card note: Customer Shipping Rate projection (CP-040) is exercised by
// the existing client-portal.integration.ts suite; this suite proves orders
// arrive with the right clientId, which is the only new input to it.

// 1) Portal-shaped submit: source='portal', active=false.
const accountRows = await db.execute<{ id: number }>(sql`
  insert into store_accounts (client_id, provider, label, account_identifier, credentials, source, active)
  values (${clientId}, 'shopify', 'My Test Store', 'teststore.myshopify.com',
          ${JSON.stringify({ shopDomain: 'teststore.myshopify.com', accessToken: 'shpat_test' })}::jsonb,
          'portal', false)
  returning id
`);
const accountId = accountRows[0]!.id;

// Pending rows are invisible to the sync even when the flag is on.
const preResult = await syncShopifyOrders({
  fetchImpl: async () => {
    throw new Error('sync must not touch portal-pending accounts');
  },
});
eq(preResult.accounts, 0, 'pending (portal/inactive) account is not synced');

// 2) Promote — must activate AND stamp the anchor.
await patchCredentialAccount(pgClient as never, 'store_accounts', accountId, {
  hasSource: true,
  source: 'admin',
  hasLabel: false,
  label: null,
  labelGoesNull: false,
});
const promoted = await db.execute<{ active: boolean; anchor: Date | null }>(sql`
  select active, sync_anchor_at as anchor from store_accounts where id = ${accountId}
`);
eq(promoted[0]!.active, true, 'promotion activates the account');
check(promoted[0]!.anchor != null, 'promotion stamps sync_anchor_at');

// Backdate the anchor so fixtures created "now-ish" clear the floor while a
// pre-anchor fixture stays excluded.
await db.execute(sql`
  update store_accounts set sync_anchor_at = now() - interval '1 hour' where id = ${accountId}
`);

// 3) Sync with a stubbed Shopify: one order after the anchor, one before.
const nowIso = new Date().toISOString();
const oldIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
const orderNode = (id: string, createdAt: string) => ({
  id: `gid://shopify/Order/${id}`,
  legacyResourceId: id,
  name: `#${id}`,
  createdAt,
  updatedAt: createdAt,
  cancelledAt: null,
  displayFulfillmentStatus: 'UNFULFILLED',
  email: 'buyer@example.com',
  shippingAddress: { name: 'Pat Buyer', city: 'Austin', provinceCode: 'TX', zip: '78701' },
  currentTotalPriceSet: { shopMoney: { amount: '25.00' } },
  totalShippingPriceSet: { shopMoney: { amount: '5.00' } },
  lineItems: {
    nodes: [{ sku: 'SKU-9', title: 'Widget', quantity: 1, originalUnitPriceSet: { shopMoney: { amount: '25.00' } }, image: null }],
  },
});
const happyFetch = (async () =>
  new Response(
    JSON.stringify({
      data: {
        orders: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [orderNode('9001', nowIso), orderNode('8000', oldIso)],
        },
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )) as typeof fetch;

const syncResult = await syncShopifyOrders({ fetchImpl: happyFetch });
eq(syncResult.accounts, 1, 'promoted account is synced');
eq(syncResult.synced, 1, 'only the post-anchor order imports (forward-only)');

const imported = await db.execute<{
  clientId: number | null;
  storeId: number | null;
  sourceProvider: string | null;
  orderStatus: string;
}>(sql`
  select client_id as "clientId", store_id as "storeId",
         source_provider as "sourceProvider", order_status as "orderStatus"
  from orders where external_order_id = 'shopify-9001'
`);
check(imported.length === 1, 'order shopify-9001 landed in orders');
eq(imported[0]!.clientId, clientId, 'order attributed to the connecting client');
eq(imported[0]!.storeId, 9_200_000 + accountId, 'synthetic shopify store id');
eq(imported[0]!.sourceProvider, 'shopify', 'source provider recorded');
eq(imported[0]!.orderStatus, 'awaiting_shipment', 'unfulfilled -> awaiting_shipment');
const excluded = await db.execute<{ n: number }>(sql`
  select count(*)::int as n from orders where external_order_id = 'shopify-8000'
`);
eq(excluded[0]!.n, 0, 'pre-anchor order was NOT imported');

const items = await db.execute<{ sku: string }>(sql`
  select oi.sku from order_items oi
  join orders o on o.id = oi.order_id
  where o.external_order_id = 'shopify-9001'
`);
eq(items[0]?.sku, 'SKU-9', 'order_items fan-out ran');

// 4) Portal read-model shows the store with sync status.
const scope = {
  clientIds: [clientId],
  storeIds: [],
  isGlobal: false,
  isRestricted: true,
  userId: 'test-user',
  permissions: [],
  canViewFinancials: true,
  canViewCredentials: false,
  auditSource: 'background',
} as never;
const listed = await listPortalIntegrations(scope);
const storeDto = listed.data.find((d: { type?: string }) => d.type === 'store') as
  | { lastSyncError: string | null; source: string | null; active: boolean }
  | undefined;
check(!!storeDto, 'portal integrations list returns the store');
eq(storeDto?.lastSyncError ?? null, null, 'no sync error after a clean sync');

// 5) Auth failures increment the counter and pause at 3.
const authFetch = (async () => new Response('{}', { status: 401 })) as typeof fetch;
for (let i = 1; i <= 3; i += 1) await syncShopifyOrders({ fetchImpl: authFetch });
const afterAuth = await db.execute<{ err: string | null; count: number }>(sql`
  select last_sync_error as err, sync_failure_count as count from store_accounts where id = ${accountId}
`);
eq(afterAuth[0]!.err, 'auth', 'auth failure recorded');
eq(afterAuth[0]!.count, 3, 'three consecutive auth failures counted');
const paused = await syncShopifyOrders({
  fetchImpl: async () => {
    throw new Error('paused account must not be fetched');
  },
});
eq(paused.accounts, 0, 'account pauses after 3 consecutive auth failures');

// ── teardown ──
await db.execute(sql`delete from orders where source_provider = 'shopify'`);
await db.execute(sql`delete from store_accounts where id = ${accountId}`);
await db.execute(sql`delete from clients where id = ${clientId}`);
await pgClient.end();

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nPASS shopify connect integration');
```

- [ ] **Step 2: Register the script + CI step**

Add to `package.json` scripts:

```json
"test:shopify-connect-integration": "tsx scripts/integration/shopify-connect.integration.ts",
```

Append to `.github/workflows/integration-tests.yml` after the existing suite step:

```yaml
      - name: Run shopify connect integration suite
        run: npm run test:shopify-connect-integration
```

- [ ] **Step 3: Run it (needs a local throwaway Postgres; skip locally if none — CI covers it)**

Run: `npm run test:client-portal-integration:setup` then `npm run test:shopify-connect-integration`
Expected: every `✓`, final line `PASS shopify connect integration`.
If no local TEST_DATABASE_URL: expected exit 2 with the harness refusal message — note it and rely on CI.

- [ ] **Step 4: Commit**

```bash
git add scripts/integration/shopify-connect.integration.ts package.json .github/workflows/integration-tests.yml
git commit -m "test(shopify-connect): end-to-end behavioral suite on throwaway DB"
```

---

### Task 14: SOT matrix row + full verification sweep

**Files:**
- Modify: `docs/source-of-truth-matrix.md` (additive row/lines only — this file is pinned by `test:client-portal-shadow-renderer`; run it after editing)

**Interfaces:**
- Consumes: everything above.
- Produces: documented ownership + a fully green suite.

- [ ] **Step 1: Document the new surface in the SOT matrix**

In `docs/source-of-truth-matrix.md`, find the Rates/Orders ownership sections (around the lines listing "Order sync services and marketplace import routes") and add, in the orders-ingestion writer list:

```markdown
- Shopify direct order sync (`src/services/shopify-order-sync.ts`) — polls client
  Shopify stores (GraphQL Admin API 2026-04, forward-only from the promotion
  anchor) and persists through the shared store-order-import upsert. Buyer-paid
  Shopify shipping lands in `orders.shipping_amount` as record/display data only;
  the Customer Shipping Rate remains owned by frozen billing → projection (CP-040).
```

- [ ] **Step 2: Full verification sweep**

Run each; ALL must pass:

```bash
npm run typecheck
npm run test:guards
npm run test:connector-registry
npm run test:connector-architecture
npm run guard:client-portal-architecture
npm run test:client-portal-sales-sot-drift
npm run test:client-portal-shadow-renderer
npm run build:web
```

Expected: exit 0 on every command. Any red is a regression (the suite baseline is fully green) — fix before committing.

- [ ] **Step 3: Commit**

```bash
git add docs/source-of-truth-matrix.md
git commit -m "docs(shopify-connect): record shopify order sync ownership in SOT matrix"
```

---

## Post-plan notes for the executor

- **Do not push.** Everything stays local until the owner says "push and build".
- **Rollout after merge/deploy:** set `SHOPIFY_SYNC_ENABLED=true` in the API environment, have a client (or yourself) connect a dev store (`read_orders` custom app), promote it via the admin app store-accounts PATCH, and watch `[scheduler] shopify orders synced:` logs.
- **Deferred (spec Out-of-scope):** webhooks, tracking write-back (`shipment.confirm` stays stub → outbox keeps `not_supported`), inventory/product sync, other platforms' connectors, checkout carrier-calculated rates.
- **Human decision point flagged during brainstorm:** the status mapping in Task 2 treats `PARTIALLY_FULFILLED` as actionable (`awaiting_shipment`). If the owner wants partial fulfillments held instead, change `mapShopifyOrderStatus` and the corresponding assertion together.
