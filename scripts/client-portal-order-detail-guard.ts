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
// CP-018: a '0.00' billed value means "not billed yet" → falls through to the
// buyer-paid store shipping, never renders $0.00.
const zeroBilled: any = dto.toPortalOrderDto({ ...baseRow, shippingCharged: '0.00', shippingAmount: '5.00' }, { includeFinancials: true });
check(zeroBilled.customerShippingRate === '5.00', 'CP-018: $0.00 billed shipping falls through to store shipping ($5.00), not $0.00');

// ── Redaction: non-financial DTO omits all product/rate money ──
const client: any = dto.toPortalOrderDto(baseRow, { includeFinancials: false });
check(!('productSubtotal' in client), 'CP-014: non-financial DTO omits productSubtotal');
check(client.items.every((i: any) => i.unitPrice === undefined && i.lineTotal === undefined), 'CP-014: non-financial DTO omits unitPrice/lineTotal');
check(!('bestRateAmount' in client) && !('bestRateJson' in client), 'CP-018: non-financial DTO omits best-rate money entirely');
check(client.shipToLine1 === '123 Main St' && client.shipToPostalCode === '02101', 'order detail: ship-to address is NOT financially gated (client sees their own recipient)');
check(!('shippingCharged' in client), 'order detail: shippingCharged is financially gated');
check(!('customerShippingRate' in client), 'CP-018: customerShippingRate is financially gated (omitted for non-financial clients)');

// ── Frontend: OrderDetailPanel renders backend fields, no local math/JSON parse ──
const panel = read('portal-client/src/components/OrderDetailPanel.tsx');
check(panel.includes('Number(o.productSubtotal ?? 0)'), 'CP-014: panel renders backend productSubtotal');
check(/Number\(it\.lineTotal\)/.test(panel), 'CP-014: panel renders backend per-line total');
check(!panel.includes('p * (Number(it.quantity) || 1)'), 'CP-014: panel no longer multiplies unitPrice × quantity');
check(!panel.includes('o.bestRateAmount'), 'CP-018: panel no longer reads the internal best-rate amount');
check(!panel.includes('o.bestRateJson') && !panel.includes('o.selectedRate'), 'CP-018: panel no longer parses raw bestRateJson or reads selectedRate');

// ── CP-009: the customer-facing order detail never shows carrier or service ──
check(!panel.includes('CarrierBadge') && !panel.includes('o.carrierCode'), 'CP-009: panel does not render the carrier');
check(!panel.includes('o.shippingService') && !panel.includes('o.serviceCode') && !panel.includes('label="Service"'), 'CP-009: panel does not render the shipping service');
check(!panel.includes('o.shippingAccount'), 'CP-001: panel does not render the shipping account');

// ── Order detail: full ship-to address + shipping amount + order number ──
check(panel.includes('o.shipToLine1') && panel.includes('o.shipToPostalCode') && panel.includes('o.shipToCountry'), 'order detail: panel renders the full ship-to address');
check(panel.includes('o.customerShippingRate') && /label="Customer Shipping Rate"/.test(panel), 'CP-018: panel shows the Customer Shipping Rate (not carrier/service/internal rate)');
check(!panel.includes('o.shippingCharged, o.shippingAmount'), 'CP-018: panel no longer three-tiers billed/store/best — it reads the single backend field');
check(panel.includes('o.orderNumber'), 'order detail: panel shows the order number');

if (failed) process.exit(1);
console.log('\nclient portal order detail guard passed.');
