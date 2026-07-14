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
  // CP-040: the customer shipping rate resolves from billed/projected shipping
  // (shippingCharged), NEVER the buyer-paid shippingAmount above — so this fixture
  // carries a billed value and the DTO must surface it (5.99), not 5.00.
  shippingCharged: '5.99',
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
check(!('selectedRate' in clientOrder), 'CP-018: client order DTO no longer exposes selectedRate at all');
check(clientOrder.trackingNumber === '1Z999', 'client order DTO keeps the tracking number');
check(!('shippingAccount' in clientOrder), 'client order DTO omits the provider-account nickname (CP-001/CP-018)');
// CP-009 sweep: the client portal is customer-facing, so carrier/service is
// NEVER exposed — not even to financials-enabled clients or admins. Money (order
// total, rate amount) still flows for financial viewers.
const adminOrder: any = dto.toPortalOrderDto(orderRow, { includeFinancials: true });
check(
  adminOrder.carrierCode === null && adminOrder.serviceCode === null && adminOrder.shippingService === null,
  'financials/admin order DTO ALSO exposes no carrier / service (customer-facing surface)',
);
check(!('selectedRate' in adminOrder), 'CP-018: financials/admin order DTO no longer exposes selectedRate at all');
check(!('shippingAccount' in adminOrder), 'CP-018: financials/admin order DTO no longer exposes the provider-account nickname');
check(
  adminOrder.orderTotal != null && adminOrder.customerShippingRate != null,
  'financials order DTO still exposes money (order total + customer shipping rate)',
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
check(clientShipment.customerShippingRate === null, 'client shipment DTO still gates the customer shipping rate');
const financialShipment: any = dto.toPortalShipmentDto(shipmentRow, { includeFinancials: true });
check(
  financialShipment.carrierCode === null && financialShipment.serviceCode === null,
  'financials/admin shipment DTO ALSO exposes no carrier / service (CP-009 sweep)',
);
check(financialShipment.customerShippingRate != null, 'financials shipment DTO still exposes the (billed) customer shipping rate');

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
  !dtoSource.includes('options.includeFinancials ? carrierCode') &&
    !dtoSource.includes('options.includeFinancials ? row.carrierCode') &&
    !dtoSource.includes('options.includeFinancials ? row.serviceCode') &&
    !dtoSource.includes('options.includeFinancials ? shippingService') &&
    dtoSource.includes('carrierCode: null') &&
    dtoSource.includes('serviceCode: null') &&
    dtoSource.includes('shippingService: null'),
  'DTO source hard-nulls carrier/service (never gated behind financials) — CP-009',
);
const ordersListSource = read('src/services/orders-list.ts');
check(
  ordersListSource.includes('CARRIER_IDENTITY_FIELD_KEYS') && ordersListSource.includes("'providerAccountNickname'"),
  'orders-list owns the carrier-identity redaction key set',
);
// CP-018: the invoice-details read-model must never ship the real carrier code
// on the wire (the /invoice-details JSON was leaking max(o.carrier_code), gated
// only by canViewFinancials — a client-visible carrier leak).
const invoiceDetailsSource = read('src/lib/client-portal/read-models/invoice-details.ts');
check(
  !/carrierCode:\s*row\.carrier_code/.test(invoiceDetailsSource) && !/max\(o\.carrier_code\)/.test(invoiceDetailsSource),
  'CP-018: invoice-details DTO never ships the real carrier code (nulled at source, SQL select dropped)',
);
const clientApiSource = read('portal-client/src/lib/api.ts');
check(
  !/interface BillingInvoiceDetailRow \{[^}]*carrierCode/.test(clientApiSource),
  'CP-018: BillingInvoiceDetailRow no longer declares carrierCode',
);
// CP-018/CP-050: /analysis/sku-orders reuses an internal service that retains
// carrier/service fields. Its explicit customer serializer must omit those
// keys entirely, and the route must return only that DTO.
const skuOrdersRoute = read('src/routes/client-portal/analysis.ts');
const skuOrderSerializer = skuOrdersRoute.match(
  /export function toClientAnalysisSkuOrderDto[\s\S]*?\r?\n\}/,
)?.[0] ?? '';
check(
  skuOrderSerializer.length > 0 &&
    !/carrier_code|service_code/.test(skuOrderSerializer) &&
    skuOrdersRoute.includes('return c.json(toClientAnalysisSkuOrdersDto(result));'),
  'CP-018/CP-050: /analysis/sku-orders omits carrier_code + service_code at the customer boundary',
);

const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
assert(
  pkg.scripts?.['test:client-portal-carrier-redaction'] === 'tsx scripts/client-portal-carrier-redaction-guard.ts',
  'package.json exposes test:client-portal-carrier-redaction',
);
console.log('ok: package.json exposes test:client-portal-carrier-redaction');

if (failed) process.exit(1);
console.log('\nCP-009 client portal carrier redaction guard passed.');
