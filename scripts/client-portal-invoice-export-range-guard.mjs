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

const invoices = read('portal-client/src/pages/Invoices.tsx');
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
  invoices.includes('fetchAllInvoiceRows(accessToken, effectiveClientId, from, to)'),
  'Export all covers the whole selected page range (from → to), not a single period',
);

// ── Completeness: page through every line item, never a single capped shot ──
assert(
  invoices.includes('async function fetchAllInvoiceRows('),
  'a paginated fetch-all helper exists',
);
assert(
  invoices.includes('res.pagination?.totalPages') && invoices.includes('pageSize: PAGE_SIZE'),
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

assert(
  packageJson.scripts?.['test:client-portal-invoice-export-range'] ===
    'node scripts/client-portal-invoice-export-range-guard.mjs',
  'package exposes test:client-portal-invoice-export-range',
);

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log('\nclient portal invoice range-export guard passed.');
