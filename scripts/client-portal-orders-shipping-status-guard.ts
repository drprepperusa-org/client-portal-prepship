// CP-039 — status-aware Customer Shipping Rate guard (behavioral).
//
// Exercises the REAL order DTO (toPortalOrderDto) to prove:
//   - an awaiting/pending order with buyer-paid store shipping (shippingAmount)
//     but NO billed shipping line shows NO rate (customerShippingRate = null) —
//     it must not surface a rate just because the marketplace buyer paid at
//     checkout;
//   - billed shipping (billing_line_items line_type='shipping') is the canonical
//     rate for EVERY status (incl. awaiting);
//   - the buyer-paid fallback still applies once the order is out of the
//     awaiting/pending bucket (shipped/finalized);
//   - no internal selected/best/label rate leaks onto the client DTO.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
let failed = false;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`ok: ${msg}`);
  else {
    console.error(`FAIL: ${msg}`);
    failed = true;
  }
}
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const { toPortalOrderDto } = await import('../src/lib/client-portal/dto');
type Row = Parameters<typeof toPortalOrderDto>[0];

const BASE = {
  id: 1,
  clientId: 1,
  storeId: null,
  orderNumber: '2333',
  externalOrderId: null,
  sourceProvider: 'shipstation',
  orderStatus: 'awaiting_shipment',
  orderDate: new Date('2026-07-06T00:00:00Z'),
  shipToName: null,
  shipToCity: null,
  shipToState: null,
  raw: {},
  items: [],
  orderTotal: '100.00',
  shippingAmount: null,
  shippingCharged: null,
  clientName: 'HUGRAB',
  storeName: 'HUGRAB',
  override: null,
  activeTrackingStatus: null,
  hasActiveShipment: false,
  hasVoidedShipment: false,
};
const dtoOf = (o: Record<string, unknown>) =>
  toPortalOrderDto({ ...BASE, ...o } as unknown as Row, { includeFinancials: true }) as Record<string, unknown>;
const rate = (o: Record<string, unknown>) => dtoOf(o).customerShippingRate;

// ── CP-039 core: awaiting/pending + buyer-paid shipping, no billed line → null ──
check(
  rate({ orderStatus: 'awaiting_shipment', shippingAmount: '12.90', shippingCharged: null }) == null,
  'awaiting order with shippingAmount>0 and no billed shipping → customerShippingRate null (the #2333 case)',
);
check(rate({ orderStatus: 'on_hold', shippingAmount: '12.90' }) == null, 'on_hold order with shippingAmount>0 → null');
check(rate({ orderStatus: 'pending', shippingAmount: '9.99' }) == null, 'pending order with shippingAmount>0 → null');
check(
  rate({ orderStatus: 'awaiting_payment', shippingAmount: '5.00' }) == null,
  'awaiting_payment order with shippingAmount>0 → null',
);

// The #2333 awaiting row shows "—", not "Pending" (no active shipment).
check(
  dtoOf({ orderStatus: 'awaiting_shipment', shippingAmount: '12.90' }).customerShippingRatePending === false,
  'awaiting order (no shipment) is not marked pending → renders "—" not "Pending"',
);

// ── Billed shipping is canonical for EVERY status (incl. awaiting) ──
check(
  Number(rate({ orderStatus: 'awaiting_shipment', shippingCharged: '5.00', shippingAmount: '12.90' })) === 5,
  'awaiting order WITH a billed shipping line → shows billed shipping (canonical, any status)',
);
check(
  Number(rate({ orderStatus: 'shipped', shippingCharged: '7.95', shippingAmount: '0' })) === 7.95,
  'shipped order with a billed shipping line → shows billed shipping',
);

// ── Buyer-paid fallback still applies once out of the awaiting/pending bucket ──
check(
  Number(rate({ orderStatus: 'shipped', shippingCharged: null, shippingAmount: '12.90' })) === 12.9,
  'shipped order with buyer-paid shipping (no billed line) → buyer-paid fallback applies',
);

// ── No internal selected/best/label rate leaks; carrier identity stays redacted ──
const d = dtoOf({ orderStatus: 'shipped', shippingCharged: '7.95' });
for (const k of ['selectedRate', 'selectedRateJson', 'bestRateAmount', 'labelCost', 'providerAccount']) {
  check(!(k in d), `client order DTO has no ${k}`);
}
check(d.carrierCode === null && d.serviceCode === null, 'carrierCode/serviceCode present but null (CP-009 redacted)');

// ── package.json wiring (also auto-discovered by run-guards) ──
const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
assert(
  pkg.scripts?.['test:client-portal-orders-shipping-status'] === 'tsx scripts/client-portal-orders-shipping-status-guard.ts',
  'package.json exposes test:client-portal-orders-shipping-status',
);
console.log('ok: package.json exposes test:client-portal-orders-shipping-status');

if (failed) process.exit(1);
console.log('\nCP-039 orders shipping-status guard passed.');
