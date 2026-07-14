import { readActiveClientPortalApiSource } from './lib/client-portal-active-api-source.mjs';
import { readSourceTree } from './lib/source-tree.mjs';
// CP-008 guard: Billing Order # opens a scoped shipment-information modal.
// Shipment truth comes from the backend shipments read path (scope-checked,
// DTO-redacted); the modal never exposes label URLs, provider payloads, or
// account identities, and shipping cost stays behind financial visibility.
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

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

// 1) Focused scoped endpoint reusing the canonical shipment DTO shaping.
const route = read('src/routes/client-portal/orders.ts');
const routeBlock = /app\.get\('\/orders\/:id\{\[0-9\]\+\}\/shipments'[\s\S]*?\n\}\);/.exec(route)?.[0] ?? '';
check(routeBlock.length > 0, 'GET /orders/:id/shipments route exists for the Billing shipment modal');
check(
  routeBlock.includes('shipmentScopePredicate(scope)') && routeBlock.includes('eq(shipments.voided, false)'),
  'order-shipments route is scope-checked and hides voided rows',
);
check(
  routeBlock.includes('toPortalShipmentDto') && routeBlock.includes('includeFinancials: scope.canViewFinancials'),
  'order-shipments route reuses toPortalShipmentDto with financial gating',
);
check(
  routeBlock.includes("recordPortalAudit('portal.billing.order_shipments.view'"),
  'order-shipments route is audited',
);

// 2) The shipment DTO stays redaction-safe: no label URLs, provider payloads,
//    or account identities; shipping cost gated by financial visibility.
const dto = read('src/lib/client-portal/dto.ts');
const dtoBlock = /export function toPortalShipmentDto[\s\S]*?\n\}/.exec(dto)?.[0] ?? '';
check(dtoBlock.length > 0, 'toPortalShipmentDto block found');
check(
  !dtoBlock.includes('labelUrl') &&
    !dtoBlock.includes('providerAccountNickname') &&
    !dtoBlock.includes('carrierAccountId') &&
    !dtoBlock.includes('selectedRateJson') &&
    !dtoBlock.includes('row.raw'),
  'shipment DTO exposes no label URLs / provider payloads / account identities',
);
check(
  dtoBlock.includes('options.includeFinancials ? row.shippingCost'),
  'shipment DTO gates shipping cost behind financial visibility',
);

// 3) Portal API + modal wiring.
const api = readActiveClientPortalApiSource();
check(api.includes('/api/client-portal/orders/${orderId}/shipments'), 'portal API exposes orderShipments');

const invoicesPage = readSourceTree([
  'portal-client/src/pages/Invoices.tsx',
  'portal-client/src/components/billing/invoiceColumns.tsx',
  'portal-client/src/components/billing/InvoiceShipmentDrawer.tsx',
  'portal-client/src/components/billing/invoices',
]);
check(
  invoicesPage.includes('aria-label={`View shipment information for order') &&
    invoicesPage.includes('onShipmentSelect({') &&
    invoicesPage.includes('orderId: Number(row.orderId),'),
  'Billing Order # renders as an accessible button that opens the shipment modal',
);
check(
  invoicesPage.includes('useOrderShipments(selection?.orderId ?? null)') && invoicesPage.includes('<Drawer'),
  'shipment modal fetches via the scoped hook and renders in a drawer',
);
check(
  invoicesPage.includes('No shipment record found for this billing line.'),
  'missing shipment data shows the clear empty state',
);
check(
  invoicesPage.includes('shipmentStatusMeta(shipment.shipmentStatus)') &&
    invoicesPage.includes('shipment.displayTrackingNumber') &&
    invoicesPage.includes('shipment.deliveredAt'),
  'modal renders backend shipment status, display tracking, and delivered date',
);
// The billing modal shows the BILLED shipping (from the billing row, matching
// the table) — never the shipment record's internal label cost, which would
// expose margin to clients.
check(
  invoicesPage.includes("label=\"Shipping (billed)\"") &&
    invoicesPage.includes('selection.shippingTotal') &&
    !invoicesPage.includes('shipment.shippingCost'),
  'modal shows billed shipping from the billing row, not the shipment label cost',
);

// 4) package.json exposes this guard.
const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
assert(
  pkg.scripts?.['test:client-portal-billing-shipment-modal'] === 'tsx scripts/client-portal-billing-shipment-modal-guard.ts',
  'package.json exposes test:client-portal-billing-shipment-modal',
);
console.log('ok: package.json exposes test:client-portal-billing-shipment-modal');

if (failed) process.exit(1);
console.log('\nCP-008 client portal billing shipment modal guard passed.');
