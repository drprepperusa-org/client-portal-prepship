// CP-009 guard: client users never receive carrier or shipping-service
// identity (carrier code, service code/name, carrier/account nickname,
// provider/account id) — admins keep it unchanged. Enforcement is backend
// DTO/read-model redaction, asserted here at runtime with real calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
let failed = false;

function check(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failed = true;
  } else {
    console.log(`ok: ${message}`);
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const dto = await import('../src/lib/client-portal/dto');
const ordersList = await import('../src/services/orders-list');

// 1) Order DTO: client (no financials) gets carrier/service identity nulled;
//    tracking number stays; admin path unchanged.
const orderRow: any = {
  id: 1,
  clientId: 4,
  clientName: 'HUGRAB',
  storeName: null,
  storeId: 1,
  orderNumber: '2115',
  externalOrderId: null,
  sourceProvider: null,
  sourceAccountId: null,
  orderStatus: 'shipped',
  orderDate: new Date('2026-07-01T00:00:00Z'),
  shipToName: 'A',
  shipToCity: 'B',
  shipToState: 'C',
  carrierCode: 'ups',
  serviceCode: 'ups_ground_saver',
  weightOz: 10,
  orderTotal: '10.00',
  shippingAmount: '5.00',
  items: [],
  override: { trackingNumber: '1Z999' },
  latestShipment: { carrierCode: 'ups', serviceCode: 'ups_ground_saver', amount: 5.99 },
  bestRateJson: null,
  selectedRateJson: { carrierCode: 'ups', serviceCode: 'ups_ground_saver', serviceName: 'UPS Ground Saver', amount: 5.99 },
};
const clientOrder: any = dto.toPortalOrderDto(orderRow, { includeFinancials: false });
check(
  clientOrder.carrierCode === null && clientOrder.serviceCode === null && clientOrder.shippingService === null,
  'client order DTO exposes no carrier code / service code / service name',
);
check(
  !clientOrder.selectedRate ||
    (clientOrder.selectedRate.carrierCode === null &&
      clientOrder.selectedRate.serviceCode === null &&
      clientOrder.selectedRate.serviceName === null),
  'client order DTO selectedRate carries no carrier/service identity',
);
check(clientOrder.trackingNumber === '1Z999', 'client order DTO keeps the tracking number');
check(!('shippingAccount' in clientOrder), 'client order DTO still omits shippingAccount (CP-001 intact)');
const adminOrder: any = dto.toPortalOrderDto(orderRow, { includeFinancials: true });
check(
  adminOrder.carrierCode === 'ups' && adminOrder.serviceCode === 'ups_ground_saver' && adminOrder.shippingService != null,
  'admin order DTO unchanged (carrier/service present)',
);
check(
  adminOrder.selectedRate?.carrierCode === 'ups' && adminOrder.selectedRate?.serviceName != null,
  'admin order DTO selectedRate identity unchanged',
);

// 2) Shipment DTO: same gate.
const shipmentRow: any = {
  id: 9,
  orderId: 1,
  orderNumber: '2115',
  clientId: 4,
  carrierCode: 'stamps_com',
  serviceCode: 'usps_ground_advantage',
  trackingNumber: '9434',
  labelTracking: null,
  shipDate: new Date('2026-07-01T00:00:00Z'),
  labelShipDate: null,
  createDate: null,
  trackingStatus: 'delivered',
  trackingStatusDetail: null,
  deliveredAt: new Date('2026-07-02T00:00:00Z'),
  voided: false,
  orderItems: [],
  shippingCost: '5.89',
};
const clientShipment: any = dto.toPortalShipmentDto(shipmentRow, { includeFinancials: false });
check(
  clientShipment.carrierCode === null && clientShipment.serviceCode === null,
  'client shipment DTO exposes no carrier/service',
);
check(
  clientShipment.trackingNumber === '9434' && clientShipment.trackingStatus === 'delivered',
  'client shipment DTO keeps tracking number + live status',
);
check(clientShipment.shippingCost === null, 'client shipment DTO still gates shipping cost');
const adminShipment: any = dto.toPortalShipmentDto(shipmentRow, { includeFinancials: true });
check(
  adminShipment.carrierCode === 'stamps_com' && adminShipment.serviceCode === 'usps_ground_advantage',
  'admin shipment DTO unchanged',
);

// 3) Orders-list redaction: identity keys nulled recursively for non-financial
//    viewers (closes the ungated selectedRate.providerAccountNickname leak).
const row: any = {
  label: { carrierCode: 'ups', serviceCode: 'gs', shippingProviderId: 9, cost: 5.99, trackingNumber: '1Z' },
  selectedRate: { providerAccountNickname: 'ORION', carrierNickname: 'Chase x7439', carrierCode: 'ups', serviceName: 'Ground', amount: 5.99, providerAccountId: 12 },
  bestRate: { carrierCode: 'usps', amount: 4.5 },
  shipping: { serviceCode: 'ga', shippingCost: 6 },
  canonicalOrder: { carrierCode: 'ups' },
};
const redacted: any = ordersList.redactOrderFinancials(row, false);
check(
  redacted.label.carrierCode === null &&
    redacted.label.serviceCode === null &&
    redacted.label.shippingProviderId === null &&
    redacted.selectedRate.providerAccountNickname === null &&
    redacted.selectedRate.carrierNickname === null &&
    redacted.selectedRate.providerAccountId === null &&
    redacted.selectedRate.serviceName === null &&
    redacted.bestRate.carrierCode === null &&
    redacted.shipping.serviceCode === null &&
    redacted.canonicalOrder.carrierCode === null,
  'non-financial orders-list rows carry no carrier identity anywhere',
);
check(redacted.label.trackingNumber === '1Z', 'orders-list redaction keeps tracking numbers');
check(redacted.selectedRate.amount === null && redacted.label.cost === null, 'money redaction still applies');
const untouched: any = ordersList.redactOrderFinancials(row, true);
check(
  untouched.selectedRate.providerAccountNickname === 'ORION' && untouched.label.carrierCode === 'ups',
  'financial viewers (admin/operator) unchanged',
);

// 4) Source pins: the gate lives in the DTOs, not just the frontend.
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}
const dtoSource = read('src/lib/client-portal/dto.ts');
check(
  dtoSource.includes('carrierCode: options.includeFinancials ? carrierCode : null') &&
    dtoSource.includes('carrierCode: options.includeFinancials ? row.carrierCode : null'),
  'DTO source gates carrier identity behind includeFinancials',
);
const ordersListSource = read('src/services/orders-list.ts');
check(
  ordersListSource.includes('CARRIER_IDENTITY_FIELD_KEYS') && ordersListSource.includes("'providerAccountNickname'"),
  'orders-list owns the carrier-identity redaction key set',
);

const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
assert(
  pkg.scripts?.['test:client-portal-carrier-redaction'] === 'tsx scripts/client-portal-carrier-redaction-guard.ts',
  'package.json exposes test:client-portal-carrier-redaction',
);
console.log('ok: package.json exposes test:client-portal-carrier-redaction');

if (failed) process.exit(1);
console.log('\nCP-009 client portal carrier redaction guard passed.');
