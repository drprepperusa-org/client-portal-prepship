/**
 * CP-068 — the portal's invoice Export is PrepShip's file. Nothing in this repository builds
 * invoice spreadsheet cells.
 *
 * WHY
 * ---
 * The portal used to assemble its own `.xlsx` in the browser: its own column list, its own
 * cell decisions, a totals row summed client-side. That was a second serializer of invoice
 * money beside the printable invoice, which already renders PrepShip's canonical totals. DJ's
 * rule is "always the same data whatever export/invoice, excel or CSV" — only PrepShip's own
 * bytes satisfy that by construction.
 *
 * TWO HALVES
 * ----------
 * Static: no spreadsheet writer is a dependency or an import anywhere in portal code, no
 * cell-shaped literal survives, the export hook downloads the proxied workbook, the route
 * gates scope before upstream and sends DAYS only, and the wiring (timeout exemption, CORS
 * exposure, package scripts, CI step) is in place.
 *
 * Executable: the proxy runs against a stubbed fetch. It forwards the bearer verbatim, sends
 * plain days, returns the producer's bytes unmodified, and fails closed on every wrong shape —
 * a non-ZIP `.xlsx`, a wrong content type, an empty body, an upstream 5xx, a thrown transport.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { sourceTreeFiles } from './lib/source-tree.mjs';

process.env.PREPSHIP_API_URL ??= 'http://canonical.test';
process.env.DATABASE_URL ??= 'postgres://u:p@127.0.0.1:5432/unused';
process.env.SUPABASE_URL ??= 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY ??= 'cp068-guard';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'cp068-guard';
process.env.SUPABASE_JWT_SECRET ??= 'cp068-guard';
process.env.NODE_ENV ??= 'test';

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

let checks = 0;
const ok = (label: string) => { checks += 1; console.log(`PASS ${label}`); };

// ── 1. No spreadsheet writer anywhere in portal code ─────────────────────────────────────────
const SPREADSHEET_WRITERS = ['write-excel-file', 'exceljs', 'xlsx', 'sheetjs', 'xlsx-populate', 'xlsx-js-style'];
for (const manifest of ['package.json', 'portal-client/package.json']) {
  const pkg = JSON.parse(read(manifest)) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const offending = declared.filter((name) => SPREADSHEET_WRITERS.includes(name));
  assert.deepEqual(offending, [], `${manifest} must not depend on a spreadsheet writer: ${offending.join(', ')}`);
}
ok('neither package manifest depends on a spreadsheet writer');

assert.equal(existsSync(path.join(root, 'portal-client/src/lib/invoiceExcel.ts')), false,
  'portal-client/src/lib/invoiceExcel.ts must stay deleted — it was the second serializer');
ok('the local sheet builder (invoiceExcel.ts) is gone');

// ── 2. No cell-shaped code survives in any portal source ─────────────────────────────────────
// Patterns are CODE-SHAPED (a write-excel-file cell literal, exceljs worksheet calls, a money
// number format, a SUM formula), not bare words, so prose in comments cannot trip them and a
// rename cannot dodge them.
const CELL_SHAPES: Array<[string, RegExp]> = [
  ['a spreadsheet writer import', /(?:from\s+|import\(\s*|require\(\s*)['"](?:write-excel-file|exceljs|xlsx|sheetjs|xlsx-populate|xlsx-js-style)['"]/],
  ['a write-excel-file cell literal', /\{\s*type:\s*(?:String|Number|Date|Boolean)\s*,\s*value:/],
  ['a bold-cell literal', /fontWeight:\s*['"]bold['"]/],
  ['a money number format', /['"]#,##0\.00['"]/],
  ['an exceljs worksheet call', /\.(?:addWorksheet|addRow|getCell)\(/],
  ['a spreadsheet SUM formula', /\bSUM\(\s*[A-Z]{1,2}\d/],
  ['the retired sheet builder', /\b(?:buildInvoiceExcelSheet|exportInvoiceExcel|writeXlsxFile)\b/],
];
const SCANNED = ['portal-client/src', 'src/lib/client-portal', 'src/routes/client-portal'];
const offenders: string[] = [];
for (const file of sourceTreeFiles(SCANNED, root)) {
  const source = readFileSync(file, 'utf8');
  for (const [what, pattern] of CELL_SHAPES) {
    if (pattern.test(source)) offenders.push(`${path.relative(root, file)}: ${what}`);
  }
}
assert.deepEqual(offenders, [], `portal code builds spreadsheet cells locally:\n  ${offenders.join('\n  ')}`);
ok(`no cell-shaped code in ${SCANNED.join(', ')}`);

// ── 3. The export hook downloads the proxied workbook and reads no rows ──────────────────────
const hook = read('portal-client/src/components/billing/invoices/useInvoiceActions.ts');
assert.match(hook, /fetchWorkbook:\s*portalApi\.invoiceWorkbookRange/, 'exportExcel must download PrepShip\'s workbook through the proxy');
assert.match(hook, /downloadInvoiceWorkbook\(/, 'the bytes go straight to the download manager via invoiceWorkbookDownload.ts');
for (const forbidden of ['invoiceDetailsRange', 'fetchAllInvoiceRows', 'invoiceExcel', 'invoiceRows']) {
  assert.doesNotMatch(hook, new RegExp(forbidden), `the export hook must not touch ${forbidden} — the export reads no rows`);
}
ok('the export hook downloads the proxied workbook and never pages rows into the browser');

const domain = read('portal-client/src/lib/api/domains/billing.ts');
assert.match(domain, /invoiceWorkbookRange[\s\S]{0,400}apiBlob\(\s*token,\s*'\/api\/client-portal\/invoice\.xlsx'/,
  'invoiceWorkbookRange must GET /api/client-portal/invoice.xlsx as a binary download');
ok('the API client targets the pass-through route');

const download = read('portal-client/src/lib/downloadFile.ts');
assert.match(download, /createObjectURL\(file\.bytes\)/, 'downloadFile hands the bytes over unmodified');
ok('downloadFile hands the bytes to the browser unmodified');

// ── 4. The route: scope first, one client, DAYS only ─────────────────────────────────────────
const route = read('src/routes/client-portal/invoice-export.ts');
const at = (needle: string) => {
  const index = route.indexOf(needle);
  assert.ok(index >= 0, `invoice-export.ts must contain: ${needle}`);
  return index;
};
assert.ok(
  at('scopeOrResponse(c)') < at('canViewFinancials')
    && at('canViewFinancials') < at('Missing bearer token')
    && at('Missing bearer token') < at('clientFilterPredicate(')
    && at('clientFilterPredicate(') < at('fetchCanonicalInvoiceExport('),
  'scope, financials, bearer and client visibility must all be decided BEFORE the upstream call',
);
ok('the route decides scope, financials, bearer and client visibility before calling PrepShip');
// Read the CALL, not the file: the file's own comments name the instant they warn against.
const upstreamCall = /fetchCanonicalInvoiceExport\(authorization,\s*\{([\s\S]*?)\}/.exec(route)?.[1] ?? '';
assert.match(upstreamCall, /dateFrom:\s*range\.fromDay,\s*dateTo:\s*range\.toDay/, 'the route must send operator DAYS');
assert.doesNotMatch(upstreamCall, /Utc/, 'no instant may cross the export boundary');
assert.match(route, /requestedClientId\(c\)/, 'the route asks for exactly one client');
ok('only YYYY-MM-DD days cross the boundary, for exactly one client');

assert.match(route, /app\.get\('\/invoice\.xlsx',\s*\(c\)\s*=>\s*handleInvoiceExport\(c,\s*'xlsx'\)\)/);
assert.match(route, /app\.get\('\/invoice\.csv',\s*\(c\)\s*=>\s*handleInvoiceExport\(c,\s*'csv'\)\)/);
const aggregator = read('src/routes/client-portal.ts');
assert.match(aggregator, /import invoiceExportRoute from '\.\/client-portal\/invoice-export';/);
assert.match(aggregator, /app\.route\('\/',\s*invoiceExportRoute\);/, 'the export sub-router must be mounted on the /api/client-portal surface');
ok('both export routes are registered through the shared handler and mounted by the aggregator');

// ── 5. Wiring: timeout exemption, CORS exposure, scripts, CI ─────────────────────────────────
const timeout = read('src/middleware/request-timeout.ts');
assert.match(timeout, /'\/api\/client-portal\/invoice\.xlsx'/);
assert.match(timeout, /'\/api\/client-portal\/invoice\.csv'/);
ok('the export routes are exempt from the 15s request budget (PrepShip owns the ceiling)');
assert.match(read('src/main.ts'), /exposeHeaders:\s*\[[^\]]*'Content-Disposition'/, 'the browser must be able to read PrepShip\'s filename');
ok('CORS exposes Content-Disposition');

const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
assert.equal(pkg.scripts?.['test:client-portal-invoice-export-proxy'], 'tsx scripts/client-portal-invoice-export-proxy-guard.ts');
assert.equal(
  pkg.scripts?.['test:client-portal-invoice-export-cp068:integration'],
  'tsx scripts/integration/client-portal-invoice-export-cp068.integration.ts',
);
assert.match(read('.github/workflows/integration-tests.yml'), /npm run test:client-portal-invoice-export-cp068:integration/,
  'the integration suite must run in hosted CI');
ok('package.json and CI wire the guard and the integration suite');

// ── 6. Executable: the proxy against a stubbed upstream ──────────────────────────────────────
const { env } = await import('../src/lib/env');
const {
  fetchCanonicalInvoiceExport, isZipContainer, exportFilenameFrom,
} = await import('../src/lib/client-portal/prepship-invoice-export-proxy');

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const WORKBOOK = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0x08, 0x00, 0x99, 0x42]);
const captured = { calls: 0, url: '', authorization: null as string | null, accept: null as string | null };
const originalFetch = globalThis.fetch;
const stub = (body: BodyInit | null, init: { status?: number; headers?: Record<string, string> } = {}, throwing?: Error) => {
  captured.calls = 0; captured.url = ''; captured.authorization = null; captured.accept = null;
  globalThis.fetch = (async (input: unknown, requestInit?: RequestInit) => {
    captured.calls += 1;
    captured.url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
    const headers = new Headers(requestInit?.headers ?? {});
    captured.authorization = headers.get('authorization');
    captured.accept = headers.get('accept');
    if (throwing) throw throwing;
    return new Response(body, { status: init.status ?? 200, headers: init.headers ?? {} });
  }) as typeof fetch;
};
const QUERY = { clientId: 7, dateFrom: '2026-08-01', dateTo: '2026-08-31', format: 'xlsx' as const };
const BEARER = 'Bearer cp068-caller';

try {
  // 6a. happy path: bytes, type and filename pass through unmodified; bearer + days on the wire.
  stub(WORKBOOK, { headers: { 'content-type': XLSX_TYPE, 'content-disposition': 'attachment; filename="invoice-Acme-2026-08-01-2026-08-31.xlsx"' } });
  const happy = await fetchCanonicalInvoiceExport(BEARER, QUERY, 'req-1');
  assert.ok(happy.ok, `expected ok, got ${happy.ok ? '' : happy.code}`);
  assert.deepEqual([...happy.bytes], [...WORKBOOK], 'the producer\'s bytes must pass through unmodified');
  assert.equal(happy.contentType, XLSX_TYPE);
  assert.equal(happy.filename, 'invoice-Acme-2026-08-01-2026-08-31.xlsx', 'PrepShip\'s filename is kept');
  assert.equal(captured.url, 'http://canonical.test/billing/invoice.xlsx?clientId=7&dateFrom=2026-08-01&dateTo=2026-08-31');
  assert.equal(captured.authorization, BEARER, 'the caller bearer is forwarded verbatim');
  assert.equal(captured.accept, XLSX_TYPE);
  ok('happy path: bytes, type and filename pass through; bearer and plain days on the wire');

  // 6b. an unsafe upstream filename is replaced, never echoed into a header.
  stub(WORKBOOK, { headers: { 'content-type': XLSX_TYPE, 'content-disposition': 'attachment; filename="../x y.xlsx"' } });
  const unsafe = await fetchCanonicalInvoiceExport(BEARER, QUERY);
  assert.ok(unsafe.ok);
  assert.equal(unsafe.filename, 'invoice-7-2026-08-01-2026-08-31.xlsx');
  assert.equal(exportFilenameFrom('attachment; filename="a b.xlsx"', 'fb.xlsx'), 'fb.xlsx');
  assert.equal(exportFilenameFrom(null, 'fb.xlsx'), 'fb.xlsx');
  ok('an unsafe upstream filename falls back to a portal-built safe name');

  // 6c. an HTML page with a 200 is NOT a workbook.
  stub('<html>login</html>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
  const html = await fetchCanonicalInvoiceExport(BEARER, QUERY);
  assert.equal(html.ok, false);
  assert.equal(!html.ok && html.status, 502);
  assert.equal(!html.ok && html.code, 'prep_ship_invoice_export_contract_mismatch');
  ok('a 200 with the wrong content type fails closed (502 contract mismatch)');

  // 6d. the right content type around bytes that are not a ZIP container.
  stub('not a zip at all', { headers: { 'content-type': XLSX_TYPE } });
  const notZip = await fetchCanonicalInvoiceExport(BEARER, QUERY);
  assert.equal(notZip.ok, false);
  assert.equal(!notZip.ok && notZip.status, 502);
  assert.equal(isZipContainer(new TextEncoder().encode('PK')), false, 'three bytes are not a signature');
  assert.equal(isZipContainer(WORKBOOK), true);
  ok('an .xlsx body that is not a ZIP container fails closed');

  // 6e. an empty body fails closed.
  stub(new Uint8Array(0), { headers: { 'content-type': XLSX_TYPE } });
  const empty = await fetchCanonicalInvoiceExport(BEARER, QUERY);
  assert.equal(empty.ok, false);
  assert.equal(!empty.ok && empty.status, 502);
  ok('an empty body fails closed');

  // 6f. upstream statuses: 5xx → 502 unavailable; 401/403 → same status, generic detail.
  stub('boom', { status: 500, headers: { 'content-type': 'text/plain' } });
  const five = await fetchCanonicalInvoiceExport(BEARER, QUERY);
  assert.equal(!five.ok && five.status, 502);
  assert.equal(!five.ok && five.code, 'prep_ship_invoice_export_unavailable');
  stub('Forbidden', { status: 403 });
  const forbidden = await fetchCanonicalInvoiceExport(BEARER, QUERY);
  assert.equal(!forbidden.ok && forbidden.status, 403);
  assert.equal(!forbidden.ok && forbidden.error, 'Not found', 'a scope denial carries no detail');
  stub('Unauthorized', { status: 401 });
  const unauthorized = await fetchCanonicalInvoiceExport(BEARER, QUERY);
  assert.equal(!unauthorized.ok && unauthorized.status, 401);
  stub('Client not found', { status: 404 });
  const missing = await fetchCanonicalInvoiceExport(BEARER, QUERY);
  assert.equal(!missing.ok && missing.status, 502, 'a scope disagreement with the producer is a 502, not an enumerable 404');
  ok('upstream 5xx/404 → 502; 401/403 keep their status with a generic detail');

  // 6g. a thrown transport (timeout, DNS) fails closed.
  stub(null, {}, new Error('ECONNRESET'));
  const thrown = await fetchCanonicalInvoiceExport(BEARER, QUERY);
  assert.equal(!thrown.ok && thrown.status, 502);
  ok('a transport failure fails closed');

  // 6h. an instant must never reach the wire — it is a programming error, so it throws.
  stub(WORKBOOK, { headers: { 'content-type': XLSX_TYPE } });
  await assert.rejects(
    () => fetchCanonicalInvoiceExport(BEARER, { ...QUERY, dateTo: '2026-09-01T00:00:00.000Z' }),
    /only YYYY-MM-DD days/,
  );
  assert.equal(captured.calls, 0, 'an instant must not reach upstream');
  ok('an exclusive instant is refused before any upstream call');

  // 6i. CSV rides the same rules.
  stub('a,b\n1,2\n', { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="invoice-Acme-2026-08-01-2026-08-31.csv"' } });
  const csv = await fetchCanonicalInvoiceExport(BEARER, { ...QUERY, format: 'csv' });
  assert.ok(csv.ok);
  assert.equal(csv.contentType, 'text/csv');
  assert.equal(csv.filename, 'invoice-Acme-2026-08-01-2026-08-31.csv');
  assert.equal(new TextDecoder().decode(csv.bytes), 'a,b\n1,2\n');
  assert.equal(captured.url, 'http://canonical.test/billing/invoice.csv?clientId=7&dateFrom=2026-08-01&dateTo=2026-08-31');
  stub('a,b\n', { headers: { 'content-type': XLSX_TYPE } });
  const csvWrongType = await fetchCanonicalInvoiceExport(BEARER, { ...QUERY, format: 'csv' });
  assert.equal(!csvWrongType.ok && csvWrongType.status, 502);
  ok('the CSV passes through under the same rules and fails closed on the wrong type');

  // 6j. no configuration → 503 without a call.
  const configured = env.PREPSHIP_API_URL;
  (env as { PREPSHIP_API_URL?: string }).PREPSHIP_API_URL = undefined;
  stub(WORKBOOK, { headers: { 'content-type': XLSX_TYPE } });
  const unconfigured = await fetchCanonicalInvoiceExport(BEARER, QUERY);
  (env as { PREPSHIP_API_URL?: string }).PREPSHIP_API_URL = configured;
  assert.equal(!unconfigured.ok && unconfigured.status, 503);
  assert.equal(captured.calls, 0);
  ok('a missing PREPSHIP_API_URL is a 503 with no upstream call');
} finally {
  globalThis.fetch = originalFetch;
}

const EXPECTED_CHECKS = 22;
assert.equal(checks, EXPECTED_CHECKS, `expected ${EXPECTED_CHECKS} checks; ${checks} ran`);
console.log(`\nCP-068 invoice-export proxy guard passed - ${checks}/${EXPECTED_CHECKS} checks`);
