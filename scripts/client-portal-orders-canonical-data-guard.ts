import { readActiveClientPortalApiSource } from './lib/client-portal-active-api-source.mjs';
// CP-052 — Orders list/detail must use complete normalized order_items and the
// latest active shipment identity. Raw orders.items is compatibility metadata,
// never the owner of displayed quantity or orderedUnits.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
let failed = false;
function check(condition: boolean, message: string) {
  if (condition) console.log(`ok: ${message}`);
  else {
    console.error(`FAIL: ${message}`);
    failed = true;
  }
}

const { toPortalOrderDto } = await import('../src/lib/client-portal/dto');
const canonicalItems = Array.from({ length: 31 }, (_, index) => ({
  sku: `SKU-${String(index + 1).padStart(2, '0')}`,
  name: `Item ${index + 1}`,
  quantity: String((index % 3) + 1),
  unitPrice: '2.00',
  lineTotal: String(((index % 3) + 1) * 2),
  imageUrl: null,
}));
const expectedUnits = canonicalItems.reduce((sum, item) => sum + Number(item.quantity), 0);

const baseRow: any = {
  id: 52,
  clientId: 4,
  clientName: 'HUGRAB',
  storeId: 1,
  storeName: 'HUGRAB',
  orderNumber: 'CP-052',
  externalOrderId: null,
  sourceProvider: 'shipstation',
  sourceAccountId: null,
  orderStatus: 'shipped',
  orderDate: new Date('2026-07-14T00:00:00Z'),
  shipToName: 'Customer',
  shipToCity: 'Boston',
  shipToState: 'MA',
  shipToPostalCode: '02101',
  raw: {},
  carrierCode: 'fedex',
  serviceCode: 'internal_service',
  orderTotal: '124.00',
  shippingAmount: '999.00',
  shippingCharged: null,
  // Deliberately malformed/competing raw item data. It must not affect the
  // canonical item list or orderedUnits.
  items: [{ sku: 'RAW-WRONG', quantity: 999_999, qty: 888_888, unitPrice: 0.01 }],
  canonicalItems,
  activeTrackingStatus: 'in_transit',
  hasActiveShipment: true,
  hasVoidedShipment: false,
  activeShipmentTrackingNumber: '9400-CANONICAL',
  activeShipmentCarrierCode: 'usps',
  override: { trackingNumber: '1Z-LEGACY' },
};

const dto: any = toPortalOrderDto(baseRow, { includeFinancials: true });
check(dto.items.length === 31, 'complete >30-line canonical item set crosses the DTO with no silent cap');
check(dto.items[0]?.sku === 'SKU-01' && dto.items[30]?.sku === 'SKU-31', 'canonical item ordering and identity are preserved');
check(dto.orderedUnits === expectedUnits, 'orderedUnits is the backend sum of canonical order_items.quantity');
check(dto.orderedUnits !== 999_999 && !dto.items.some((item: any) => item.sku === 'RAW-WRONG'), 'malformed raw item quantity cannot alter items or orderedUnits');
check(dto.displayTrackingNumber === '9400-CANONICAL', 'latest active shipment tracking wins without an override dependency');

const legacy: any = toPortalOrderDto(
  { ...baseRow, activeShipmentTrackingNumber: null, activeShipmentCarrierCode: null },
  { includeFinancials: false },
);
check(legacy.displayTrackingNumber === '1Z-LEGACY', 'documented order-override tracking remains a legacy-only fallback');
check(
  dto.carrierCode === null && dto.serviceCode === null && dto.shippingService === null &&
    !('selectedRate' in dto) && !('bestRateJson' in dto) && !('shippingAmount' in dto),
  'order DTO leaks no internal carrier/service/rate identity or buyer-paid shipping field',
);

const readModel = read('src/lib/client-portal/read-models/orders.ts');
const itemLoader = readModel.slice(
  readModel.indexOf('async function loadCanonicalOrderItems'),
  readModel.indexOf('const activeShipmentTrackingNumberSql'),
);
check(
  itemLoader.includes('.from(orderItems)') && itemLoader.includes('inArray(orderItems.orderId, orderIds)') &&
    itemLoader.includes('asc(orderItems.lineIndex)') && !itemLoader.includes('.limit('),
  'Orders read-model batch-loads complete normalized order_items in line order',
);
check((readModel.match(/canonicalItems:/g) ?? []).length === 2, 'both Orders list and detail supply canonicalItems to the same DTO');
check(
  readModel.includes('coalesce(nullif(trim(s.label_tracking)') &&
    readModel.includes('coalesce(s.voided, false) = false') &&
    (readModel.match(/activeShipmentTrackingNumber:/g) ?? []).length === 4,
  'list and detail select the latest non-voided shipment display tracking identity',
);

const dtoSource = read('src/lib/client-portal/dto.ts');
const orderDtoSource = dtoSource.slice(
  dtoSource.indexOf('export function toPortalOrderDto'),
  dtoSource.indexOf('export function toPortalShipmentDto'),
);
check(!orderDtoSource.includes('safeItems(row.items'), 'order DTO never parses raw orders.items into displayed item truth');
check(!orderDtoSource.includes('.slice(0, 30)'), 'order DTO has no hidden 30-line cap');

const api = readActiveClientPortalApiSource();
const portalOrder = api.slice(api.indexOf('export interface PortalOrder {'), api.indexOf('export type PortalShipmentStatus'));
check(
  portalOrder.includes('orderedUnits: number') && portalOrder.includes('displayTrackingNumber: string | null') &&
    !portalOrder.includes('trackingNumber: string | null'),
  'PortalOrder exposes intent-named orderedUnits and displayTrackingNumber only',
);

const ordersPage = read('portal-client/src/pages/Orders.tsx');
const panel = read('portal-client/src/components/OrderDetailPanel.tsx');
const peek = read('portal-client/src/components/dashboard/peek/OpenOrdersPeek.tsx');
const status = read('portal-client/src/lib/status.ts');
check(
  ordersPage.includes('o.orderedUnits') && panel.includes('o.orderedUnits') && peek.includes('o.orderedUnits') &&
    !status.includes('itemCount(') && !panel.includes('it.quantity ?? 1'),
  'frontend renders backend quantity truth with no quantity fallback or business math',
);
check(
  panel.includes('o.displayTrackingNumber') && !panel.includes('o.trackingNumber'),
  'order detail renders the backend-selected display tracking field',
);

for (const page of ['Orders.tsx', 'Analysis.tsx', 'Shipments.tsx']) {
  check(
    read(`portal-client/src/pages/${page}`).includes('OrderDetailLoader'),
    `${page.replace('.tsx', '')} opens the same canonical order detail DTO`,
  );
}

if (failed) process.exit(1);
console.log('\nCP-052 canonical Orders data guard passed.');
