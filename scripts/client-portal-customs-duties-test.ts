/** Execute producer-fixture -> API boundary -> DTO -> printed cells, without DB/network. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

process.env.DATABASE_URL = 'postgres://fixture:fixture@127.0.0.1:1/unused';
process.env.SUPABASE_JWT_SECRET = 'customs-duties-test';
process.env.SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_ANON_KEY = 'fixture';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture';
process.env.PREPSHIP_API_URL = 'http://canonical.test';
process.env.NODE_ENV = 'test';
const { toCanonicalBillingEventRow, parseCanonicalBillingTotals, fetchCanonicalBillingDetails } =
  await import('../src/lib/client-portal/prepship-billing-details-proxy.js');
const { toPortalDetailRow, orderCanonicalEvents } = await import('../src/lib/client-portal/read-models/canonical-invoice-events.js');
const { fetchCanonicalInvoiceTotals } = await import('../src/lib/client-portal/prepship-invoice-totals-proxy.js');
const { renderPortalInvoiceHtml } = await import('../src/lib/client-portal/invoice-html.js');
const { INVOICE_SORT_FIELDS } = await import('../src/lib/client-portal/contracts/sorting.js');

const fixture = JSON.parse(readFileSync('fixtures/customs-duties-producer-rows.json', 'utf8'));
assert.match(fixture.producerSha, /^[a-f0-9]{40}$/);
assert.equal(createHash('sha256').update(JSON.stringify(fixture.shapes)).digest('hex'), fixture.contentHash);
const expected = new Map([
  ['split-shipment-duty', [3.49, true, 28.81]], ['explicit-zero', [0, true, 25.32]],
  ['missing-duty', [0, false, 25.32]], ['cancelled', [0, true, 0]],
  ['fractional-cents-sum', [0.3, true, 25.62]],
]);
const totals = { orderCount: 25, pickPackTotal: 2.5, additionalTotal: 1, packageTotal: 0.99,
  shippingTotal: 20.83, customsDutiesTotal: 99, storageTotal: 0, adjustmentTotal: 0,
  returnTotal: 0, returnPostageTotal: 0, returnProcessingTotal: 0,
  replacePostageTotal: 0, replacePickPackTotal: 0, grandTotal: 124.32 };
const cells = (html: string) => [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(match => match[1]!.trim());
let rowsChecked = 0;
for (const shape of fixture.shapes) {
  const rows = shape.rows.map((source: Record<string, unknown>) => {
    const safe = toCanonicalBillingEventRow({ ...source, providerAccountId: 'internal', labelCost: 999 });
    assert.ok(safe, shape.name);
    const row = toPortalDetailRow(safe);
    assert.equal(row.qty, source.displayQty, 'Qty must carry canonical item quantity, never the fee-line quantity');
    assert.equal(row.customsDutiesTotal, source.customsDutiesTotal);
    assert.equal(row.hasCustomsDutiesLine, source.hasCustomsDutiesLine);
    assert.equal(row.rowTotal, source.grandTotal, 'never add duties again to PrepShip grandTotal');
    assert.equal('providerAccountId' in row, false);
    assert.equal('labelCost' in row, false);
    rowsChecked++;
    return row;
  });
  if (expected.has(shape.name)) {
    assert.deepEqual([rows[0].customsDutiesTotal, rows[0].hasCustomsDutiesLine, rows[0].rowTotal], expected.get(shape.name));
  }
  if (shape.name.startsWith('quantity-')) {
    assert.equal(shape.rows[0].qty, '1.00', 'the regression must retain the misleading raw fee-line quantity');
    assert.equal(rows[0].qty, shape.name === 'quantity-three-items' ? '3' : '4');
  }
  const html = renderPortalInvoiceHtml({ clientName: 'Fixture', dateFrom: '2026-10-01', dateTo: '2026-10-15',
    details: rows, invoiceTotals: { ...totals, qty: 1 } });
  const headers = [...html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(match => match[1]);
  const dutiesIndex = headers.indexOf('Customs/Duties');
  assert.equal(dutiesIndex, headers.indexOf('Shipping') + 1);
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)![1]!;
  const bodyRows = [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)];
  rows.forEach((row: any, index: number) => {
    const rendered = cells(bodyRows[index]![1]!);
    assert.equal(rendered.length, headers.length);
    assert.equal(rendered[headers.indexOf('Qty')], String(row.qty), 'print uses the same canonical quantity as the grid');
    assert.equal(rendered[dutiesIndex], row.hasCustomsDutiesLine ? `$${row.customsDutiesTotal.toFixed(2)}` : '&mdash;');
    assert.equal(rendered.at(-1), `$${row.rowTotal.toFixed(2)}`);
  });
  const footer = cells(html.match(/<tfoot>([\s\S]*?)<\/tfoot>/)![1]!);
  assert.equal(footer[dutiesIndex - 4], '$99.00', 'full-period duty total comes from upstream, not visible rows');
  assert.equal(footer.at(-1), '$124.32');
}
assert.equal(rowsChecked, 9);
const source = fixture.shapes[0].rows[0];
for (const over of [
  { customsDutiesTotal: '3.49' }, { customsDutiesTotal: NaN }, { customsDutiesTotal: Infinity },
  { customsDutiesTotal: null }, { customsDutiesTotal: undefined },
  { hasCustomsDutiesLine: 'true' }, { hasCustomsDutiesLine: null }, { hasCustomsDutiesLine: undefined },
]) assert.equal(toCanonicalBillingEventRow({ ...source, ...over }), null, JSON.stringify(over));
const legacy = { ...source };
delete legacy.customsDutiesTotal; delete legacy.hasCustomsDutiesLine;
const legacyRow = toCanonicalBillingEventRow(legacy)!;
assert.ok(legacyRow);
assert.equal(legacyRow.customsDutiesTotal, null, 'old producer never invents a zero');
assert.equal(legacyRow.hasCustomsDutiesLine, null);
assert.equal(parseCanonicalBillingTotals({ grandTotal: 12 })?.customsDutiesTotal, null);
assert.deepEqual(parseCanonicalBillingTotals(totals), totals);
for (const value of ['3.49', '', NaN, Infinity, true]) {
  assert.equal(parseCanonicalBillingTotals({ ...totals, customsDutiesTotal: value }), null);
}
assert.equal(INVOICE_SORT_FIELDS.customsDuties, 'customsDutiesTotal');
assert.equal(INVOICE_SORT_FIELDS.qty, 'displayQty');
const quantityRows = ['3.5', '3.05', '12', '4'].map((displayQty, i) => toCanonicalBillingEventRow({ ...source,
  canonicalEventId: String(i).repeat(32), qty: '1.00', displayQty })!);
assert.deepEqual(orderCanonicalEvents(quantityRows, 'displayQty', 'asc').map(row => row.displayQty), ['3.05', '3.5', '4', '12']);
assert.deepEqual(orderCanonicalEvents(quantityRows, 'displayQty', 'desc').map(row => row.displayQty), ['12', '4', '3.5', '3.05']);
const sortRows = [3.49, 0, 12.99].map((amount, i) => toCanonicalBillingEventRow({ ...source,
  canonicalEventId: String(i).repeat(32), customsDutiesTotal: amount })!);
assert.deepEqual(orderCanonicalEvents(sortRows, 'customsDutiesTotal', 'asc').map(row => row.customsDutiesTotal), [0, 3.49, 12.99]);

const originalFetch = globalThis.fetch;
try {
  let malformed = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture');
    assert.equal(url.searchParams.get('dateFrom'), '2026-10-01');
    assert.equal(url.searchParams.get('dateTo'), '2026-10-15');
    if (url.pathname.endsWith('/invoice-totals')) {
      assert.equal(url.searchParams.get('clientIds'), '7');
      return Response.json({ data: [{ clientId: 7, totals }] });
    }
    assert.equal(url.searchParams.get('sortBy'), 'customsDutiesTotal');
    assert.equal(url.searchParams.get('clientId'), '7');
    return Response.json({ data: [{ ...source, ...(malformed ? { hasCustomsDutiesLine: null } : {}) }],
      totals, pagination: { page: 2, pageSize: 1, total: 25, totalPages: 25 } });
  };
  const query = { clientId: 7, dateFrom: '2026-10-01', dateTo: '2026-10-15', page: 2, pageSize: 1, sortBy: 'customsDutiesTotal', sortDir: 'asc' };
  const page = await fetchCanonicalBillingDetails('Bearer fixture', query);
  assert.ok(page.ok);
  assert.equal(page.rows[0]?.customsDutiesTotal, 3.49);
  assert.deepEqual(page.totals, totals);
  assert.equal(page.pagination?.total, 25);
  const summary = await fetchCanonicalInvoiceTotals('Bearer fixture', { clientIds: [7], dateFrom: query.dateFrom, dateTo: query.dateTo });
  assert.ok(summary.ok);
  assert.deepEqual(summary.byClient.get(7), totals);
  malformed = true;
  const badPage = await fetchCanonicalBillingDetails('Bearer fixture', query);
  assert.equal(badPage.ok, false, 'malformed duty contract rejects the whole page');
} finally { globalThis.fetch = originalFetch; }
console.log(`PASS Customs/Duties: ${rowsChecked} producer rows, print alignment, exact totals, presence, sorting, scope forwarding and malformed-response rejection.`);
