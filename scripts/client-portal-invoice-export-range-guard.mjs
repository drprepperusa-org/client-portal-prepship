// Billing "Export all" — the whole selected date range (e.g. Apr → Jul) must be
// exportable as ONE Excel, not just per-period.
//
// CP-068 changed WHAT that file is. It used to be assembled in the browser from every
// /invoice-details row (paged through so a multi-month range never truncated). It is now
// PrepShip's own workbook, downloaded through the pass-through route for ONE client over the
// whole range — PrepShip renders it from its uncapped query, so truncation cannot arise and
// there are no rows for the portal to page. Pins: the range export button + handler exist,
// the handler resolves the page to one client and downloads the proxied workbook for the
// full from → to, no code path pages rows for an export any more, and the export path
// touches no carrier / service / rate / margin identity.
//
// The merged multi-client file the old path produced is a DJ decision (spec
// docs/superpowers/specs/2026-09-02-cp-068-invoice-export-prepship-workbook-design.md); until
// then a multi-client page asks the user to pick a client rather than assembling a sheet.
import fs from 'node:fs';
import path from 'node:path';
import { readSourceTree } from './lib/source-tree.mjs';

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

const invoices = readSourceTree([
  'portal-client/src/pages/Invoices.tsx',
  'portal-client/src/components/billing/invoiceColumns.tsx',
  'portal-client/src/components/billing/invoices',
]);
const hook = read('portal-client/src/components/billing/invoices/useInvoiceActions.ts');
const domain = read('portal-client/src/lib/api/domains/billing.ts');
const packageJson = JSON.parse(read('package.json'));

// ── Range export button + handler ──
assert(
  invoices.includes('Export all') &&
    invoices.includes('onClick={props.onExportAll}') &&
    invoices.includes('void actions.exportAllPeriods()'),
  'Billing periods header has an "Export all" button wired to exportAllPeriods',
);
assert(
  hook.includes('async function exportAllPeriods()'),
  'exportAllPeriods handler exists',
);
assert(
  /await exportExcel\(clientId, from, to, 'all-periods'\)/.test(hook),
  'Export all covers the whole selected page range (from → to) for the resolved client',
);

// ── One client per file; the merged form is deferred to DJ, not assembled here ──
assert(
  /const clientId = clientFilter \?\? \(clientIds\.length === 1 \? clientIds\[0\] : undefined\);/.test(hook) &&
    /if \(clientId == null\) \{[\s\S]{0,400}return;/.test(hook),
  'Export all resolves the page to ONE client and asks the user to pick one otherwise',
);
assert(
  !/includeClient|multiClient/.test(hook),
  'no merged multi-client sheet is assembled in the portal (DJ decision pending)',
);

// ── The file is PrepShip's, downloaded whole; nothing pages rows for an export ──
assert(
  /portalApi\.invoiceWorkbookRange\(accessToken, clientId, rangeFrom, rangeTo\)/.test(hook) &&
    hook.includes('downloadFile('),
  'exportExcel downloads PrepShip\'s workbook through the pass-through route and hands the bytes to the browser',
);
assert(
  /invoiceWorkbookRange[\s\S]{0,400}'\/api\/client-portal\/invoice\.xlsx'/.test(domain),
  'invoiceWorkbookRange targets GET /api/client-portal/invoice.xlsx',
);
assert(
  !/fetchAllInvoiceRows|invoiceExcel|pageSize: 5000|INVOICE_EXPORT_PAGE_SIZE/.test(invoices) &&
    !/invoiceDetailsRange/.test(hook),
  'no export code path pages detail rows into the browser (PrepShip renders the whole period)',
);

// ── CP-024: the export path stays client-safe — it must NEVER read carrier / service
// identity, the selected/best rate, the label cost, or the shipping margin. Match CODE-SHAPED
// patterns (property access + specific identifiers) rather than bare words, so prose in
// comments cannot trip the check. ──
const exportPath = `${hook}\n${domain}\n${read('portal-client/src/lib/downloadFile.ts')}`;
assert(
  !/\.(carrier[A-Za-z]*|service[A-Za-z]*|labelCost|selectedRate|bestRate|shippingMargin|providerAccount)\b/i.test(exportPath) &&
    !/\b(carrierCode|carrier_code|serviceCode|service_code|labelCost|label_cost|selectedRate|bestRate|shippingMargin|providerAccount)\b/.test(exportPath),
  'the export path never reads carrier/service/label-cost/selected-rate/margin fields',
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
