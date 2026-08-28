/* CP-059 canonical billing event-row proof, against a throwaway Postgres.
 *
 * The contract guard (scripts/cp-059-canonical-billing-guard.ts) proves the boundary in
 * isolation. This proves the parts that only a real database can: that the presentation-only
 * enrichment join behaves, that an enrichment MISS cannot erase a canonical Return row, and
 * that sort and pagination reorder and slice without regrouping, dropping or duplicating.
 *
 * The upstream is stubbed here too. PrepShip owns row grain, and pointing this at a live
 * instance would make the fixtures non-deterministic while proving nothing extra about the
 * portal. What is real is the Postgres the enrichment query runs against.
 *
 * No production data. No billing regeneration. No network beyond the stub.
 */
import { sql as rawSql } from 'drizzle-orm';
import { setupTestEnv } from './guard';

setupTestEnv();
process.env.PREPSHIP_API_URL ??= 'http://canonical.test';

const { db, sql: pgClient } = await import('../../src/db/client');
const { portalCanonicalInvoiceEvents } = await import(
  '../../src/lib/client-portal/read-models/canonical-invoice-events'
);

let checks = 0;
const ok = (label: string) => { checks += 1; console.log(`ok   ${label}`); };

const scope = {
  userId: 'cp059-test',
  permissions: [],
  canViewFinancials: true,
  canViewCredentials: false,
  clientIds: null,
  storeIds: null,
  isRestricted: false,
} as unknown as Parameters<typeof portalCanonicalInvoiceEvents>[0];

const canonical = (over: Record<string, unknown> = {}) => ({
  clientId: 7, clientName: 'Acme', orderId: 9001, orderNumber: '9001',
  returnId: null, rowType: 'Outbound', displayReference: '9001',
  destination: 'Domestic', hasReturnPostageLine: false, hasReturnProcessingLine: false,
  pickpackTotal: 2.5, additionalTotal: 0, packageTotal: 0, shippingTotal: 6.1,
  storageTotal: 0, adjustmentTotal: 0,
  returnPostageTotal: null, returnProcessingTotal: null, returnTotal: null,
  grandTotal: 8.6, shipDate: '2026-08-01', actualActivityDate: '2026-08-01',
  billingEffectiveDate: '2026-08-01', billingPolicyVersion: 'ps-437-v1',
  rolledFromWeekend: false, recipientName: 'A Customer', boxSize: 'Small',
  displayQty: '1', qty: 1, ...over,
});

const stub = (rows: unknown[]) => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: rows }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })) as typeof fetch;
};

async function main(): Promise<void> {
  // Seed enrichment for 9001 ONLY. 9002 is deliberately left without item rows so the
  // enrichment-miss case is exercised against a real join rather than a mocked one.
  //
  // No `create table if not exists` here. The migrated table already exists in this harness,
  // so that statement was a silent no-op that made the insert LOOK schema-complete while the
  // real table's NOT NULL columns went unsupplied — the run failed on `order_status`. Seeding
  // against the real schema is the point of an integration test; a hand-rolled table would
  // have proved the join against a shape production does not have.
  await db.execute(rawSql`delete from order_items where order_id in (9001, 9002)`);
  await db.execute(rawSql`
    insert into order_items (order_id, sku, name, order_status) values
      (9001, 'SKU-A', 'Widget A', 'shipped'),
      (9001, 'SKU-B', 'Widget B', 'shipped')
  `);

  const range = { dateFrom: '2026-08-01', dateTo: '2026-09-01' };

  // --- 1. grain survives the read model, and enrichment attaches by orderId ----------------
  stub([
    canonical({ rowType: 'Outbound', returnId: null, displayReference: '9001' }),
    canonical({ rowType: 'Return', returnId: 501, displayReference: '9001-RETURN',
      hasReturnPostageLine: true, returnPostageTotal: 7.73,
      hasReturnProcessingLine: true, returnProcessingTotal: 3.0,
      returnTotal: 10.73, grandTotal: 10.73 }),
    canonical({ rowType: 'Return', returnId: 502, displayReference: '9001-RETURN-2' }),
  ]);
  const first = await portalCanonicalInvoiceEvents(scope, 'Bearer t', range);
  if (!first.ok) throw new Error(`expected ok, got ${first.code}`);
  if (first.rows.length !== 3) throw new Error(`expected 3 event rows, got ${first.rows.length}`);
  if (first.total !== 3) throw new Error(`total must count EVENT rows, got ${first.total}`);
  for (const row of first.rows) {
    if (row.skus !== 'SKU-A, SKU-B') throw new Error(`enrichment must attach by orderId, got ${row.skus}`);
  }
  ok('outbound + RETURN + RETURN-2 stay three rows; total counts events; enrichment joins by orderId');

  // --- 2. the 10.73 return, carried not computed -------------------------------------------
  const returnRow = first.rows.find((r) => r.displayReference === '9001-RETURN')!;
  if (Number(returnRow.returnPostageTotal) !== 7.73) throw new Error('postage must survive verbatim');
  if (Number(returnRow.returnProcessingTotal) !== 3.0) throw new Error('processing must survive verbatim');
  if (Number(returnRow.returnTotal) !== 10.73) throw new Error('the backend-issued return total must survive');
  const outbound = first.rows.find((r) => r.rowType === 'Outbound')!;
  if (Number(outbound.rowTotal) !== 8.6) throw new Error('the outbound row must be unchanged by the return');
  ok('7.73 + 3.00 -> backend-issued 10.73 on the Return row; the outbound is untouched');

  // --- 3. absent stays absent, through the real read model ---------------------------------
  const secondReturn = first.rows.find((r) => r.displayReference === '9001-RETURN-2')!;
  if (secondReturn.returnPostageTotal !== null) {
    throw new Error(`absent return postage must stay null, got ${secondReturn.returnPostageTotal}`);
  }
  if (secondReturn.hasReturnPostageLine !== false) {
    throw new Error('fee presence must be carried from upstream, not inferred');
  }
  ok('an absent return-postage amount stays null after enrichment, sort and mapping');

  // --- 4. REVERSED INPUT ORDER YIELDS IDENTICAL OUTPUT -------------------------------------
  // The matrix asks for this explicitly: if input order could change the result, the portal
  // would be deciding grouping rather than rendering a decided grain.
  stub([
    canonical({ rowType: 'Return', returnId: 502, displayReference: '9001-RETURN-2' }),
    canonical({ rowType: 'Return', returnId: 501, displayReference: '9001-RETURN' }),
    canonical({ rowType: 'Outbound', returnId: null, displayReference: '9001' }),
  ]);
  const reversed = await portalCanonicalInvoiceEvents(scope, 'Bearer t', range);
  if (!reversed.ok) throw new Error('reversed fixture must succeed');
  const refsOf = (r: { displayReference?: string | null }[]) => r.map((x) => x.displayReference).join('|');
  if (refsOf(reversed.rows) !== refsOf(first.rows)) {
    throw new Error(`reversed input must yield identical output: ${refsOf(reversed.rows)} vs ${refsOf(first.rows)}`);
  }
  ok('reversed input order yields byte-identical row order — grain and ordering are deterministic');

  // --- 5. an enrichment MISS cannot erase a canonical row ----------------------------------
  stub([
    canonical({ orderId: 9002, orderNumber: '9002', rowType: 'Outbound', displayReference: '9002' }),
    canonical({ orderId: 9002, orderNumber: '9002', rowType: 'Return', returnId: 601,
      displayReference: '9002-RETURN', hasReturnPostageLine: true,
      returnPostageTotal: 4.25, returnTotal: 4.25, grandTotal: 4.25 }),
  ]);
  const noItems = await portalCanonicalInvoiceEvents(scope, 'Bearer t', range);
  if (!noItems.ok) throw new Error('missing item data must not fail the read');
  if (noItems.rows.length !== 2) throw new Error(`an enrichment miss must not drop rows, got ${noItems.rows.length}`);
  const orphanReturn = noItems.rows.find((r) => r.rowType === 'Return')!;
  if (orphanReturn.skus !== null) throw new Error('a missing item join leaves skus null');
  if (Number(orphanReturn.returnPostageTotal) !== 4.25) {
    throw new Error('a missing item join must not touch canonical money');
  }
  ok('an order with no item rows keeps both canonical rows and all canonical money');

  // --- 6. pagination slices without dropping or duplicating --------------------------------
  stub([
    canonical({ rowType: 'Outbound', returnId: null, displayReference: '9001' }),
    canonical({ rowType: 'Return', returnId: 501, displayReference: '9001-RETURN' }),
    canonical({ rowType: 'Return', returnId: 502, displayReference: '9001-RETURN-2' }),
  ]);
  const p1 = await portalCanonicalInvoiceEvents(scope, 'Bearer t', { ...range, page: 1, pageSize: 2 });
  const p2 = await portalCanonicalInvoiceEvents(scope, 'Bearer t', { ...range, page: 2, pageSize: 2 });
  if (!p1.ok || !p2.ok) throw new Error('paged reads must succeed');
  if (p1.rows.length !== 2 || p2.rows.length !== 1) {
    throw new Error(`expected 2 then 1, got ${p1.rows.length} then ${p2.rows.length}`);
  }
  if (p1.total !== 3 || p2.total !== 3) throw new Error('total must be the full event count on every page');
  const seen = [...p1.rows, ...p2.rows].map((r) => r.displayReference);
  if (new Set(seen).size !== 3) throw new Error(`pages must not duplicate or drop rows: ${seen.join('|')}`);
  ok('pagination yields 2 + 1 across 3 events, no duplicates, total stays the event count');

  await db.execute(rawSql`delete from order_items where order_id in (9001, 9002)`);
  console.log(`\nPASS CP-059 canonical billing integration — ${checks}/${checks} checks`);
}

try {
  await main();
} finally {
  await pgClient.end({ timeout: 5 }).catch(() => {});
}
