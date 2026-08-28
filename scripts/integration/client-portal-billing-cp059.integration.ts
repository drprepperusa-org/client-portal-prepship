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
import { Hono } from 'hono';
import { setupTestEnv } from './guard';

setupTestEnv();
process.env.PREPSHIP_API_URL ??= 'http://canonical.test';

const { db, sql: pgClient } = await import('../../src/db/client');
const invoicesApp = (await import('../../src/routes/client-portal/invoices')).default;
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
  // Parent orders first: order_items.orderId is NOT NULL with an FK to orders.id. Read from
  // src/db/schema/order-items.ts and orders.ts rather than inferred — three CI runs were spent
  // discovering this schema one constraint at a time (missing order_status, then the unique
  // (orderId, lineIndex), then this FK), which is what guessing a schema costs.
  //
  // orders needs only id and orderNumber; every other column defaults.
  await db.execute(rawSql`delete from order_items where order_id in (9001, 9002)`);
  await db.execute(rawSql`delete from orders where id in (9001, 9002)`);
  await db.execute(rawSql`
    insert into orders (id, order_number) values
      (9001, '9001'),
      (9002, '9002')
  `);
  await db.execute(rawSql`
    insert into order_items (order_id, line_index, sku, name, order_status) values
      (9001, 0, 'SKU-A', 'Widget A', 'shipped'),
      (9001, 1, 'SKU-B', 'Widget B', 'shipped')
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

  // --- 7. ROUTE-LEVEL PROOF ----------------------------------------------------------------
  // Sections 1-6 call the read model directly, which leaves the HTTP layer unproven. Bearer
  // forwarding, scope denial and what actually reaches the wire are all decided in the handler
  // above the boundary — and a boundary that is correct in isolation can still be bypassed by
  // the route that calls it. These checks drive the real Hono app through app.request().
  await db.execute(rawSql`delete from clients where id = 7907`);
  await db.execute(rawSql`insert into clients (id, name) values (7907, 'CP059 Route Client')`);

  const upstream = { calls: 0, url: '', authorization: null as string | null };
  const stubCapturing = (payload: unknown, status = 200) => {
    upstream.calls = 0;
    upstream.url = '';
    upstream.authorization = null;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      upstream.calls += 1;
      upstream.url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
      upstream.authorization = new Headers(init?.headers ?? {}).get('authorization');
      return new Response(JSON.stringify(payload), {
        status, headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
  };

  const mount = (vars: Record<string, unknown>) => {
    const harness = new Hono();
    harness.use('*', async (c, next) => {
      for (const [key, value] of Object.entries(vars)) c.set(key as never, value as never);
      await next();
    });
    harness.route('/', invoicesApp);
    return harness;
  };
  const RANGE = 'dateFrom=2026-08-01&dateTo=2026-09-01';
  const financials = {
    userId: 'cp059-route', email: 'route@cp059.test', role: 'client',
    permissions: ['financials:read'], clientIds: [7907], storeIds: [],
  };
  const BEARER = 'Bearer cp059-caller-token';

  // 7a. The caller bearer is forwarded verbatim, and nothing internal reaches the wire.
  stubCapturing({ data: [canonical({
    selectedRate: 9.99, bestRate: 8.88, labelCost: 4.44, carrierCode: 'usps',
    providerAccountId: 'acct_live_123', markupPct: 0.35, customerEmail: 'pii@example.com',
  })] });
  const forwarded = await mount(financials).request(
    `/invoice-details?clientId=7907&${RANGE}`, { headers: { authorization: BEARER } },
  );
  if (forwarded.status !== 200) throw new Error(`expected 200, got ${forwarded.status}`);
  if (upstream.authorization !== BEARER) {
    throw new Error(`the caller bearer must be forwarded verbatim, got ${upstream.authorization}`);
  }
  const forwardedBody = await forwarded.text();
  for (const leak of ['selectedRate', 'bestRate', 'labelCost', 'carrierCode',
    'providerAccountId', 'markupPct', 'acct_live_123', 'pii@example.com']) {
    if (forwardedBody.includes(leak)) throw new Error(`${leak} reached the wire`);
  }
  ok('the route forwards the caller bearer verbatim and ships no internal rate/cost/provider/PII field');

  // 7b. No bearer, no upstream call. The portal must not substitute an identity of its own.
  stubCapturing({ data: [canonical()] });
  const noBearer = await mount(financials).request(`/invoice-details?clientId=7907&${RANGE}`);
  if (noBearer.status !== 401) throw new Error(`missing bearer must be 401, got ${noBearer.status}`);
  if (upstream.calls !== 0) throw new Error('an unauthenticated request must never reach upstream');
  ok('a request with no bearer is 401 and never reaches PrepShip');

  // 7c. No scope at all is denied outright, before any billing read.
  stubCapturing({ data: [canonical()] });
  const noScope = await mount({ userId: 'nobody', permissions: [], clientIds: [], storeIds: [] })
    .request(`/invoice-details?clientId=7907&${RANGE}`, { headers: { authorization: BEARER } });
  if (noScope.status !== 403) throw new Error(`an unscoped caller must be 403, got ${noScope.status}`);
  if (upstream.calls !== 0) throw new Error('an unscoped request must never reach upstream');
  ok('a caller with no client/store scope is 403 and never reaches PrepShip');

  // 7d. Scoped, but without financials:read. Billing is invisible, not merely unrendered.
  stubCapturing({ data: [canonical()] });
  const noFinancials = await mount({ ...financials, permissions: [] })
    .request(`/invoice-details?clientId=7907&${RANGE}`, { headers: { authorization: BEARER } });
  const noFinancialsBody = await noFinancials.json() as { billingVisible?: boolean; data?: unknown[] };
  if (noFinancialsBody.billingVisible !== false) throw new Error('billingVisible must be false');
  if ((noFinancialsBody.data ?? []).length !== 0) throw new Error('no rows without financials:read');
  if (upstream.calls !== 0) throw new Error('a caller without financials:read must never reach upstream');
  ok('a scoped caller without financials:read gets billingVisible=false and no upstream call');

  // 7e. A malformed row inside a 200 envelope fails the ROUTE, not just the boundary helper.
  // This is the counterexample review found: an empty object used to become an all-null row
  // that reached the serializers and printed a fabricated $0.00.
  stubCapturing({ data: [canonical(), {}, canonical({ rowType: 'Return', returnId: 501 })] });
  const malformed = await mount(financials).request(
    `/invoice-details?clientId=7907&${RANGE}`, { headers: { authorization: BEARER } },
  );
  if (malformed.status !== 502) throw new Error(`a malformed row must fail the route, got ${malformed.status}`);
  const malformedBody = await malformed.json() as { code?: string; data?: unknown[] };
  if (!String(malformedBody.code).includes('contract_mismatch')) {
    throw new Error(`expected a contract mismatch code, got ${malformedBody.code}`);
  }
  if (malformedBody.data !== undefined) throw new Error('an error response must carry no rows');
  ok('a malformed upstream row fails /invoice-details with contract_mismatch and zero rows');

  // 7f. The printable invoice is the SECOND serializer. An absent return line must render
  // blank there too — the grid showing a dash while the printed invoice shows $0.00 for the
  // same row is the parity failure this card exists to remove.
  stubCapturing({ data: [
    canonical({ rowType: 'Return', returnId: 700, displayReference: '9001-RETURN',
      hasReturnPostageLine: false, returnPostageTotal: null,
      hasReturnProcessingLine: true, returnProcessingTotal: 3.5,
      returnTotal: 3.5, grandTotal: 3.5 }),
  ] });
  const printed = await mount(financials).request(
    `/invoice?clientId=7907&${RANGE}`, { headers: { authorization: BEARER } },
  );
  if (printed.status !== 200) throw new Error(`printable invoice expected 200, got ${printed.status}`);
  const html = await printed.text();
  if (!html.includes('9001-RETURN')) throw new Error('the printable invoice must render the Return row');
  if (!html.includes('$3.50')) throw new Error('a real 3.50 processing fee must print');
  ok('the printable invoice renders the canonical Return row and its real 3.50 processing fee');

  // The absent postage cell must not have become money. Scope the search to the itemized rows
  // rather than the whole document: the totals block legitimately prints $0.00 for categories
  // with no activity, so a document-wide search would fail for the wrong reason and prove
  // nothing about the row itself.
  const itemizedRows = (html.match(/<tbody>[\s\S]*?<\/tbody>/) ?? [''])[0];
  if (itemizedRows === '') throw new Error('could not locate the itemized rows — the check must not pass vacuously');
  if (itemizedRows.includes('$0.00')) {
    throw new Error('an absent return-postage line must not print as $0.00 in the itemized row');
  }
  ok('the absent postage line prints blank in the itemized row, never a fabricated $0.00');

  // 7g. And the printable invoice fails closed on the same malformed row.
  stubCapturing({ data: [canonical(), {}] });
  const printedBad = await mount(financials).request(
    `/invoice?clientId=7907&${RANGE}`, { headers: { authorization: BEARER } },
  );
  if (printedBad.status !== 502) {
    throw new Error(`a malformed row must fail the printable invoice, got ${printedBad.status}`);
  }
  ok('the printable invoice fails closed on a malformed row rather than printing a partial statement');

  await db.execute(rawSql`delete from clients where id = 7907`);

  await db.execute(rawSql`delete from order_items where order_id in (9001, 9002)`);
  await db.execute(rawSql`delete from orders where id in (9001, 9002)`);
  const EXPECTED_CHECKS = 14;
  if (checks !== EXPECTED_CHECKS) {
    throw new Error(`expected ${EXPECTED_CHECKS} checks to run; ${checks} did`);
  }
  console.log(`\nPASS CP-059 canonical billing integration — ${checks}/${EXPECTED_CHECKS} checks`);
}

try {
  await main();
} finally {
  await pgClient.end({ timeout: 5 }).catch(() => {});
}
