/**
 * CP-068 — regenerate the committed PrepShip invoice workbook fixture.
 *
 * The fixture is produced by PrepShip's REAL `renderInvoiceXlsx` (src/routes/billing.ts on the
 * prepshipv4-stable checkout), never by anything in this repository, so the integration suite
 * asserts against bytes the producer actually emits. The sidecar records the producer SHA, the
 * sha256 of the bytes, and the header row, so a hand-edited or stale fixture is detectable.
 *
 * Run from the PrepShip checkout so its own dotenv config resolves (nothing connects to a
 * database — the renderer is pure once given rows):
 *
 *   cd ../prepship-v4 && npx tsx ../client-portal-prepship/scripts/fixtures/generate-cp068-invoice-workbook.mts
 *
 * PREPSHIP_CHECKOUT overrides the sibling path. Output: fixtures/cp-068-prepship-invoice-workbook.{xlsx,json}.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import JSZip from 'jszip';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORTAL_ROOT = path.resolve(HERE, '..', '..');
const CHECKOUT = path.resolve(process.env.PREPSHIP_CHECKOUT ?? path.join(PORTAL_ROOT, '..', 'prepship-v4'));

// The renderer is pure, but PrepShip validates its whole environment at import. None of these
// values reach a network: no query runs, no client connects.
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgres://u:p@127.0.0.1:5432/unused';
process.env.SUPABASE_URL ??= 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY ??= 'fixture';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fixture';
process.env.SUPABASE_JWT_SECRET ??= 'fixture';
process.env.JWT_SECRET ??= 'fixture';
process.env.SESSION_SECRET ??= 'fixture';
process.env.ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

const billing = await import(pathToFileURL(path.join(CHECKOUT, 'src', 'routes', 'billing.ts')).href) as {
  renderInvoiceXlsx: (args: unknown) => Promise<Buffer>;
};
const columns = await import(pathToFileURL(path.join(CHECKOUT, 'src', 'routes', 'billing-invoice-columns.ts')).href) as {
  INVOICE_COLUMN_HEADERS: readonly string[];
};

const producerSha = execFileSync('git', ['-C', CHECKOUT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

// Three rows PrepShip's SQL shape can produce: an outbound with no return fees, a return with
// both fees, and a replacement re-ship. Deterministic on purpose — the fixture's job is to be
// the producer's bytes for a known input, not to be realistic.
const row = (over: Record<string, unknown>) => ({
  order_id: 9001, order_number: '9001', shipment_id: 5001, return_id: null,
  ship_date: '2026-08-05T17:00:00.000Z', billing_effective_date: '2026-08-05T17:00:00.000Z',
  billing_policy_version: 'ps-437-v1', billing_adjustment_id: null, source_finalization_id: null,
  adjustment_description: null, base_qty: '1', addl_qty: '0', pickpack_amt: '2.50',
  additional_amt: '0', shipping_amt: '6.10', storage_amt: '0', return_postage_amt: '0',
  return_processing_amt: '0', replace_postage_amt: '0', replace_pick_pack_amt: '0',
  has_return_postage_line: false, has_return_processing_line: false, return_reference: null,
  row_total: '8.60', item_names: 'Widget A', skus: 'SKU-A', carrier_code: 'usps',
  package_cost_amt: '0', box_label: 'Small', box_review: false, destination: 'Domestic',
  order_number_label: '9001', fee_waived: false, ...over,
});
const details = [
  row({}),
  row({
    order_id: 9002, order_number: '9002', shipment_id: 5002, return_id: 501,
    has_return_postage_line: true, return_postage_amt: '7.73',
    has_return_processing_line: true, return_processing_amt: '3.00',
    pickpack_amt: '0', shipping_amt: '0', row_total: '10.73', return_reference: '9002-RETURN',
    order_number_label: '9002 - Return', skus: 'SKU-B', item_names: 'Widget B',
    destination: 'International',
  }),
  row({
    order_id: 9003, order_number: '9003', shipment_id: 5003, replace_postage_amt: '4.20',
    replace_pick_pack_amt: '1.50', pickpack_amt: '0', shipping_amt: '0', row_total: '5.70',
    order_number_label: '9003-REPLACE', skus: 'SKU-C', item_names: 'Widget C',
  }),
];
const totals = {
  orderCount: 3, pickPackTotal: 2.5, additionalTotal: 0, pickPackFeeTotal: 2.5, packageTotal: 0,
  shippingTotal: 6.1, storageTotal: 0, adjustmentTotal: 0, grandTotal: 25.03, fulfillmentFeeTotal: 25.03,
};

const rendered = await billing.renderInvoiceXlsx({
  clientName: 'CP068 Fixture Client', fromDay: '2026-08-01', toDay: '2026-08-31', totals, details,
});

/*
 * DETERMINISM. ExcelJS stamps docProps/core.xml and every ZIP entry with "now", so two runs of
 * the real renderer differ in CONTAINER METADATA while every worksheet, style, shared-string
 * and workbook member is byte-identical (Hermes r1 measured exactly that: 7546 vs 7545 bytes,
 * all business members equal). The integration suite compares the whole-file sha256, so those
 * stamps are pinned to one instant here and the container is re-emitted with fixed settings.
 * Only metadata moves; the members carrying business content are the renderer's, untouched —
 * their own sha256 is recorded in the sidecar so a re-audit can compare member by member.
 */
const FIXED_INSTANT = new Date('2026-09-02T00:00:00.000Z');
const sha256 = (buffer: Uint8Array) => createHash('sha256').update(buffer).digest('hex');
const zip = await JSZip.loadAsync(rendered);
const core = await zip.file('docProps/core.xml')?.async('string');
if (core) {
  const stamp = FIXED_INSTANT.toISOString();
  zip.file('docProps/core.xml', core
    .replace(/(<dcterms:created[^>]*>)[^<]*(<\/dcterms:created>)/, (_m, open, close) => `${open}${stamp}${close}`)
    .replace(/(<dcterms:modified[^>]*>)[^<]*(<\/dcterms:modified>)/, (_m, open, close) => `${open}${stamp}${close}`));
}
zip.forEach((_name, entry) => { entry.date = FIXED_INSTANT; });
const bytes = await zip.generateAsync({
  type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 }, platform: 'UNIX',
});
const BUSINESS_MEMBERS = ['xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml', 'xl/sharedStrings.xml'];
const memberSha256: Record<string, string> = {};
for (const name of BUSINESS_MEMBERS) {
  const member = zip.file(name);
  if (member) memberSha256[name] = sha256(await member.async('nodebuffer'));
}

const outDir = path.join(PORTAL_ROOT, 'fixtures');
const workbookPath = path.join(outDir, 'cp-068-prepship-invoice-workbook.xlsx');
const sidecarPath = path.join(outDir, 'cp-068-prepship-invoice-workbook.json');

// `--check`: regenerate in memory and compare against the committed fixture. Exit 1 on drift.
if (process.argv.includes('--check')) {
  const committed = readFileSync(workbookPath);
  const same = sha256(committed) === sha256(bytes);
  console.log(`${same ? 'MATCH' : 'DRIFT'}: committed ${sha256(committed).slice(0, 12)} vs regenerated ${sha256(bytes).slice(0, 12)} (${bytes.byteLength} bytes)`);
  process.exit(same ? 0 : 1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(workbookPath, bytes);
writeFileSync(sidecarPath, `${JSON.stringify({
  producerSha,
  sha256: sha256(bytes),
  sheet: 'Invoice',
  headers: columns.INVOICE_COLUMN_HEADERS,
  dataRows: details.length,
  fixtureClient: 'CP068 Fixture Client',
  period: { fromDay: '2026-08-01', toDay: '2026-08-31' },
  normalization: {
    docPropsTimestamps: FIXED_INSTANT.toISOString(),
    zipEntryDates: FIXED_INSTANT.toISOString(),
    container: 'jszip DEFLATE level 6, platform UNIX',
    businessMembersUntouched: BUSINESS_MEMBERS,
  },
  memberSha256,
}, null, 2)}\n`);
console.log(`wrote fixtures/cp-068-prepship-invoice-workbook.xlsx (${bytes.byteLength} bytes, sha256 ${sha256(bytes).slice(0, 12)}) from producer ${producerSha}`);
