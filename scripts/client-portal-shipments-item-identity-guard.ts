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
const route = read('src/routes/client-portal/shipments.ts');
// The shipments query moved to the read-model during the B-series extraction;
// the route is a thin delegate, so query-shape pins live against this file.
const shipmentsReadModel = read('src/lib/client-portal/read-models/shipments.ts');
const dto = read('src/lib/client-portal/dto.ts');
const predicates = read('src/lib/client-portal/predicates.ts');
const api = read('portal-client/src/lib/api.ts');
const ordersPage = read('portal-client/src/pages/Orders.tsx');
const shipmentsPage = read('portal-client/src/pages/Shipments.tsx');
const itemIdentity = read('portal-client/src/components/ItemIdentityLines.tsx');

// End-sentinel is now the handler's own col-0 `});` (the old `app.get('/inventory'`
// marker moved to inventory.ts). Comma after '/shipments' excludes the POST
// /shipments/refresh-tracking route.
const shipmentsRouteBlock = /app\.get\('\/shipments',[\s\S]*?\n\}\);/.exec(route)?.[0] ?? '';
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
    shipmentDtoBlock.includes('carrierCode: null') &&
    shipmentDtoBlock.includes('serviceCode: null'),
  'toPortalShipmentDto maps order items, gates shipping cost behind financials, and NEVER exposes carrier/service (CP-005 + CP-009)',
);

assert(
  shipmentsRouteBlock.length > 0 &&
    shipmentsRouteBlock.includes('listPortalShipments(') &&
    shipmentsReadModel.includes('orderItems: orders.items') &&
    shipmentsReadModel.includes('shippingCost:') &&
    shipmentsReadModel.includes('from billing_line_items bli') &&
    shipmentsReadModel.includes("bli.line_type = 'shipping'") &&
    !shipmentsReadModel.includes('coalesce(${shipments.labelCost}') &&
    shipmentsReadModel.includes('{ includeFinancials: scope.canViewFinancials }'),
  'shipments read model selects order items and BILLED (never label-cost) shipping, and passes financial visibility to the DTO',
);

assert(
  shipmentsReadModel.includes('visibleClientPortalShipmentsPredicate()') &&
    predicates.includes('export function visibleClientPortalShipmentsPredicate') &&
    predicates.includes("ilike 'SEAuto-%'") &&
    predicates.includes('${shipments.orderId} is null') &&
    predicates.includes('${shipments.clientId} is null'),
  'Shipments list hides ownerless SEAuto placeholder rows from the Client Portal',
);

assert(
  shipmentsPage.includes("key: 'items'") &&
    shipmentsPage.includes("header: 'Item Name'") &&
    shipmentsPage.includes("key: 'sku'") &&
    shipmentsPage.includes("header: 'SKU'") &&
    shipmentsPage.includes("key: 'shippingCost'") &&
    shipmentsPage.includes("header: 'Customer Shipping Rate'") &&
    !shipmentsPage.includes("key: 'service'") &&
    !shipmentsPage.includes("header: 'Service'") &&
    !shipmentsPage.includes('serviceCode'),
  'CP-018: Shipments table shows Item Name, SKU, and Customer Shipping Rate columns without Service',
);

assert(
  shipmentsPage.includes('money(s.shippingCost)') &&
    shipmentsPage.includes('money(selected.shippingCost)') &&
    shipmentsPage.includes('Field label="Customer Shipping Rate"') &&
    !shipmentsPage.includes('Field label="Service"') &&
    !shipmentsPage.includes('serviceCode'),
  'Shipments drawer shows shipping cost and never renders Service',
);

// CP-009: the customer-facing Shipments drawer must not display the carrier
// identity, and it surfaces the full order (ship-to address + line items + cost
// summary) by reusing the redacted OrderDetailPanel.
assert(
  !shipmentsPage.includes('Field label="Carrier"'),
  'CP-009: Shipments drawer no longer renders the Carrier field',
);
assert(
  shipmentsPage.includes('OrderDetailLoader') && shipmentsPage.includes('ShipmentOrderDetail'),
  'Shipments drawer shows the full order detail (address + items + cost) via the canonical OrderDetailLoader (CP-022)',
);

if (failed) process.exit(1);
console.log('\nCP-005 client portal shipments item identity guard passed.');
