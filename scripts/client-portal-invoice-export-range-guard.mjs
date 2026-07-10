// Billing "Export all" — the whole selected date range (e.g. Apr → Jul) must
// be exportable as ONE Excel, not just per-period. Pins: the range export
// button + handler exist, the fetch pages through every line item (so a
// multi-month range never silently truncates at the unpaginated 5000/1000-row
// cap), and multi-client exports carry a Client column.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS ${message}`);
}

const invoices = [
  read('portal-client/src/pages/Invoices.tsx'),
  read('portal-client/src/components/billing/invoiceColumns.tsx'),
].join('\n');
const invoiceRows = read('portal-client/src/lib/invoiceRows.ts');
const excel = read('portal-client/src/lib/invoiceExcel.ts');
const packageJson = JSON.parse(read('package.json'));

// ── Range export button + handler ──
assert(
  invoices.includes('Export all') && invoices.includes('void exportAllPeriods()'),
  'Billing periods header has an "Export all" button wired to exportAllPeriods',
);
assert(
  invoices.includes('async function exportAllPeriods()'),
  'exportAllPeriods handler exists',
);
assert(
  invoices.includes('fetchAllInvoiceRows(accessToken, clientId, from, to)'),
  'Export all covers the whole selected page range (from → to), not a single period',
);

// ── Completeness: page through every line item, never a single capped shot ──
assert(
  invoices.includes('async function fetchAllInvoiceRows('),
  'a paginated fetch-all helper exists',
);
assert(
  invoiceRows.includes('res.pagination?.totalPages') && invoiceRows.includes('pageSize: INVOICE_EXPORT_PAGE_SIZE'),
  'fetchAllInvoiceRows walks every page via pagination.totalPages',
);
assert(
  !invoices.includes('pageSize: 5000'),
  'exports no longer rely on the single-shot 5000-row cap that could silently truncate a multi-month range',
);
assert(
  invoices.includes('fetchAllInvoiceRows(accessToken, clientId, rangeFrom, rangeTo)'),
  'per-period export also pages through (shares the fetch-all helper)',
);

// ── Multi-client exports stay attributable ──
assert(
  invoices.includes('includeClient: multiClient'),
  'Export all flags a multi-client file so a Client column is added',
);
assert(
  excel.includes('includeClient') && excel.includes("'Client'"),
  'exportInvoiceExcel prepends a Client column when includeClient is set',
);

// ── CP-024: the Excel export must stay client-safe — the .xlsx must NEVER
// leak carrier / service identity, the selected/best rate, the label cost, or
// the shipping margin. The customer-facing "Shipping" column is the billed
// customer shipping charge (BillingInvoiceDetailRow), not any provider cost.
// Match CODE-SHAPED patterns (property access + specific identifiers) rather
// than bare words, so the file's own "no carrier / margin" prose doesn't trip
// the check and no comment-stripping (which a `//` inside a string could defeat)
// is needed. Note: shippingTotal (the billed customer charge) is intentionally
// NOT matched — only shippingMargin/provider cost is. ──
assert(
  !/\.(carrier[A-Za-z]*|service[A-Za-z]*|labelCost|selectedRate|bestRate|shippingMargin|providerAccount)\b/i.test(excel) &&
    !/\b(carrierCode|carrier_code|serviceCode|service_code|labelCost|label_cost|selectedRate|bestRate|shippingMargin|providerAccount)\b/.test(excel),
  'invoiceExcel never reads carrier/service/label-cost/selected-rate/margin fields (property access or identifier)',
);
assert(
  !/['"`]\s*(Carrier|Service|Label Cost|Selected Rate|Best Rate|Margin)\s*['"`]/.test(excel),
  'invoiceExcel column headers expose no Carrier / Service / Label Cost / Rate / Margin column',
);

assert(
  packageJson.scripts?.['test:client-portal-invoice-export-range'] ===
    'node scripts/client-portal-invoice-export-range-guard.mjs',
  'package exposes test:client-portal-invoice-export-range',
);

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log('\nclient portal invoice range-export guard passed.');
