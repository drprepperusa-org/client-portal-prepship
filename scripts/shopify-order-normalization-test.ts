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
