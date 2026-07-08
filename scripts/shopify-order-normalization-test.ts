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

console.log('PASS shopify order normalization');
