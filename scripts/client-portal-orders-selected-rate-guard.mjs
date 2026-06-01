import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const ordersPath = path.join(root, 'portal-client/src/pages/Orders.tsx');
const apiPath = path.join(root, 'portal-client/src/lib/api.ts');
const dtoPath = path.join(root, 'src/lib/client-portal/dto.ts');

const orders = readFileSync(ordersPath, 'utf8');
const api = readFileSync(apiPath, 'utf8');
const dto = readFileSync(dtoPath, 'utf8');

assert.match(orders, /header:\s*['"]Selected Rate['"]/, 'Orders table must include a Selected Rate column');
assert.doesNotMatch(orders, /header:\s*['"]Shipping Account['"]/, 'Orders table must not include a Shipping Account column');
assert.doesNotMatch(orders, /header:\s*['"]Best Rate['"]/, 'Orders table must not include a Best Rate column');
assert.match(orders, /key:\s*['"]selectedRate['"]/, 'Orders table should key the replacement column as selectedRate');
assert.match(orders, /Number\(it\.quantity\)\s*>\s*1/, 'SKU renderer must inspect each line quantity');
assert.match(orders, /x\{it\.quantity\}/, 'SKU renderer must display an xN quantity badge next to multi-qty SKUs');
assert.match(orders, /selectedRate/, 'Orders UI must render selectedRate data');
assert.doesNotMatch(orders, /title=\{o\.shippingAccount\}|>\{o\.shippingAccount\}</, 'Orders table must not render account nicknames');
assert.match(
  orders,
  /o\.orderStatus\s*===\s*['"]awaiting_shipment['"]\s*\?\s*null\s*:\s*o\.carrierCode/,
  'Awaiting rows must not label best-rate carrier data as a selected rate',
);

assert.match(api, /selectedRate\??:\s*\{/, 'PortalOrder type must expose selectedRate');
assert.match(dto, /selectedRate:/, 'Client portal DTO must project selectedRate');

console.log('Client portal Orders selected-rate guard passed.');
