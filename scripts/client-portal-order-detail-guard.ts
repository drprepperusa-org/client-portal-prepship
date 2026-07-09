// CP-014 / CP-015 — the order-detail cost summary and rate display must be
// backend-owned. The DTO computes product line totals + subtotal (CP-014) and a
// normalized best-rate amount (CP-015); the frontend renders those fields and
// never multiplies unitPrice × quantity or parses raw bestRateJson. All money is
// financially gated. Enforced at runtime against the real (pure) DTO builder.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
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

const baseRow: any = {
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
  shipToPostalCode: '02101',
  raw: { shipTo: { street1: '123 Main St', street2: 'Apt 4', country: 'US' } },
  carrierCode: 'ups',
  serviceCode: 'ups_ground',
  weightOz: 10,
  orderTotal: '35.00',
  shippingAmount: '5.00',
  shippingCharged: '5.99',
  items: [
    { sku: 'A', name: 'Item A', quantity: 2, unitPrice: 7.5 }, // 15.00
    { sku: 'B', name: 'Item B', quantity: 3, unitPrice: 5 },   // 15.00
    { sku: 'PROMO', name: 'Promo', quantity: 1, unitPrice: -2 }, // discount → excluded
  ],
  // CP-015: raw provider rate JSON (two nested amount shapes) the backend must
  // normalize into a single numeric bestRateAmount.
  override: { bestRateJson: { shipping_amount: { amount: 4 }, other_amount: { amount: 1 } } },
};

// ── CP-014: financial DTO computes per-line totals + subtotal (discount excluded) ──
const admin: any = dto.toPortalOrderDto(baseRow, { includeFinancials: true });
check(admin.productSubtotal === 30, 'CP-014: backend product subtotal = Σ line totals (30), discount excluded');
check(admin.items.find((i: any) => i.sku === 'A')?.lineTotal === 15, 'CP-014: per-line total is backend-owned (unitPrice × qty)');
check(!admin.items.some((i: any) => i.sku === 'PROMO'), 'CP-014: discount/promo lines excluded from the item list');

// ── CP-018: the internal selected/best rate is gone from the client DTO ──
check(!('bestRateAmount' in admin), 'CP-018: bestRateAmount is no longer exposed on the client DTO');
check(!('selectedRate' in admin), 'CP-018: selectedRate is no longer exposed on the client DTO');
check(!('bestRateJson' in admin), 'CP-018: raw bestRateJson is not exposed on the client DTO');

// ── Order detail: full ship-to address (ungated) + customer shipping (gated) ──
check(admin.shipToLine1 === '123 Main St' && admin.shipToLine2 === 'Apt 4', 'order detail: DTO exposes full ship-to street lines from raw');
check(admin.shipToPostalCode === '02101' && admin.shipToCountry === 'US', 'order detail: DTO exposes ship-to postal code + country');
check(admin.shippingCharged === '5.99', 'order detail: DTO exposes backend billed shipping (shippingCharged)');
// CP-018: customerShippingRate = billed customer shipping when > 0.
check(admin.customerShippingRate === '5.99', 'CP-018: customerShippingRate = billed customer shipping when > 0');
// CP-040: a '0.00'/unresolved billed value → the rate is null (renders "—" or
// "Pending"), NEVER the buyer-paid store shipping. Buyer-paid store shipping
// (orders.shippingAmount) is unrelated to the 3PL customer shipping rate.
const zeroBilled: any = dto.toPortalOrderDto({ ...baseRow, shippingCharged: '0.00', shippingAmount: '5.00' }, { includeFinancials: true });
check(zeroBilled.customerShippingRate === null, 'CP-040: $0.00 resolved shipping → null (never buyer-paid store shipping)');

// ── Redaction: non-financial DTO omits all product/rate money ──
const client: any = dto.toPortalOrderDto(baseRow, { includeFinancials: false });
check(!('productSubtotal' in client), 'CP-014: non-financial DTO omits productSubtotal');
check(client.items.every((i: any) => i.unitPrice === undefined && i.lineTotal === undefined), 'CP-014: non-financial DTO omits unitPrice/lineTotal');
check(!('bestRateAmount' in client) && !('bestRateJson' in client), 'CP-018: non-financial DTO omits best-rate money entirely');
check(client.shipToLine1 === '123 Main St' && client.shipToPostalCode === '02101', 'order detail: ship-to address is NOT financially gated (client sees their own recipient)');
check(!('shippingCharged' in client), 'order detail: shippingCharged is financially gated');
check(!('customerShippingRate' in client), 'CP-018: customerShippingRate is financially gated (omitted for non-financial clients)');

// ── CP-017: chargeSummary is a backend-owned, always-reconciling receipt ──
// DJ's shape, BALANCED via a negative promo line (the only real discount source
// in this system): 148.70 (goods) − 29.54 (promo) + 14.67 (shipping) = 133.83.
const dj: any = dto.toPortalOrderDto(
  {
    ...baseRow,
    orderStatus: 'shipped',
    orderTotal: '133.83',
    shippingCharged: '14.67',
    shippingAmount: '14.67',
    raw: { shipTo: baseRow.raw.shipTo }, // no taxAmount → no tax row
    items: [
      { sku: 'DJ', name: 'DJ Item', quantity: 1, unitPrice: 148.7 },
      { sku: 'PROMO', name: 'Promo', quantity: 1, unitPrice: -29.54 },
    ],
  },
  { includeFinancials: true },
);
check(Array.isArray(dj.chargeSummary), 'CP-017: financial DTO returns a chargeSummary array');
check(
  dj.chargeSummary.every(
    (r: any) =>
      ['subtotal', 'discount', 'shipping', 'tax', 'adjustment', 'refund', 'total'].includes(r.kind) &&
      typeof r.label === 'string' &&
      typeof r.amount === 'number',
  ),
  'CP-017: every chargeSummary row is {label:string, amount:number, kind:enum}',
);
const rowByKind = (k: string) => dj.chargeSummary.find((r: any) => r.kind === k);
check(Math.round(rowByKind('subtotal').amount * 100) === 14870, 'CP-017: subtotal row = $148.70 (Σ line cents)');
check(Math.round(rowByKind('discount').amount * 100) === -2954, 'CP-017: discount row = −$29.54 (recovered negative promo line)');
check(Math.round(rowByKind('shipping').amount * 100) === 1467, 'CP-017: shipping row = $14.67');
check(Math.round(rowByKind('total').amount * 100) === 13383, 'CP-017: total row = $133.83');
check(!dj.chargeSummary.some((r: any) => r.kind === 'adjustment' || r.kind === 'refund'), 'CP-017: a fully-explained receipt emits NO balancing row');
const djSum = dj.chargeSummary.filter((r: any) => r.kind !== 'total').reduce((c: number, r: any) => c + Math.round(r.amount * 100), 0);
check(djSum === 13383, 'CP-017: non-total rows sum EXACTLY to orderTotal (reconciliation)');
const lineCentsSum = dj.items.reduce((c: number, it: any) => c + Math.round(Number(it.lineTotal) * 100), 0);
check(Math.round(rowByKind('subtotal').amount * 100) === lineCentsSum, 'CP-017: subtotal row equals the sum of the per-item lineTotal column to the cent');

// baseRow is unbalanced: subtotal 30 − promo 2 + shipping 5.99 = 33.99; the
// +$1.01 residual surfaces as ONE positive balancing row labeled "Other".
const plug = admin.chargeSummary.find((r: any) => r.kind === 'adjustment' || r.kind === 'refund');
check(
  !!plug && Math.round(plug.amount * 100) === 101 && plug.kind === 'adjustment' && plug.label === 'Other',
  'CP-017: a positive residual surfaces as a single +$1.01 "Other" adjustment (not a discount label)',
);
const baseSum = admin.chargeSummary.filter((r: any) => r.kind !== 'total').reduce((c: number, r: any) => c + Math.round(r.amount * 100), 0);
check(baseSum === Math.round(Number(baseRow.orderTotal) * 100), 'CP-017: even the unbalanced base fixture reconciles to orderTotal to the cent');

// A cancelled order below goods value → a Refund row, not a "100% discount".
const cancelled: any = dto.toPortalOrderDto(
  { ...baseRow, orderStatus: 'cancelled', orderTotal: '0.00', shippingCharged: '0.00', shippingAmount: '0.00', items: [{ sku: 'X', name: 'X', quantity: 1, unitPrice: 30 }] },
  { includeFinancials: true },
);
check(
  cancelled.chargeSummary.some((r: any) => r.kind === 'refund' && Math.round(r.amount * 100) === -3000 && r.label === 'Refund'),
  'CP-017: a cancelled order with a negative residual emits a Refund row (not a discount)',
);
check(
  cancelled.chargeSummary.filter((r: any) => r.kind !== 'total').reduce((c: number, r: any) => c + Math.round(r.amount * 100), 0) === 0,
  'CP-017: the cancelled receipt still reconciles to $0.00',
);

// A zero subtotal emits no $0.00 subtotal row.
const zeroSub: any = dto.toPortalOrderDto(
  { ...baseRow, orderTotal: '5.99', shippingCharged: '5.99', shippingAmount: '5.99', items: [] },
  { includeFinancials: true },
);
check(!zeroSub.chargeSummary.some((r: any) => r.kind === 'subtotal'), 'CP-017: a zero subtotal emits no subtotal row (no $0.00 noise)');

// Non-financial omission + redaction (the summary never surfaces carrier/rate).
check(!('chargeSummary' in client), 'CP-017: non-financial DTO omits chargeSummary');
check(!JSON.stringify(dj.chargeSummary).match(/carrier|service|account|rate/i), 'CP-017: chargeSummary rows contain no carrier/service/account/rate strings');

// ── Frontend: OrderDetailPanel renders backend fields, no local math/JSON parse ──
const panel = read('portal-client/src/components/OrderDetailPanel.tsx');
check(!panel.includes('Number(o.productSubtotal ?? 0)'), 'CP-017: panel no longer hard-codes the Product subtotal row from o.productSubtotal');
check(/Number\(it\.lineTotal\)/.test(panel), 'CP-014: panel renders backend per-line total');
check(!panel.includes('p * (Number(it.quantity) || 1)'), 'CP-014: panel no longer multiplies unitPrice × quantity');
check(!panel.includes('o.bestRateAmount'), 'CP-018: panel no longer reads the internal best-rate amount');
check(!panel.includes('o.bestRateJson') && !panel.includes('o.selectedRate'), 'CP-018: panel no longer parses raw bestRateJson or reads selectedRate');

// ── CP-017: panel renders the backend chargeSummary verbatim, no receipt math ──
check(panel.includes('o.chargeSummary'), 'CP-017: panel renders the backend chargeSummary array');
check(/o\.chargeSummary[\s\S]*\.map\(/.test(panel), 'CP-017: panel iterates chargeSummary rows');
check(!panel.includes('label="Product subtotal"'), 'CP-017: panel no longer hard-codes the Product subtotal row from a separate DTO field');
check(!/o\.chargeSummary[\s\S]*\.reduce\(/.test(panel), 'CP-017: panel does no receipt math on chargeSummary (no .reduce) — the backend owns the total');

// ── CP-009: the customer-facing order detail never shows carrier or service ──
check(!panel.includes('CarrierBadge') && !panel.includes('o.carrierCode'), 'CP-009: panel does not render the carrier');
check(!panel.includes('o.shippingService') && !panel.includes('o.serviceCode') && !panel.includes('label="Service"'), 'CP-009: panel does not render the shipping service');
check(!panel.includes('o.shippingAccount'), 'CP-001: panel does not render the shipping account');

// ── Order detail: full ship-to address + shipping amount + order number ──
check(panel.includes('o.shipToLine1') && panel.includes('o.shipToPostalCode') && panel.includes('o.shipToCountry'), 'order detail: panel renders the full ship-to address');
check(panel.includes('o.customerShippingRate') && /label="Customer Shipping Rate"/.test(panel), 'CP-018: panel shows the Customer Shipping Rate (not carrier/service/internal rate)');
check(!panel.includes('o.shippingCharged, o.shippingAmount'), 'CP-018: panel no longer three-tiers billed/store/best — it reads the single backend field');
check(panel.includes('o.orderNumber'), 'order detail: panel shows the order number');

// ── CP-022: ONE canonical order-detail loader — every entry point (Orders,
//    Analysis, Shipments drawers) fetches the /orders/:id DTO, so the launching
//    page's list row can never change the visible detail truth. ──
const loader = read('portal-client/src/components/OrderDetailLoader.tsx');
check(
  loader.includes('useOrder(id)') && loader.includes('<OrderDetailPanel') && loader.includes('o={q.data.data}'),
  'CP-022: OrderDetailLoader fetches the canonical /orders/:id DTO and renders the panel',
);
const ordersPage = read('portal-client/src/pages/Orders.tsx');
const analysisPage = read('portal-client/src/pages/Analysis.tsx');
const shipmentsPage = read('portal-client/src/pages/Shipments.tsx');
for (const [name, src] of [
  ['Orders', ordersPage],
  ['Analysis', analysisPage],
  ['Shipments', shipmentsPage],
] as const) {
  check(src.includes('OrderDetailLoader'), `CP-022: ${name} renders order detail through the shared OrderDetailLoader`);
}
check(
  !/<OrderDetailPanel\s+o=\{selected\}/.test(ordersPage),
  'CP-022: Orders no longer passes the raw list row into OrderDetailPanel (it fetches /orders/:id first)',
);
check(
  ordersPage.includes("header: 'Weight'") &&
    ordersPage.includes("key: 'weight'") &&
    ordersPage.includes('defaultHidden: true') &&
    ordersPage.includes('allowColumnCustomization={canCustomizeTables}') &&
    !panel.includes('label="Weight"') &&
    !loader.includes('hideWeight'),
  'Orders may expose a default-hidden admin Weight column, while order detail still renders no Weight field',
);

if (failed) process.exit(1);
console.log('\nclient portal order detail guard passed.');
