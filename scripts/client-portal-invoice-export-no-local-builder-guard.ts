/**
 * CP-068 r2 — the bytes the customer downloads are the bytes PrepShip served. Proven by
 * IDENTITY, not by absence.
 *
 * WHY A SECOND GUARD
 * ------------------
 * Hermes r1 (71%) built a disposable alternate exporter — an array of cells joined into a CSV
 * string wrapped in a Blob — and the pattern guard stayed green: it looked for the shapes the
 * OLD builder used (write-excel-file cell literals, exceljs calls, a money format) and an
 * exporter can be written without any of them. "No local builder exists" was confirmed; "the
 * guard stops one from returning" was not.
 *
 * So this guard proves the property instead of the absence:
 *   1. EXECUTABLE — the download path is run with a sentinel Blob. invoiceWorkbookDownload.ts
 *      must hand the sink the SAME object it received; downloadFile.ts must hand
 *      URL.createObjectURL the SAME object it received. Any exporter that assembles content —
 *      cells, CSV, a re-encoded Blob, a data URI — produces a different object and goes red.
 *   2. STATIC WIRING — the hook connects exactly those two functions and nothing else: no
 *      other Blob/File construction, no object URL of its own, no row joining, no spreadsheet
 *      or CSV media type except the pinned backend-file Accept/type-check expressions below.
 * The r1 pattern guard stays as defence in depth; the CP-068 mutation harness applies the
 * Hermes exporter (and eight more) and requires THIS guard to go red on each.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sourceTreeFiles } from './lib/source-tree.mjs';

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
const count = (source: string, pattern: RegExp) => (source.match(pattern) ?? []).length;

let checks = 0;
const ok = (label: string) => { checks += 1; console.log(`PASS ${label}`); };

const HOOK = 'portal-client/src/components/billing/invoices/useInvoiceActions.ts';
const MODULE = 'portal-client/src/lib/invoiceWorkbookDownload.ts';
const DOWNLOAD = 'portal-client/src/lib/downloadFile.ts';
const DOMAIN = 'portal-client/src/lib/api/domains/billing.ts';
const TRANSPORT = 'portal-client/src/lib/api/transport.ts';
const AUDIT_DOMAIN = 'portal-client/src/lib/api/domains/access.ts';
const AUDIT_DOWNLOAD = 'portal-client/src/components/audit/ExportAuditCsv.tsx';

// ── 1. Executable: identity through the download module ─────────────────────────────────────
const { downloadInvoiceWorkbook } = await import('../portal-client/src/lib/invoiceWorkbookDownload');
{
  const sentinel = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01])]);
  const seen: Array<{ bytes: Blob; filename: string }> = [];
  const asked: unknown[] = [];
  const result = await downloadInvoiceWorkbook(
    {
      fetchWorkbook: async (...args) => {
        asked.push(args);
        return { bytes: sentinel, contentType: 'x', filename: 'invoice-Acme-2026-08-01-2026-08-31.xlsx' };
      },
      sink: (file) => { seen.push(file); },
    },
    'Bearer t', 7, '2026-08-01', '2026-08-31',
  );
  assert.equal(seen.length, 1, 'exactly one file reaches the sink');
  assert.ok(seen[0]!.bytes === sentinel, 'the Blob handed to the sink must be the SAME object the API returned');
  assert.equal(seen[0]!.filename, 'invoice-Acme-2026-08-01-2026-08-31.xlsx');
  assert.equal(result.filename, 'invoice-Acme-2026-08-01-2026-08-31.xlsx');
  assert.deepEqual(asked, [['Bearer t', 7, '2026-08-01', '2026-08-31']], 'the fetcher is asked for exactly what the caller asked for');

  const unnamed = await downloadInvoiceWorkbook(
    { fetchWorkbook: async () => ({ bytes: sentinel, contentType: 'x', filename: null }), sink: (file) => { seen.push(file); } },
    'Bearer t', 7, '2026-08-01', '2026-08-31',
  );
  assert.ok(seen[1]!.bytes === sentinel, 'identity holds when the API exposed no filename');
  assert.equal(unnamed.filename, 'invoice-7-2026-08-01-2026-08-31.xlsx', 'the fallback is a NAME, never content');
}
ok('invoiceWorkbookDownload hands the sink the identical Blob it received (sentinel identity)');

// ── 2. Executable: identity through downloadFile, against a stubbed DOM ──────────────────────
{
  const anchor = { href: '', download: '', rel: '', clicks: 0, click() { this.clicks += 1; }, remove() {} };
  const appended: unknown[] = [];
  (globalThis as { document?: unknown }).document = {
    createElement: () => anchor,
    body: { appendChild: (node: unknown) => { appended.push(node); } },
  };
  const scheduled: Array<{ callback: () => void; delay: number }> = [];
  (globalThis as { window?: unknown }).window = {
    setTimeout: (callback: () => void, delay: number) => { scheduled.push({ callback, delay }); return 1; },
  };
  let objectUrlOf: unknown = null;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = ((blob: unknown) => { objectUrlOf = blob; return 'blob:sentinel'; }) as typeof URL.createObjectURL;
  const revoked: string[] = [];
  URL.revokeObjectURL = ((url: string) => { revoked.push(url); }) as typeof URL.revokeObjectURL;
  try {
    const { downloadFile } = await import('../portal-client/src/lib/downloadFile');
    const sentinel = new Blob(['sentinel']);
    downloadFile({ bytes: sentinel, filename: 'invoice-Acme.xlsx' });
    assert.ok(objectUrlOf === sentinel, 'URL.createObjectURL must receive the SAME Blob downloadFile was given');
    assert.equal(anchor.href, 'blob:sentinel', 'the anchor points at the object URL, never a data: URI');
    assert.equal(anchor.download, 'invoice-Acme.xlsx');
    assert.equal(anchor.clicks, 1);
    assert.equal(appended.length, 1);
    assert.equal(scheduled.length, 1, 'one deferred object-URL cleanup');
    assert.equal(scheduled[0]!.delay, 60_000, 'preserve the browser download grace period');
    assert.deepEqual(revoked, [], 'do not revoke before the download starts');
    scheduled[0]!.callback();
    assert.deepEqual(revoked, ['blob:sentinel'], 'cleanup revokes the same object URL');
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
  }
}
ok('downloadFile hands URL.createObjectURL the identical Blob it was given (sentinel identity)');

// ── 3. Static wiring: the hook connects exactly those two functions ──────────────────────────
const hook = read(HOOK);
assert.match(
  hook,
  /downloadInvoiceWorkbook\(\s*\{ fetchWorkbook: portalApi\.invoiceWorkbookRange, sink: downloadFile \},\s*accessToken, clientId, rangeFrom, rangeTo,\s*\)/,
  'exportExcel must wire the API fetcher and downloadFile into downloadInvoiceWorkbook, verbatim',
);
assert.doesNotMatch(hook, /downloadFile\(/, 'the hook may pass downloadFile as the sink but never call it with something of its own');
assert.equal(count(hook, /new Blob\(/g), 1, 'the hook constructs exactly ONE Blob');
assert.match(hook, /new Blob\(\[html\], \{ type: 'text\/html' \}\)/, '…and it is the printable-invoice HTML window, not an export');
assert.equal(count(hook, /new File\(/g), 0, 'the hook constructs no File');
assert.equal(count(hook, /createObjectURL\(/g), 1, 'the hook mints exactly one object URL (the HTML window)');
assert.doesNotMatch(hook, /\.join\(|TextEncoder|btoa\(|encodeURIComponent\(|data:/, 'the hook assembles no file content');
ok('the export hook wires fetcher → downloadInvoiceWorkbook → downloadFile and builds nothing of its own');

const moduleSource = read(MODULE);
assert.doesNotMatch(moduleSource, /\bnew\b|\.map\(|\.join\(|Blob\(|File\(|TextEncoder|stringify|btoa|data:/, 'invoiceWorkbookDownload constructs nothing');
assert.match(moduleSource, /deps\.sink\(\{ bytes: file\.bytes, filename \}\)/, 'the sink receives file.bytes itself');
ok('invoiceWorkbookDownload contains no construction of any kind');

const download = read(DOWNLOAD);
assert.match(download, /URL\.createObjectURL\(file\.bytes\)/, 'downloadFile object-URLs the Blob it was given');
assert.doesNotMatch(download, /new Blob\(|new File\(|\.join\(|TextEncoder|btoa\(|data:|\.text\(\)|\.arrayBuffer\(\)|\.slice\(/, 'downloadFile neither reads nor rebuilds the bytes');
ok('downloadFile neither reads nor rebuilds the bytes');

// ── 4. Static breadth: backend-file media types only at reviewed transport boundaries ───────
// Audit CSV is generated by the server. Exempt only these two expressions, not
// whole files: any additional CSV literal in either file must still fail.
const AUDIT_ACCEPT = "apiBlob(token, '/api/client-portal/audit-log', { ...auditFilters(opts), format: 'csv' }, 'text/csv')";
const AUDIT_TYPE_CHECK = "file.contentType.toLowerCase().startsWith('text/csv')";
const allowedAuditMedia = new Map([[AUDIT_DOMAIN, AUDIT_ACCEPT], [AUDIT_DOWNLOAD, AUDIT_TYPE_CHECK]]);
const FORBIDDEN_MEDIA = [
  ['a CSV media type', /text\/csv/],
  ['a TSV media type', /text\/tab-separated-values/],
  ['a legacy Excel media type', /application\/vnd\.ms-excel/],
  ['an octet-stream media type', /application\/octet-stream/],
  ['a data: URI of a text or application type', /data:(?:text|application)\//],
] as const;
const XLSX_TYPE = /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/g;
const offenders: string[] = [];
for (const file of sourceTreeFiles(['portal-client/src'], root)) {
  const rel = path.relative(root, file).replaceAll('\\', '/');
  let source = readFileSync(file, 'utf8');
  const allowed = allowedAuditMedia.get(rel);
  if (allowed) {
    assert.equal(source.split(allowed).length - 1, 1, `${rel}: exactly one reviewed backend CSV media expression`);
    source = source.replace(allowed, '');
  }
  for (const [what, pattern] of FORBIDDEN_MEDIA) if (pattern.test(source)) offenders.push(`${rel}: ${what}`);
  // The workbook media type is allowed ONLY as the Accept header on the API call.
  if (count(source, XLSX_TYPE) > 0 && rel !== DOMAIN) offenders.push(`${rel}: the workbook media type outside the API Accept header`);
}
assert.deepEqual(offenders, [], `portal code names a spreadsheet/CSV media type or data URI:\n  ${offenders.join('\n  ')}`);
assert.equal(count(read(DOMAIN), XLSX_TYPE), 1, 'the API domain names the workbook media type exactly once, as the Accept header');
ok('media types are restricted to workbook Accept and exact backend audit CSV Accept/type-check expressions');

const auditDomain = read(AUDIT_DOMAIN).replaceAll('\r\n', '\n');
assert.ok(auditDomain.includes(`auditCsv: (token: RequestAuth, opts: PortalAuditLogFilters = {}) =>\n    ${AUDIT_ACCEPT},\n  auditClick:`),
  'audit CSV fetcher returns the bare backend apiBlob call');
assert.doesNotMatch(auditDomain, /\.then\(|\bBlob\(|\bFile\(|bytes:|arrayBuffer|\.text\(\)|TextEncoder|btoa\(/,
  'audit API domain never constructs, chains or reads file bytes');
ok('audit CSV API returns the backend file without replacing its bytes');

const auditDownload = read(AUDIT_DOWNLOAD);
assert.match(auditDownload, /const file = await portalApi\.auditCsv\(\{ accessToken, signal: controller\.signal \}, filters\);/,
  'audit download obtains the backend CSV with the caller filters and cancellation');
assert.match(auditDownload, /downloadFile\(\{ bytes: file\.bytes, filename: file\.filename \?\? 'audit-log\.csv' \}\);/,
  'audit download hands the original Blob to the shared download helper');
assert.equal(count(auditDownload, /downloadFile\(/g), 1, 'audit download has one file sink');
assert.doesNotMatch(auditDownload, /\bBlob\(|\bFile\(|createObjectURL|TextEncoder|btoa\(|arrayBuffer|\.text\(\)|\.slice\(|\.join\(|JSON\.stringify|file\.bytes\s*=/,
  'audit UI never assembles, reads, re-encodes or replaces file bytes');
ok('audit CSV UI preserves backend bytes and cannot become a local builder');

// ── 5. Static breadth: nothing in the export path joins rows into text ───────────────────────
const exportPath = [HOOK, MODULE, DOWNLOAD, DOMAIN, TRANSPORT].map(read).join('\n');
assert.doesNotMatch(exportPath, /\.join\(\s*['"`][,\t;\n]|\\r\\n|\.join\(\s*['"`]\\n/, 'no row/column joining in the export path');
assert.equal(count(read(TRANSPORT), /new Blob\(|new File\(/g), 0, 'the transport returns response.blob(), never a Blob of its own');
assert.match(read(TRANSPORT), /bytes: await response\.blob\(\)/, 'apiBlob hands back the response body itself');
ok('the export path (hook, module, downloadFile, API domain, transport) joins no rows and rebuilds no bytes');

// ── 6. Static: the API-domain fetcher is the transport call itself — nothing between the wire
//      and the module. Hermes r2 rebuilt the Blob INSIDE invoiceWorkbookRange (a `.then` that
//      swapped `bytes`), which the identity checks above cannot see because they start after the
//      fetcher. Only the browser proof caught it. Now the fetcher must be a bare `apiBlob(...)`
//      return and the domain file may not construct, chain or read bytes anywhere. ──────────────
const domainSource = read(DOMAIN);
const bareApiBlobCall = new RegExp([
  'invoiceWorkbookRange: \\(token: RequestAuth, clientId: number, dateFrom: string, dateTo: string\\) =>',
  "\\s*apiBlob\\(\\s*token,\\s*'/api/client-portal/invoice\\.xlsx',[\\s\\S]{0,200}?",
  "'application/vnd\\.openxmlformats-officedocument\\.spreadsheetml\\.sheet',\\s*\\),\\s*generateBilling:",
].join(''));
assert.match(domainSource, bareApiBlobCall, 'invoiceWorkbookRange must RETURN the apiBlob call itself — no chaining, no wrapper, no local bytes');
// `\bBlob\(` deliberately: apiBlob( is the transport call and must stay; `new Blob(` / `globalThis.Blob(` must not.
assert.doesNotMatch(
  domainSource,
  /\.then\(|\bBlob\(|globalThis\.Blob|\bFile\(|bytes:|arrayBuffer|\.text\(\)|TextEncoder|btoa\(/,
  'the API domain never constructs, chains or reads file bytes',
);
ok('the API-domain fetcher is the bare transport call: nothing sits between the wire and the download module');

const EXPECTED_CHECKS = 10;
assert.equal(checks, EXPECTED_CHECKS, `expected ${EXPECTED_CHECKS} checks; ${checks} ran`);
console.log(`\nCP-068 invoice-export no-local-builder guard passed - ${checks}/${EXPECTED_CHECKS} checks`);
