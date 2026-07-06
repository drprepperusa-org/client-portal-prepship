// CP-007 guard: Billing line items use backend-owned structured item identity
// (image/name/SKU/qty lines) and hide the carrier from customer-facing rows;
// money columns stay untouched by the display change.
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

// 1) Backend owns structured item identity: the invoice-details read-model
//    aggregates orders.items and shapes it via the shared safeItems shaper.
const readModel = read('src/lib/client-portal/read-models/invoice-details.ts');
check(
  readModel.includes('max(o.items::text) as items_json') && readModel.includes('safeItems(parseItemsJson(row.items_json)'),
  'invoice-details read-model returns structured items from canonical order items',
);
check(
  readModel.includes('scope.canViewFinancials'),
  'structured items respect financial visibility (unit prices gated)',
);
const dto = read('src/lib/client-portal/dto.ts');
check(dto.includes('export function safeItems'), 'safeItems shaper is the shared exported source of item identity');

// 2) Portal DTO type exposes the structured lines.
const api = read('portal-client/src/lib/api.ts');
check(api.includes('items?: PortalItemIdentity[];'), 'BillingInvoiceDetailRow exposes structured items');

// 3) Billing line items render Orders-standard structured identity from the
//    shared backend-owned ItemIdentityLines component — never a collapsed /
//    truncated string. Per 8c4dc49 ("standardize billing column order") the
//    detail table merged the separate "Item Name" column into a single
//    qty-aware SKU(s) column (<SkuLines items={r.items}>); the ItemNameLines /
//    SkuLines identity renderer stays in use for the billing shipment view
//    (s.items). This SKU(s) standard is also pinned by
//    client-portal-invoice-items-guard.ts + client-portal-billing-column-order-guard.mjs.
const invoicesPage = read('portal-client/src/pages/Invoices.tsx');
check(
  invoicesPage.includes('<SkuLines items={r.items}') && !invoicesPage.includes("header: 'Item Name'"),
  'Billing detail line items render the structured qty-aware SKU(s) column from backend items (no separate Item Name column)',
);
check(
  invoicesPage.includes('ItemNameLines') && invoicesPage.includes('<SkuLines items={s.items}'),
  'the shared ItemNameLines/SkuLines identity renderer is still used for billing item identity (shipment view)',
);
const itemIdentity = read('portal-client/src/components/ItemIdentityLines.tsx');
check(
  itemIdentity.includes('HoverZoomImage') || itemIdentity.includes('imageUrl'),
  'shared item-line renderer shows the product image beside the item name',
);

// 4) Carrier is not customer-visible in Billing line items.
check(
  !invoicesPage.includes('CarrierBadge') && !invoicesPage.includes("header: 'Carrier'"),
  'Billing line items have no customer-facing Carrier column',
);

// 5) Money columns/totals are untouched by the display change.
check(
  invoicesPage.includes('money0(num(r.pickpackTotal))') &&
    invoicesPage.includes('money(num(r.rowTotal))') &&
    readModel.includes('as pickpack_total') &&
    readModel.includes('as row_total'),
  'billing money columns and totals remain intact',
);

// 6) package.json exposes this guard.
const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
assert(
  pkg.scripts?.['test:client-portal-billing-item-identity'] === 'tsx scripts/client-portal-billing-item-identity-guard.ts',
  'package.json exposes test:client-portal-billing-item-identity',
);
console.log('ok: package.json exposes test:client-portal-billing-item-identity');

if (failed) process.exit(1);
console.log('\nCP-007 client portal billing item identity guard passed.');
