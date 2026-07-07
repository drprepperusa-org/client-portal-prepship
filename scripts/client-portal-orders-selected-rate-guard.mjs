import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const orders = readFileSync(path.join(root, 'portal-client/src/pages/Orders.tsx'), 'utf8');
const itemLines = readFileSync(path.join(root, 'portal-client/src/components/ItemIdentityLines.tsx'), 'utf8');
const api = readFileSync(path.join(root, 'portal-client/src/lib/api.ts'), 'utf8');
const dto = readFileSync(path.join(root, 'src/lib/client-portal/dto.ts'), 'utf8');
const ordersReadModel = readFileSync(path.join(root, 'src/lib/client-portal/read-models/orders.ts'), 'utf8');

// CP-018: the Orders table shows the CUSTOMER shipping rate only — never the
// internal selected/best/label rate, carrier, or service.
assert.match(orders, /header:\s*['"]Customer Shipping Rate['"]/, 'Orders table has the Customer Shipping Rate column');
assert.doesNotMatch(orders, /header:\s*['"]Shipping Account['"]/, 'Orders table must not include a Shipping Account column');
assert.doesNotMatch(orders, /header:\s*['"]Best Rate['"]/, 'Orders table must not include a Best Rate column');
assert.match(orders, /key:\s*['"]customerShipping['"]/, 'Orders table keys the shipping column as customerShipping');
// The per-line SKU/name renderers (with the xN qty badge) moved to the shared
// ItemIdentityLines component in CP-005; Orders must render through it.
assert.match(orders, /<SkuLines\s+items=\{o\.items\}/, 'Orders SKU column must render through the shared SkuLines component');
assert.match(itemLines, /Number\(item\.quantity\)\s*>\s*1/, 'SKU renderer must inspect each line quantity');
assert.match(itemLines, /x\{item\.quantity\}/, 'SKU renderer must display an xN quantity badge next to multi-qty SKUs');
assert.match(orders, /o\.customerShippingRate/, 'Orders UI must render the backend customer shipping rate');
assert.doesNotMatch(orders, /title=\{o\.shippingAccount\}|>\{o\.shippingAccount\}</, 'Orders table must not render account nicknames');
// CP-009 / CP-018: customer-facing — never the carrier badge / code / service /
// internal selected rate.
assert.doesNotMatch(orders, /CarrierBadge/, 'Orders table no longer renders a carrier badge');
assert.doesNotMatch(orders, /o\.carrierCode/, 'Orders table no longer reads the carrier code');
assert.doesNotMatch(orders, /o\.selectedRate/, 'Orders table no longer reads the internal selected rate');

// CP-018: the client DTO/type exposes customerShippingRate and NOT the internal
// selected/best rate.
assert.doesNotMatch(api, /selectedRate\??:\s*\{/, 'PortalOrder type must NOT expose selectedRate');
assert.match(api, /customerShippingRate\??:/, 'PortalOrder type must expose customerShippingRate');
assert.doesNotMatch(api, /bestRateAmount/, 'PortalOrder type must NOT expose bestRateAmount');
assert.doesNotMatch(dto, /selectedRate:/, 'Client portal DTO must NOT project selectedRate');
assert.match(dto, /customerShippingRate:/, 'Client portal DTO must project customerShippingRate');
assert.doesNotMatch(dto, /bestRateAmount:/, 'Client portal DTO must NOT project bestRateAmount');

// CP-018 root-cause protection: the Orders LIST read-model must select billed
// customer shipping, so the column has a real value (not the removed rate) and a
// future refactor can't silently revert it to "—".
assert.match(ordersReadModel, /billedShipping/, 'list read-model selects billed shipping');
assert.match(ordersReadModel, /line_type = 'shipping'/, 'list billed-shipping filters line_type=shipping');
assert.match(ordersReadModel, /shippingCharged:\s*row\.billedShipping/, 'list threads billedShipping into the DTO');

// CP-039: the buyer-paid store-shipping fallback (orders.shippingAmount) is
// status-gated — it must NOT surface a rate for the awaiting/pending bucket. The
// DTO gates the fallback behind an awaiting-bucket check; behavioral coverage
// lives in client-portal-orders-shipping-status-guard.ts.
assert.match(dto, /isAwaitingBucket/, 'DTO gates the buyer-paid shipping fallback on the awaiting/pending bucket (CP-039)');
assert.match(
  dto,
  /!isAwaitingBucket && Number\(row\.shippingAmount\) > 0/,
  'DTO only falls back to buyer-paid shippingAmount when the order is NOT awaiting/pending (CP-039)',
);

console.log('Client portal Orders customer-shipping-rate guard passed.');
