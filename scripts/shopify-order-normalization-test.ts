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
  REQUIRED_SHOPIFY_ACCESS_SCOPES,
  verifyShopifyCredentials,
  fetchShopifyOrdersSince,
  type ShopifyFetch,
} from '../src/connectors/store/shopify';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function shopifyVerifyPayload(shopName: string, myshopifyDomain: string): Record<string, unknown> {
  return {
    data: {
      shop: { name: shopName, myshopifyDomain },
      currentAppInstallation: {
        accessScopes: REQUIRED_SHOPIFY_ACCESS_SCOPES.map((handle) => ({ handle })),
      },
    },
  };
}

// verify: happy path
{
  const fakeFetch: ShopifyFetch = async (url) => {
    assert.ok(String(url).includes('mybrand.myshopify.com/admin/api/2026-04/graphql.json'));
    return jsonResponse(200, shopifyVerifyPayload('My Brand', 'mybrand.myshopify.com'));
  };
  const r = await verifyShopifyCredentials({ shopDomain: 'mybrand.myshopify.com', accessToken: 't', fetchImpl: fakeFetch });
  assert.deepEqual(r, { ok: true, shopName: 'My Brand', myshopifyDomain: 'mybrand.myshopify.com' });
}

// verify: basic order scopes are not enough for PrepShip's operational Shopify path
{
  const fakeFetch: ShopifyFetch = async () =>
    jsonResponse(200, {
      data: {
        shop: { name: 'Limited Brand', myshopifyDomain: 'limited.myshopify.com' },
        currentAppInstallation: {
          accessScopes: [{ handle: 'read_orders' }, { handle: 'read_products' }],
        },
      },
    });
  const r = await verifyShopifyCredentials({ shopDomain: 'limited.myshopify.com', accessToken: 't', fetchImpl: fakeFetch });
  assert.deepEqual(r, {
    ok: false,
    reason: 'missing_scopes',
    missingScopes: [
      'read_customers',
      'read_draft_orders',
      'read_fulfillments',
      'write_fulfillments',
      'read_locations',
      'read_merchant_managed_fulfillment_orders',
      'write_merchant_managed_fulfillment_orders',
      'write_orders',
    ],
  });
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

// ── client credentials grant (Dev Dashboard apps, Spring '26+) ──
import {
  exchangeShopifyClientCredentials,
  invalidateShopifyTokenCache,
  resolveShopifyAccessToken,
} from '../src/connectors/store/shopify';

// exchange: happy path posts form-encoded grant to /admin/oauth/access_token
{
  const fakeFetch: ShopifyFetch = async (url, init) => {
    assert.equal(String(url), 'https://ccgrant-a.myshopify.com/admin/oauth/access_token');
    assert.equal(init?.method, 'POST');
    const contentType = new Headers(init?.headers).get('Content-Type');
    assert.equal(contentType, 'application/x-www-form-urlencoded');
    const body = String(init?.body ?? '');
    assert.ok(body.includes('grant_type=client_credentials'), 'grant type present');
    assert.ok(body.includes('client_id=id-123'), 'client id present');
    assert.ok(body.includes('client_secret=shpss_abc'), 'client secret present');
    return jsonResponse(200, { access_token: 'shpat_minted', scope: 'read_orders', expires_in: 86399 });
  };
  const r = await exchangeShopifyClientCredentials({
    shopDomain: 'ccgrant-a.myshopify.com',
    clientId: 'id-123',
    clientSecret: 'shpss_abc',
    fetchImpl: fakeFetch,
  });
  assert.deepEqual(r, { ok: true, accessToken: 'shpat_minted', expiresIn: 86399 });
}

// exchange: rejected grant (wrong secret / app not installed / other org) -> auth
{
  const fakeFetch: ShopifyFetch = async () =>
    jsonResponse(400, { error: 'invalid_client', error_description: 'Client authentication failed' });
  const r = await exchangeShopifyClientCredentials({
    shopDomain: 'ccgrant-b.myshopify.com',
    clientId: 'id-123',
    clientSecret: 'wrong',
    fetchImpl: fakeFetch,
  });
  assert.deepEqual(r, { ok: false, reason: 'auth' });
}

// resolve: legacy stored token passes straight through, no network
{
  const fakeFetch: ShopifyFetch = async () => {
    throw new Error('legacy token must not trigger network');
  };
  const r = await resolveShopifyAccessToken(
    { accessToken: 'shpat_legacy' },
    'ccgrant-c.myshopify.com',
    fakeFetch,
  );
  assert.deepEqual(r, { ok: true, accessToken: 'shpat_legacy' });
}

// resolve: client id + secret exchange, and the minted token is CACHED per shop+client
{
  let exchanges = 0;
  const fakeFetch: ShopifyFetch = async () => {
    exchanges += 1;
    return jsonResponse(200, { access_token: `shpat_cached_${exchanges}`, scope: 'read_orders', expires_in: 86399 });
  };
  const creds = { clientId: 'id-777', clientSecret: 'shpss_777' };
  const first = await resolveShopifyAccessToken(creds, 'ccgrant-d.myshopify.com', fakeFetch);
  const second = await resolveShopifyAccessToken(creds, 'ccgrant-d.myshopify.com', fakeFetch);
  assert.ok(first.ok && second.ok);
  if (first.ok && second.ok) {
    assert.equal(first.accessToken, 'shpat_cached_1');
    assert.equal(second.accessToken, 'shpat_cached_1', 'second resolve reuses cached token');
  }
  assert.equal(exchanges, 1, 'exactly one exchange for two resolves');
}

// invalidateShopifyTokenCache: drops the shop+client entry so the next
// resolve with the SAME secret re-exchanges instead of reusing a token
// Shopify just rejected mid-window (the sync-time 401 retry path).
{
  let exchanges = 0;
  const fakeFetch: ShopifyFetch = async () => {
    exchanges += 1;
    return jsonResponse(200, { access_token: `shpat_inv_${exchanges}`, scope: 'read_orders', expires_in: 86399 });
  };
  const creds = { clientId: 'id-inv', clientSecret: 'shpss_inv' };
  const warmed = await resolveShopifyAccessToken(creds, 'ccgrant-inv.myshopify.com', fakeFetch);
  assert.ok(warmed.ok);
  assert.equal(exchanges, 1);
  const stillCached = await resolveShopifyAccessToken(creds, 'ccgrant-inv.myshopify.com', fakeFetch);
  assert.ok(stillCached.ok);
  assert.equal(exchanges, 1, 'still warm before invalidate');

  invalidateShopifyTokenCache('ccgrant-inv.myshopify.com', 'id-inv');
  const afterInvalidate = await resolveShopifyAccessToken(creds, 'ccgrant-inv.myshopify.com', fakeFetch);
  assert.ok(afterInvalidate.ok);
  assert.equal(exchanges, 2, 'cache miss after invalidate forces a fresh exchange with the same secret');

  // A miss on an unrelated shop/client is a silent no-op — never throws.
  invalidateShopifyTokenCache('never-cached.myshopify.com', 'id-none');
}

// resolve: a DIFFERENT secret must never be satisfied by the warm cache
// (fingerprint-bound entries; a mistyped/rotated secret forces a real
// exchange, and its failure surfaces instead of a stale green).
{
  let exchanges = 0;
  const fakeFetch: ShopifyFetch = async (_url, init) => {
    exchanges += 1;
    const body = String(init?.body ?? '');
    if (body.includes('client_secret=right')) {
      return jsonResponse(200, { access_token: `shpat_right_${exchanges}`, scope: 'read_orders', expires_in: 86399 });
    }
    return jsonResponse(400, { error: 'invalid_client' });
  };
  const good = await resolveShopifyAccessToken(
    { clientId: 'id-rot', clientSecret: 'right' },
    'ccgrant-h.myshopify.com',
    fakeFetch,
  );
  assert.ok(good.ok, 'correct secret exchanges fine');
  const bad = await resolveShopifyAccessToken(
    { clientId: 'id-rot', clientSecret: 'wrong' },
    'ccgrant-h.myshopify.com',
    fakeFetch,
  );
  assert.deepEqual(bad, { ok: false, reason: 'auth' }, 'wrong secret is NOT satisfied by the warm cache');
  assert.equal(exchanges, 2, 'fingerprint mismatch forces a real exchange');
}

// verify: NEVER satisfied by a warm cache — every verification re-exchanges
// (a green check must mean THIS secret was just accepted by Shopify).
{
  let exchangeCalls = 0;
  let queryCalls = 0;
  const fakeFetch: ShopifyFetch = async (url) => {
    if (String(url).endsWith('/admin/oauth/access_token')) {
      exchangeCalls += 1;
      return jsonResponse(200, { access_token: 'shpat_fresh', scope: 'read_orders', expires_in: 86399 });
    }
    queryCalls += 1;
    return jsonResponse(200, shopifyVerifyPayload('Fresh Shop', 'ccgrant-i.myshopify.com'));
  };
  const warm = await resolveShopifyAccessToken(
    { clientId: 'id-fresh', clientSecret: 'shpss_fresh' },
    'ccgrant-i.myshopify.com',
    fakeFetch,
  );
  assert.ok(warm.ok, 'cache warmed');
  assert.equal(exchangeCalls, 1);
  const verified = await verifyShopifyCredentials({
    shopDomain: 'ccgrant-i.myshopify.com',
    clientId: 'id-fresh',
    clientSecret: 'shpss_fresh',
    fetchImpl: fakeFetch,
  });
  assert.ok(verified.ok, 'verify succeeds');
  assert.equal(exchangeCalls, 2, 'verify forced a fresh exchange despite the warm cache');
  assert.equal(queryCalls, 1, 'shop query ran once');
}

// resolve: neither mode present -> invalid_credentials
{
  const fakeFetch: ShopifyFetch = async () => {
    throw new Error('must not be called');
  };
  const r = await resolveShopifyAccessToken({}, 'ccgrant-e.myshopify.com', fakeFetch);
  assert.deepEqual(r, { ok: false, reason: 'invalid_credentials' });
}

// verify: client credentials mode -> exchange first, then shop query with minted token
{
  let call = 0;
  const fakeFetch: ShopifyFetch = async (url, init) => {
    call += 1;
    if (call === 1) {
      assert.ok(String(url).endsWith('/admin/oauth/access_token'), 'first call is the token exchange');
      return jsonResponse(200, { access_token: 'shpat_verify', scope: 'read_orders', expires_in: 86399 });
    }
    assert.ok(String(url).includes('/admin/api/2026-04/graphql.json'), 'second call is the shop query');
    const token = new Headers(init?.headers).get('X-Shopify-Access-Token');
    assert.equal(token, 'shpat_verify', 'shop query uses the minted token');
    return jsonResponse(200, shopifyVerifyPayload('CC Shop', 'ccgrant-f.myshopify.com'));
  };
  const r = await verifyShopifyCredentials({
    shopDomain: 'ccgrant-f.myshopify.com',
    clientId: 'id-9',
    clientSecret: 'shpss_9',
    fetchImpl: fakeFetch,
  });
  assert.deepEqual(r, { ok: true, shopName: 'CC Shop', myshopifyDomain: 'ccgrant-f.myshopify.com' });
  assert.equal(call, 2, 'exchange then verify');
}

// verify: credential-less call still fails closed
{
  const fakeFetch: ShopifyFetch = async () => {
    throw new Error('must not be called');
  };
  const r = await verifyShopifyCredentials({ shopDomain: 'ccgrant-g.myshopify.com', fetchImpl: fakeFetch });
  assert.deepEqual(r, { ok: false, reason: 'auth' });
}

console.log('PASS shopify order normalization');
