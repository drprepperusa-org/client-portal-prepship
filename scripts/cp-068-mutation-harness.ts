/**
 * CP-068 — committed mutation harness: `npm run test:cp-068-mutations`.
 *
 * Hermes r1 wrote a disposable alternate exporter into the hook — cells joined into a CSV
 * string, wrapped in a Blob — and the r1 guard stayed green. That exporter is the FIRST entry
 * below, verbatim in spirit, and the no-local-builder guard must go red on it. The rest are
 * the other ways a second serializer of invoice money could return: a Blob without a media
 * type, a File, a re-encoded Blob in the download helper, a re-wrapped Blob in the download
 * module, a sink that copies the bytes, a data: URI, a cell literal, a domain call that fetches
 * rows instead of the workbook, and an exclusive instant on the route.
 *
 * Each entry breaks ONE property, runs the guard that owns it, and requires red. A mutation
 * whose anchor does not match is NOT APPLIED and fails the run — an unapplied mutation looks
 * exactly like a killed one. Sources are restored after every mutation and the run fails if a
 * file is left modified. Same discipline as scripts/cp-059-mutation-harness.ts.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

type Mutation = {
  readonly label: string;
  readonly file: string;
  readonly guard: string;
  readonly command?: readonly string[];
  readonly from: string;
  readonly to: string;
};

const HOOK = 'portal-client/src/components/billing/invoices/useInvoiceActions.ts';
const MODULE = 'portal-client/src/lib/invoiceWorkbookDownload.ts';
const DOWNLOAD = 'portal-client/src/lib/downloadFile.ts';
const DOMAIN = 'portal-client/src/lib/api/domains/billing.ts';
const ROUTE = 'src/routes/client-portal/invoice-export.ts';

const BUILDER = 'scripts/client-portal-invoice-export-no-local-builder-guard.ts';
const PROXY = 'scripts/client-portal-invoice-export-proxy-guard.ts';
const RANGE = 'node scripts/client-portal-invoice-export-range-guard.mjs';
const RANGE_COMMAND = ['node', 'scripts/client-portal-invoice-export-range-guard.mjs'] as const;

const WIRED_CALL = `      const file = await downloadInvoiceWorkbook(
        { fetchWorkbook: portalApi.invoiceWorkbookRange, sink: downloadFile },
        accessToken, clientId, rangeFrom, rangeTo,
      );`;

export const MUTATIONS: readonly Mutation[] = [
  {
    label: 'HERMES r1: build a CSV from /invoice-details rows (cells + join + Blob text/csv)',
    file: HOOK, guard: BUILDER,
    from: WIRED_CALL,
    to: `      const rows = await portalApi.invoiceDetailsRange(accessToken, rangeFrom, rangeTo, clientId);
      const cells = [['Total'], ...rows.data.map((row) => [String(row.rowTotal)])];
      downloadFile({
        bytes: new Blob([cells.map((row) => row.join(',')).join('\\n')], { type: 'text/csv' }),
        filename: 'invoice.csv',
      });
      const file = { filename: 'invoice.csv' };`,
  },
  {
    label: 'a Blob with no media type and no joining (JSON of the rows)',
    file: HOOK, guard: BUILDER,
    from: WIRED_CALL,
    to: `      const rows = await portalApi.invoiceDetailsRange(accessToken, rangeFrom, rangeTo, clientId);
      downloadFile({ bytes: new Blob([JSON.stringify(rows.data)]), filename: 'invoice.json' });
      const file = { filename: 'invoice.json' };`,
  },
  {
    label: 'a File instead of a Blob',
    file: HOOK, guard: BUILDER,
    from: WIRED_CALL,
    to: `      const rows = await portalApi.invoiceDetailsRange(accessToken, rangeFrom, rangeTo, clientId);
      downloadFile({ bytes: new File([JSON.stringify(rows.data)], 'invoice.txt'), filename: 'invoice.txt' });
      const file = { filename: 'invoice.txt' };`,
  },
  {
    label: 'a sink of the hook\'s own that copies the bytes before downloading',
    file: HOOK, guard: BUILDER,
    from: 'sink: downloadFile },',
    to: 'sink: (f) => downloadFile({ ...f, bytes: f.bytes.slice(0) }) },',
  },
  {
    label: 'the download module re-wraps the Blob',
    file: MODULE, guard: BUILDER,
    from: '  deps.sink({ bytes: file.bytes, filename });',
    to: '  deps.sink({ bytes: new Blob([file.bytes]), filename });',
  },
  {
    label: 'downloadFile re-encodes the bytes as octet-stream',
    file: DOWNLOAD, guard: BUILDER,
    from: '  const url = URL.createObjectURL(file.bytes);',
    to: "  const url = URL.createObjectURL(new Blob([file.bytes], { type: 'application/octet-stream' }));",
  },
  {
    label: 'downloadFile points the anchor at a data: URI',
    file: DOWNLOAD, guard: BUILDER,
    from: '  anchor.href = url;',
    to: "  anchor.href = `data:application/vnd.ms-excel;base64,${btoa('cells')}`;",
  },
  {
    label: 'a write-excel-file cell literal returns to the hook',
    file: HOOK, guard: PROXY,
    from: '    setExporting(busyKey);\n    try {\n      const file = await downloadInvoiceWorkbook(',
    to: "    setExporting(busyKey);\n    const sheet = [{ type: String, value: 'Total' }];\n    void sheet;\n    try {\n      const file = await downloadInvoiceWorkbook(",
  },
  {
    label: 'the API domain fetches detail rows instead of the workbook',
    file: DOMAIN, guard: RANGE, command: RANGE_COMMAND,
    from: "      '/api/client-portal/invoice.xlsx',",
    to: "      '/api/client-portal/invoice-details',",
  },
  {
    label: 'the route sends an exclusive instant instead of the last included day',
    file: ROUTE, guard: PROXY,
    from: 'clientId, dateFrom: range.fromDay, dateTo: range.toDay, format,',
    to: 'clientId, dateFrom: range.fromDay, dateTo: range.toUtcExclusive, format,',
  },
];

function commandFor(mutation: Pick<Mutation, 'guard' | 'command'>): readonly string[] {
  return mutation.command ?? ['npx', 'tsx', mutation.guard];
}

function runGuard(command: readonly string[]): void {
  const [bin, ...args] = command;
  execFileSync(bin!, args, { stdio: 'pipe', shell: process.platform === 'win32' });
}

function assertBaselineGreen(): void {
  const seen = new Map<string, readonly string[]>();
  for (const mutation of MUTATIONS) seen.set(mutation.guard, commandFor(mutation));
  const red: string[] = [];
  for (const [guard, command] of seen) {
    try { runGuard(command); } catch { red.push(guard); }
  }
  if (red.length > 0) {
    console.error('ABORT — these guards are RED before any mutation was applied:');
    for (const guard of red) console.error(`  ${guard}`);
    console.error('A red guard reports every mutation as killed. Fix the baseline first.');
    process.exit(1);
  }
  console.log(`baseline: all ${seen.size} guards green before mutating\n`);
}

function run(): number {
  assertBaselineGreen();
  const files = [...new Set(MUTATIONS.map((m) => m.file))];
  const originals = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));
  const restore = () => { for (const [f, text] of originals) writeFileSync(f, text); };

  let failures = 0;
  for (const mutation of MUTATIONS) {
    const original = originals.get(mutation.file)!;
    const crlf = original.includes('\r\n');
    const normalized = original.split('\r\n').join('\n');
    if (!normalized.includes(mutation.from)) {
      console.error(`NOT APPLIED  ${mutation.label}`);
      console.error(`             anchor missing in ${mutation.file} — this mutation proves nothing`);
      failures += 1;
      continue;
    }
    const mutated = normalized.replace(mutation.from, () => mutation.to);
    writeFileSync(mutation.file, crlf ? mutated.split('\n').join('\r\n') : mutated);
    let killed = false;
    try { runGuard(commandFor(mutation)); } catch { killed = true; }
    restore();
    if (killed) {
      console.log(`killed       ${mutation.label}`);
    } else {
      console.error(`SURVIVED     ${mutation.label}`);
      console.error(`             ${mutation.guard} stayed green while the property was broken`);
      failures += 1;
    }
  }

  restore();
  for (const [f, text] of originals) {
    if (readFileSync(f, 'utf8') !== text) {
      console.error(`RESTORE FAILED for ${f} — the working tree is dirty`);
      failures += 1;
    }
  }
  return failures;
}

const failures = run();
console.log('');
if (failures > 0) {
  console.error(`FAIL CP-068 mutation harness — ${failures} of ${MUTATIONS.length} not killed`);
  process.exit(1);
}
console.log(`PASS CP-068 mutation harness — ${MUTATIONS.length}/${MUTATIONS.length} mutations killed`);
