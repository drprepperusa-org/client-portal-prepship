// CP-005 guard: Shipments must use backend-owned item identity and shipping
// cost data, while matching the accepted Orders item display pattern.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
let failed = false;

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failed = true;
  } else {
    console.log(`ok: ${message}`);
  }
}

function read(rel: string) {
  const fullPath = path.join(root, rel);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';
}

const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
const route = read('src/routes/client-portal.ts');
const dto = read('src/lib/client-portal/dto.ts');
const api = read('portal-client/src/lib/api.ts');
const ordersPage = read('portal-client/src/pages/Orders.tsx');
const shipmentsPage = read('portal-client/src/pages/Shipments.tsx');
const itemIdentity = read('portal-client/src/components/ItemIdentityLines.tsx');

const shipmentsRouteBlock = /app\.get\('\/shipments'[\s\S]*?app\.get\('\/inventory'/.exec(route)?.[0] ?? '';
const shipmentDtoBlock =
  /export function toPortalShipmentDto[\s\S]*?export function toPortalInventoryDto/.exec(dto)?.[0] ?? '';
const portalShipmentBlock = /export interface PortalShipment \{[\s\S]*?\n\}/.exec(api)?.[0] ?? '';
assert(
  pkg.scripts?.['test:client-portal-shipments-item-identity'] ===
    'tsx scripts/client-portal-shipments-item-identity-guard.ts',
  'package.json exposes test:client-portal-shipments-item-identity',
);

assert(
  itemIdentity.includes('export function ItemNameLines') &&
    itemIdentity.includes('export function SkuLines') &&
    itemIdentity.includes('HoverZoomImage') &&
    itemIdentity.includes('quantity'),
  'shared item identity renderer exposes thumbnail item names and quantity-aware SKU lines',
);
assert(
  ordersPage.includes('ItemNameLines') &&
    ordersPage.includes('SkuLines') &&
    shipmentsPage.includes('ItemNameLines') &&
    shipmentsPage.includes('SkuLines'),
  'Orders and Shipments use the same item identity renderers',
);

assert(
  portalShipmentBlock.includes('items: PortalItemIdentity[]') &&
    portalShipmentBlock.includes('shippingCost?: number | string | null') &&
    !portalShipmentBlock.includes('serviceCode:'),
  'PortalShipment exposes items and gated shippingCost, without the removed Service field',
);

assert(
  shipmentDtoBlock.includes('options: { includeFinancials?: boolean }') &&
    shipmentDtoBlock.includes('items: safeItems(row.orderItems') &&
    shipmentDtoBlock.includes('shippingCost: options.includeFinancials ? row.shippingCost ?? null : null') &&
    !shipmentDtoBlock.includes('serviceCode:'),
  'toPortalShipmentDto maps order items and gates shipment cost behind financial visibility',
);

assert(
  shipmentsRouteBlock.includes('orderItems: orders.items') &&
    shipmentsRouteBlock.includes('shippingCost:') &&
    shipmentsRouteBlock.includes('coalesce(${shipments.labelCost}') &&
    shipmentsRouteBlock.includes('${shipments.otherCost}') &&
    shipmentsRouteBlock.includes('{ includeFinancials: scope.canViewFinancials }'),
  'shipments route selects order items, backend-owned shipment cost, and passes financial visibility to DTO',
);

assert(
  shipmentsPage.includes("key: 'items'") &&
    shipmentsPage.includes("header: 'Item Name'") &&
    shipmentsPage.includes("key: 'sku'") &&
    shipmentsPage.includes("header: 'SKU'") &&
    shipmentsPage.includes("key: 'shippingCost'") &&
    shipmentsPage.includes("header: 'Shipping Cost'") &&
    !shipmentsPage.includes("key: 'service'") &&
    !shipmentsPage.includes("header: 'Service'") &&
    !shipmentsPage.includes('serviceCode'),
  'Shipments table shows Item Name, SKU, and Shipping Cost columns without Service',
);

assert(
  shipmentsPage.includes('money(s.shippingCost)') &&
    shipmentsPage.includes('money(selected.shippingCost)') &&
    shipmentsPage.includes('Field label="Shipping Cost"') &&
    !shipmentsPage.includes('Field label="Service"') &&
    !shipmentsPage.includes('serviceCode'),
  'Shipments drawer shows shipping cost and never renders Service',
);

if (failed) process.exit(1);
console.log('\nCP-005 client portal shipments item identity guard passed.');
