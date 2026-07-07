import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let failed = false;
function assert(condition, message) {
  if (!condition) {
    failed = true;
    console.error(`FAIL ${message}`);
  } else {
    console.log(`PASS ${message}`);
  }
}

function sliceBetween(source, start, end) {
  const s = source.indexOf(start);
  const e = source.indexOf(end, s + start.length);
  return s >= 0 && e > s ? source.slice(s, e) : '';
}

function orderedContains(source, labels, message) {
  let cursor = -1;
  const missing = [];
  for (const label of labels) {
    const next = source.indexOf(label, cursor + 1);
    if (next < 0) missing.push(label);
    if (next <= cursor) {
      assert(false, `${message}: ${label} appears out of order`);
      return;
    }
    cursor = next;
  }
  assert(missing.length === 0, missing.length ? `${message}: missing ${missing.join(', ')}` : message);
}

const invoices = read('portal-client/src/pages/Invoices.tsx');
const excel = read('portal-client/src/lib/invoiceExcel.ts');
const invoiceHtml = read('src/lib/client-portal/invoice-html.ts');
const invoiceRoute = read('src/routes/client-portal/invoices.ts');
const pkg = JSON.parse(read('package.json'));

const detailLabels = [
  'Ship Date',
  'Order #',
  'SKU(s)',
  'Qty',
  'Pick & Pack',
  'Addl Units',
  'Box Charge',
  'Box Size',
  'Shipping',
  'Storage',
  'Return Processing',
  'Return Postage',
  'Fulfillment Fee',
];

const summaryLabels = [
  'Billing Period',
  'Client',
  'Orders',
  'Pick & Pack',
  'Addl Units',
  'Box Charge',
  'Shipping',
  'Return Processing',
  'Return Postage',
  'Storage',
  'Fulfillment Fee',
];

orderedContains(
  sliceBetween(invoices, 'const summaryCols', 'const lineCols'),
  summaryLabels,
  'Billing periods website columns follow the requested order',
);
orderedContains(
  sliceBetween(invoices, 'const lineCols', 'if (!billingVisible)'),
  detailLabels,
  'Billing line-item website columns follow the requested order',
);
assert(
  !sliceBetween(invoices, 'const lineCols', 'if (!billingVisible)').includes("header: 'Item Name'"),
  'Billing line-item website table does not keep the removed Item Name column',
);

orderedContains(excel, detailLabels, 'Invoice Excel headers follow the requested order');
assert(!excel.includes("'Item Name'"), 'Invoice Excel export does not keep the removed Item Name column');

orderedContains(
  sliceBetween(invoiceHtml, '<thead><tr>', '</tr></thead>'),
  detailLabels.map((label) => (label === 'Pick & Pack' ? 'Pick &amp; Pack' : label)),
  'Printable invoice/PDF table headers follow the requested order',
);
assert(
  /returnProcessingTotal/.test(invoiceHtml) && /returnPostageTotal/.test(invoiceHtml),
  'Printable invoice/PDF renderer includes return processing and return postage totals',
);
assert(
  /returnProcessingTotal/.test(invoiceRoute) && /returnPostageTotal/.test(invoiceRoute),
  'Printable invoice route passes return processing and return postage totals',
);

assert(
  pkg.scripts?.['test:client-portal-billing-column-order'] ===
    'node scripts/client-portal-billing-column-order-guard.mjs',
  'package exposes test:client-portal-billing-column-order',
);

if (failed) process.exit(1);
console.log('\nclient portal billing column order guard passed.');
