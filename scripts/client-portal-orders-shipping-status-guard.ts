// CP-040 — Customer Shipping Rate resolver guard (behavioral + static).
//
// Exercises the REAL order DTO (toPortalOrderDto) and pins the resolver SOT so the
// CP-040 correction can't regress:
//   - customerShippingRate comes ONLY from the resolved shippingCharged (a frozen
//     billing_line_items shipping line per shipment -> live billing-config
//     projection), surfaced by orderCustomerShippingRateSql;
//   - orders.shipping_amount (buyer-paid store shipping) is NEVER a fallback for
//     the rate in ANY status. This REVERSES CP-039's interim status-gated
//     fallback: DJ clarified buyer-paid store shipping is unrelated to the 3PL
//     customer shipping rate and must not decide it;
//   - a resolved rate shows for every status; without one the rate is null
//     (-> "Pending" if the order still has an active shipment, else "-");
//   - buyer-paid shippingAmount is not even exposed on the customer DTO;
//   - no internal selected/best/label rate or carrier/service leaks (CP-018).
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
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

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

// ── CP-040 core: orders.shipping_amount is NEVER the rate, in ANY status ──
check(
  rate({ orderStatus: 'awaiting_shipment', shippingAmount: '12.90', shippingCharged: null }) == null,
  'awaiting order with buyer-paid shippingAmount>0 and no resolved rate -> null',
);
check(
  rate({ orderStatus: 'shipped', shippingAmount: '12.90', shippingCharged: null }) == null,
  'SHIPPED order with buyer-paid shippingAmount>0 but no resolved rate -> null (CP-040: no buyer-paid fallback)',
);
check(
  rate({ orderStatus: 'delivered', shippingAmount: '9.99', shippingCharged: null }) == null,
  'delivered order with buyer-paid shippingAmount>0 -> null',
);
check(
  rate({ orderStatus: 'on_hold', shippingAmount: '5.00' }) == null,
  'on_hold order with buyer-paid shippingAmount>0 -> null',
);

// ── The resolved rate (shippingCharged) is canonical for EVERY status ──
check(
  Number(rate({ orderStatus: 'awaiting_shipment', shippingCharged: '5.00', shippingAmount: '12.90' })) === 5,
  'awaiting order WITH a resolved rate -> shows it (not the buyer-paid amount)',
);
check(
  Number(rate({ orderStatus: 'shipped', shippingCharged: '7.73', shippingAmount: '99.00' })) === 7.73,
  'shipped order with a resolved rate -> shows the resolver value, not buyer-paid shippingAmount',
);

// ── shippingAmount is not even exposed on the customer DTO (CP-040) ──
check(
  !('shippingAmount' in dtoOf({ orderStatus: 'shipped', shippingCharged: '7.73', shippingAmount: '99.00' })),
  'customer order DTO does not expose buyer-paid shippingAmount',
);

// ── Pending vs "-": a shipped order with a shipment but no resolved rate is Pending ──
check(
  dtoOf({ orderStatus: 'shipped', shippingCharged: null, hasActiveShipment: true }).customerShippingRatePending === true,
  'shipped order with an active shipment but no resolved rate -> Pending',
);
check(
  dtoOf({ orderStatus: 'awaiting_shipment', shippingAmount: '12.90' }).customerShippingRatePending === false,
  'awaiting order (no shipment) is not pending -> renders "-"',
);

// ── No internal selected/best/label rate leaks; carrier identity stays redacted ──
const d = dtoOf({ orderStatus: 'shipped', shippingCharged: '7.73' });
for (const k of ['selectedRate', 'selectedRateJson', 'bestRateAmount', 'labelCost', 'providerAccount']) {
  check(!(k in d), `client order DTO has no ${k}`);
}
check(d.carrierCode === null && d.serviceCode === null, 'carrierCode/serviceCode present but null (CP-009 redacted)');

// ── Static: the resolver owns the priority; read-model + DTO consume it; no shipping_amount ──
const resolver = stripComments(read('src/lib/client-portal/customer-shipping-rate.ts'));
check(
  /export function orderCustomerShippingRateSql/.test(resolver),
  'order-grain resolver orderCustomerShippingRateSql exists',
);
check(
  /shipmentCustomerShippingRateSql[\s\S]*coalesce[\s\S]*billing_line_items[\s\S]*line_type = 'shipping'[\s\S]*projectedCustomerShippingRateSql/.test(
    resolver,
  ),
  "resolver priority: frozen billing_line_items shipping line -> billing-config projection",
);
check(
  !/shipping_amount|shippingAmount/.test(resolver),
  'the resolver never references orders.shipping_amount (code)',
);

const ordersRm = stripComments(read('src/lib/client-portal/read-models/orders.ts'));
check(
  /orderCustomerShippingRateSql\(\)/.test(ordersRm),
  'Orders read-model resolves shipping via orderCustomerShippingRateSql',
);
check(
  !/line_type = 'shipping'/.test(ordersRm),
  'Orders read-model no longer sums billing_line_items shipping directly (uses the resolver)',
);
check(
  !/shipping_amount|shippingAmount/.test(ordersRm),
  'Orders read-model never references orders.shipping_amount',
);

const dtoCode = read('src/lib/client-portal/dto.ts');
const rateStmt = dtoCode.match(/const customerShippingRate =[\s\S]*?;/)?.[0] ?? '';
check(rateStmt.length > 0, 'dto.ts computes customerShippingRate');
check(
  !/shippingAmount/.test(rateStmt),
  'dto.ts customerShippingRate is NOT derived from shippingAmount (CP-040)',
);

// ── package.json wiring (also auto-discovered by run-guards) ──
const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
assert(
  pkg.scripts?.['test:client-portal-orders-shipping-status'] === 'tsx scripts/client-portal-orders-shipping-status-guard.ts',
  'package.json exposes test:client-portal-orders-shipping-status',
);
console.log('ok: package.json exposes test:client-portal-orders-shipping-status');

if (failed) process.exit(1);
console.log('\nCP-040 customer shipping rate resolver guard passed.');
