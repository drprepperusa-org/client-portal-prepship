import { readActiveClientPortalApiSource } from './lib/client-portal-active-api-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const orders = readFileSync(path.join(root, 'portal-client/src/pages/Orders.tsx'), 'utf8');
const itemLines = readFileSync(path.join(root, 'portal-client/src/components/ItemIdentityLines.tsx'), 'utf8');
const api = readActiveClientPortalApiSource();
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

// CP-040 root-cause protection: the Orders LIST/detail read-model must resolve
// customer shipping via the backend resolver (frozen billing line -> billing-
// config projection), so a shipped-but-unfrozen order shows a real rate and a
// future refactor can't silently revert it to a raw billing sum or the removed
// internal rate.
assert.match(ordersReadModel, /orderCustomerShippingRateSql\(\)/, 'read-model resolves shipping via orderCustomerShippingRateSql');
assert.match(ordersReadModel, /shippingCharged:\s*row\.resolvedShippingRate/, 'read-model threads the resolved rate into the DTO');
assert.doesNotMatch(ordersReadModel, /line_type = 'shipping'/, 'read-model no longer sums billing_line_items shipping directly (uses the resolver)');

// CP-040: orders.shipping_amount (buyer-paid store shipping) is UNRELATED to the
// customer shipping rate and is NEVER a fallback for it, in ANY status — this
// reverses CP-039's interim status-gated fallback. Behavioral coverage lives in
// client-portal-orders-shipping-status-guard.ts.
assert.doesNotMatch(dto, /isAwaitingBucket/, 'DTO no longer status-gates a buyer-paid fallback (CP-040 removed it)');
assert.doesNotMatch(dto, /Number\(row\.shippingAmount\)/, 'DTO customerShippingRate never reads buyer-paid shippingAmount (CP-040)');

console.log('Client portal Orders customer-shipping-rate guard passed.');
