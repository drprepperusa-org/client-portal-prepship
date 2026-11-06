import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { loadFixtureModule } from './lib/load-fixture-module';
import { renderInboundReceiptXlsx } from '../src/lib/client-portal/inbound-receipt-xlsx';
import { inboundReceiptExportHeaders, inboundReceiptExportValues } from '../src/lib/client-portal/inbound-receipt-csv';

const dto = { id: 2402, inventoryId: 1, clientId: 1, clientName: 'Heritage Kids Press', sku: '=SKU<&"',
  name: 'My First Tagalog Shapes, Colors, and Numbers / Ang Aking mga Unang Salita sa Tagalog para sa mga Hugis, Kulay at Numero',
  receivedUnits: 13, receivedAt: '2026-05-15T00:54:32.646Z', note: 'PRIVATE-NOTE' };
const scope = { clientIds: [1], storeIds: [], isGlobal: false };
const filters = { clientId: 1, sortBy: 'sku', sortDir: 'asc' };
const transaction = {};
let calls = 0;
let closed = false;
const owner = loadFixtureModule('src/lib/client-portal/read-models/inbound-receipt-export.ts', {
  '../../../db/client': { db: { transaction: async (read: Function, options: unknown) => {
    assert.deepEqual(options, { isolationLevel: 'repeatable read', accessMode: 'read only' });
    const result = await read(transaction); closed = true; return result;
  } } },
  './inbound-receipts': { listPortalInboundReceipts: async (actualScope: unknown, options: any, tx: unknown) => {
    assert.equal(actualScope, scope); assert.equal(tx, transaction);
    for (const [key, value] of Object.entries(filters)) assert.equal(options[key], value);
    calls++;
    return { data: Array.from({ length: options.page === 1 ? 500 : 1 }, (_, i) => ({ ...dto, id: (options.page - 1) * 500 + i + 1 })),
      pagination: { total: 501, totalPages: 2 } };
  } },
  '../inbound-receipt-xlsx': { renderInboundReceiptXlsx: async (rows: any[]) => {
    assert.ok(closed, 'formatting must happen outside the database transaction');
    return renderInboundReceiptXlsx(rows);
  } },
});
const result = await owner.exportPortalInboundReceipts(scope, filters, 'xlsx');
assert.equal(calls, 2); assert.equal(result.rows, 501);
const zip = await JSZip.loadAsync(result.xlsx);
const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
const styles = await zip.file('xl/styles.xml')!.async('string');
assert.equal((sheet.match(/<row /g) ?? []).length, 502);
assert.match(sheet, /<c r="E2" s="0"><v>13<\/v>/);
assert.match(sheet, /t="inlineStr"><is><t xml:space="preserve">=SKU&lt;&amp;&quot;<\/t>/);
assert.ok(!sheet.includes('<f>')); assert.ok(!sheet.includes('PRIVATE-NOTE'));
assert.ok(sheet.includes(dto.name)); assert.ok(sheet.includes(dto.receivedAt));
for (const header of inboundReceiptExportHeaders) assert.ok(sheet.includes(header));
assert.match(sheet, /width="76" customWidth="1"/);
assert.match(sheet, /state="frozen"/); assert.match(styles, /wrapText="1"/);
assert.match(sheet, /<row r="2" ht="56" customHeight="1">/);
const empty = await JSZip.loadAsync(await renderInboundReceiptXlsx([]));
assert.match(await empty.file('xl/worksheets/sheet1.xml')!.async('string'), /dimension ref="A1:F1"/);
writeFileSync(join(tmpdir(), 'inbound-receipts-xlsx-proof.xlsx'), await renderInboundReceiptXlsx([inboundReceiptExportValues(dto)]));
const routeScope = { ...scope, userId: 'offline', permissions: [], canViewFinancials: false, canViewCredentials: false, isRestricted: true };
const route = loadFixtureModule('src/routes/client-portal/inbound.ts', {
  '../../services/portal-inbound-create': {},
  '../../services/portal-inbound-import': {},
  '../../services/portal-inbound-receive': {},
  '../../services/portal-inbound-receive-plan': {},
  '../../lib/client-portal/audit': { recordPortalAudit: async () => {} },
  '../../lib/client-portal/scope': { isClientPortalScope: (value: unknown) => value === routeScope },
  '../../lib/client-portal/read-models/inbound': {},
  '../../lib/client-portal/read-models/inbound-receipts': {},
  '../../lib/client-portal/query-params': {
    scopeOrResponse: () => routeScope, requestedClientId: () => 1, requestedStoreId: () => undefined,
    parsePage: () => 1, parsePageSize: () => 50,
  },
  '../../lib/client-portal/read-models/inbound-receipt-export': {
    exportPortalInboundReceipts: async (scope: unknown, filters: any, format: string) => {
      assert.equal(scope, routeScope); assert.equal(filters.clientId, 1); assert.equal(format, 'xlsx'); return result;
    }, InboundReceiptExportTooLarge: class extends Error {},
  },
}).default;
const response = await route.request('/inbound/receipts?format=xlsx&clientId=1');
assert.equal(response.status, 200);
assert.equal(response.headers.get('cache-control'), 'private, no-store');
assert.match(response.headers.get('content-type')!, /spreadsheetml.sheet/);
assert.equal(response.headers.get('content-disposition'), 'attachment; filename="inbound-receipts.xlsx"');
assert.deepEqual(new Uint8Array(await response.arrayBuffer()), result.xlsx);
assert.equal((await route.request('/inbound/receipts?format=wrong')).status, 400);
console.log('PASS: XLSX all-page collection, scope/filter delegation, snapshot, redaction, literal text, numeric units, UTC, readable formatting and empty export');
