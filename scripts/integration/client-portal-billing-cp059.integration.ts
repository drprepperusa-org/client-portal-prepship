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
import { readFileSync } from 'node:fs';
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
const { billingSummary } = await import('../../src/services/billing-summaries');
const { refreshBillingSummaryMetrics } = await import('../../src/services/reporting-metrics');
const {
  portalInvoiceSummary,
  portalInvoicePeriodSummary,
  portalInvoiceDetails,
} = await import('../../src/lib/client-portal/read-models/invoice-details');

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

/** A deterministic 32-hex identity, shaped exactly like the one the producer publishes. */
const hex32 = (seed: string) => seed
  .split('')
  .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
  .join('')
  .padEnd(32, '0')
  .slice(0, 32);

let fixtureSeq = 0;
const canonical = (over: Record<string, unknown> = {}) => ({
  // Producer-issued identity, DERIVED FROM THE EVENT — not from a call counter.
  //
  // This first used a sequence number, which made identity depend on the order the fixture
  // happened to build its rows. The reversed-input test then compared two runs whose rows had
  // different identities and failed for a reason that had nothing to do with the code under
  // test. Real producer identity is content-derived and stable: the same event yields the same
  // id however it arrives. The fixture has to behave the same way or it is not modelling the
  // producer, it is modelling itself.
  canonicalEventId: hex32(String(over.displayReference ?? over.orderId ?? (fixtureSeq += 1))),
  clientId: 7, clientName: 'Acme', orderId: 9001, orderNumber: '9001',
  returnId: null, rowType: 'Outbound', displayReference: '9001',
  destination: 'Domestic', hasReturnPostageLine: false, hasReturnProcessingLine: false,
  pickpackTotal: 2.5, additionalTotal: 0, packageTotal: 0, shippingTotal: 6.1,
  storageTotal: 0, adjustmentTotal: 0,
  // PrepShip emits numbers, never null: an absent fee is `false + 0`. See
  // billing-detail-row-sot.ts:281. Fixtures used to say null, which hid a validator that
  // rejected the producer's real output.
  returnPostageTotal: 0, returnProcessingTotal: 0, returnTotal: 0,
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
  // The producer's absent shape survives the whole read model. The AMOUNT is 0 and carries no
  // meaning; PRESENCE is what says the fee does not exist.
  if (Number(secondReturn.returnPostageTotal) !== 0) {
    throw new Error(`the absent-fee amount is carried verbatim, got ${secondReturn.returnPostageTotal}`);
  }
  if (secondReturn.hasReturnPostageLine !== false) {
    throw new Error('fee presence must be carried from upstream, not inferred');
  }
  ok('the producer absent shape (false + 0) survives enrichment, sort and mapping intact');

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

  // CP-066: the printable /invoice takes its MONEY from the totals block PrepShip returns with
  // the rows, and fails closed (502) without it. Every /invoice stub below must carry one, or
  // the case 502s for a reason unrelated to what it is testing — which is exactly how this
  // suite went red at the SHA that introduced the requirement. Hoisted here so sections 7 and
  // 8 share it.
  const CANONICAL_TOTALS_STUB = {
    orderCount: 1, pickPackTotal: 0, additionalTotal: 0, packageTotal: 0, shippingTotal: 0,
    storageTotal: 0, adjustmentTotal: 0, replacePostageTotal: 0, replacePickPackTotal: 0,
    returnTotal: 3.5, returnPostageTotal: 0, returnProcessingTotal: 3.5, grandTotal: 3.5,
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
  ], totals: CANONICAL_TOTALS_STUB });
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
  // Totals present and valid, so the 502 below can only come from the malformed ROW.
  stubCapturing({ data: [canonical(), {}], totals: CANONICAL_TOTALS_STUB });
  const printedBad = await mount(financials).request(
    `/invoice?clientId=7907&${RANGE}`, { headers: { authorization: BEARER } },
  );
  if (printedBad.status !== 502) {
    throw new Error(`a malformed row must fail the printable invoice, got ${printedBad.status}`);
  }
  ok('the printable invoice fails closed on a malformed row rather than printing a partial statement');

  // --- 8. PRODUCER SHAPES AT THE ROUTE ------------------------------------------------------
  // Sections 1-7 use hand-written rows. These use the rows PrepShip actually generates, read
  // from the committed producer fixture, driven through the real HTTP handler. Two outages came
  // from shapes this repository had never seen; this is where they would now surface.
  const producerFixture = JSON.parse(
    readFileSync('fixtures/cp-059-producer-billing-rows.json', 'utf8'),
  ) as { producerSha: string; shapes: Array<{ name: string; rows: Array<Record<string, unknown>> }> };
  const producerRows = producerFixture.shapes.flatMap((s) => s.rows);
  const shapeRows = (prefix: string) => {
    const shape = producerFixture.shapes.find((s) => s.name.startsWith(prefix));
    if (!shape) throw new Error(`producer fixture is missing the shape: ${prefix}`);
    return shape.rows;
  };

  // 8a. ORDERLESS STORAGE SURVIVES THE ROUTE. Requiring orderId 502'd any period with storage.
  stubCapturing({ data: shapeRows('ORDERLESS storage line') });
  const storageResponse = await mount(financials).request(
    `/invoice-details?clientId=7907&${RANGE}`, { headers: { authorization: BEARER } },
  );
  if (storageResponse.status !== 200) {
    throw new Error(`an orderless storage row must not fail the route, got ${storageResponse.status}`);
  }
  const storageBody = await storageResponse.json() as { data?: Array<Record<string, unknown>> };
  if ((storageBody.data ?? []).length !== 1) {
    throw new Error(`the storage row must render, got ${(storageBody.data ?? []).length} rows`);
  }
  const storageRow = (storageBody.data ?? [])[0] ?? {};
  if (storageRow.orderId !== null) throw new Error('the storage row keeps its null orderId');
  ok('an ORDERLESS storage row survives /invoice-details instead of 502ing the period');

  // 8b. TWO storage rows stay distinct, and stay distinct under REVERSED input. Under the old
  // key both were '||Outbound' and their order fell to however the input happened to arrive.
  const twoStorage = shapeRows('TWO orderless storage');
  stubCapturing({ data: twoStorage });
  const forward = await mount(financials).request(
    `/invoice-details?clientId=7907&${RANGE}`, { headers: { authorization: BEARER } },
  );
  stubCapturing({ data: [...twoStorage].reverse() });
  const reverse = await mount(financials).request(
    `/invoice-details?clientId=7907&${RANGE}`, { headers: { authorization: BEARER } },
  );
  const idsOf = async (res: Response) => {
    const body = await res.json() as { data?: Array<Record<string, unknown>> };
    return (body.data ?? []).map((r) => String(r.canonicalEventId));
  };
  const forwardIds = await idsOf(forward);
  const reverseIds = await idsOf(reverse);
  if (forwardIds.length !== 2) throw new Error(`expected 2 storage rows, got ${forwardIds.length}`);
  if (new Set(forwardIds).size !== 2) {
    throw new Error(`two storage rows collapsed to one identity: ${forwardIds.join(' ')}`);
  }
  if (forwardIds.join('|') !== reverseIds.join('|')) {
    throw new Error(`reversed input changed the order: ${forwardIds.join('|')} vs ${reverseIds.join('|')}`);
  }
  ok('two orderless storage rows stay distinct and keep their order under reversed input');

  // 8c. A row missing producer-guaranteed money fails the ROUTE. Accepting one printed a
  // plausible $0.00 invoice line for an amount nobody had computed.
  const noMoney = { ...producerRows[0] };
  delete noMoney.grandTotal;
  stubCapturing({ data: [producerRows[0], noMoney] });
  const missingMoney = await mount(financials).request(
    `/invoice-details?clientId=7907&${RANGE}`, { headers: { authorization: BEARER } },
  );
  if (missingMoney.status !== 502) {
    throw new Error(`a row missing grandTotal must fail the route, got ${missingMoney.status}`);
  }
  const missingBody = await missingMoney.json() as { code?: string; data?: unknown };
  if (!String(missingBody.code).includes('contract_mismatch')) {
    throw new Error(`expected a contract mismatch, got ${missingBody.code}`);
  }
  if (missingBody.data !== undefined) throw new Error('a failed response carries no rows');
  ok('a row missing producer-guaranteed money fails the route rather than printing $0.00');

  // 8d. NO PARTIAL OUTPUT anywhere. The printable invoice must fail too, not print the good row.
  stubCapturing({ data: [producerRows[0], noMoney] });
  const partialPrint = await mount(financials).request(
    `/invoice?clientId=7907&${RANGE}`, { headers: { authorization: BEARER } },
  );
  if (partialPrint.status !== 502) {
    throw new Error(`the printable invoice must fail closed too, got ${partialPrint.status}`);
  }
  ok('the printable invoice fails closed on the same row — no partial statement');

  // 8e. THE WHOLE producer fixture renders through the route, and nothing internal leaks.
  stubCapturing({ data: producerRows });
  const wholeFixture = await mount(financials).request(
    `/invoice-details?clientId=7907&${RANGE}`, { headers: { authorization: BEARER } },
  );
  if (wholeFixture.status !== 200) {
    throw new Error(`the full producer payload must render, got ${wholeFixture.status}`);
  }
  const wholeText = await wholeFixture.text();
  const whole = JSON.parse(wholeText) as { data?: Array<Record<string, unknown>> };
  if ((whole.data ?? []).length !== producerRows.length) {
    throw new Error(`expected ${producerRows.length} rows, got ${(whole.data ?? []).length}`);
  }
  for (const leak of ['selectedRate', 'bestRate', 'labelCost', 'carrierCode', 'providerAccountId',
    'markupPct', 'totalCost', 'lineTypes', 'margin']) {
    if (wholeText.includes(`"${leak}"`)) throw new Error(`${leak} reached the wire`);
  }
  const wholeIds = (whole.data ?? []).map((r) => String(r.canonicalEventId));
  if (new Set(wholeIds).size !== wholeIds.length) {
    throw new Error('the route returned duplicate event identities — React keys would collide');
  }
  ok(`all ${producerRows.length} producer rows render with distinct identities and no internal field on the wire`);

  // 8f. The printable invoice renders the whole producer fixture without fabricating money.
  stubCapturing({ data: producerRows, totals: CANONICAL_TOTALS_STUB });
  const printedAll = await mount(financials).request(
    `/invoice?clientId=7907&${RANGE}`, { headers: { authorization: BEARER } },
  );
  if (printedAll.status !== 200) {
    throw new Error(`the printable invoice must render the producer fixture, got ${printedAll.status}`);
  }
  const printedHtml = await printedAll.text();
  const printedBody = (printedHtml.match(/<tbody>[\s\S]*?<\/tbody>/) ?? [''])[0];
  const printedRows = printedBody.split('</tr>').filter((c) => c.includes('<td'));
  if (printedRows.length !== producerRows.length) {
    throw new Error(`expected ${producerRows.length} printed rows, got ${printedRows.length}`);
  }
  // COUNTED, not zipped by index. The read model orders rows by canonical identity, so the
  // rendered order is not the fixture order — comparing producerRows[i] against printedRows[i]
  // would be checking unrelated rows against each other and could pass or fail for reasons that
  // have nothing to do with the code under test. Several producer rows also share a null
  // displayReference, so the rendered rows cannot be matched back by label either.
  //
  // What IS order-independent: how many rows have an absent fee, and how many blank cells the
  // document contains. If any absent line printed money, the blank count drops below the
  // expected one.
  //
  // Column 13 is Return Postage and 12 is Return Processing (invoice-html.ts row template).
  const cellsOfPrintedRow = (chunk: string) =>
    [...chunk.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => (m[1] ?? '').trim());
  const expectedBlankPostage = producerRows.filter((r) => r.hasReturnPostageLine === false).length;
  const expectedBlankProcessing = producerRows.filter((r) => r.hasReturnProcessingLine === false).length;
  const printedCells = printedRows.map(cellsOfPrintedRow);
  // Column layout after PS-512 made replacement and adjustment visible (19 columns):
  //   11 Storage · 12 Adjustment · 13 Return Processing · 14 Return Postage · 15 Return Total
  //   16 Replacement Postage · 17 Replacement Pick&Pack · 18 Fulfillment Fee
  // These were 12/13 when the table had 15 columns; the counts silently shifted by one, which
  // is why an index-based assertion needs the layout written down beside it.
  const HTML_RETURN_PROCESSING = 13;
  const HTML_RETURN_POSTAGE = 14;
  const blankPostage = printedCells.filter((cells) => cells[HTML_RETURN_POSTAGE] === '&mdash;').length;
  const blankProcessing = printedCells.filter((cells) => cells[HTML_RETURN_PROCESSING] === '&mdash;').length;

  // Setup check: the fixture must actually contain absent fees, or the counts below are trivially
  // satisfied and prove nothing.
  if (expectedBlankPostage === 0 || expectedBlankProcessing === 0) {
    throw new Error('the producer fixture no longer contains absent return fees — this check is vacuous');
  }
  if (blankPostage !== expectedBlankPostage) {
    throw new Error(
      `expected ${expectedBlankPostage} blank postage cells, found ${blankPostage} — `
      + 'an absent return line printed money',
    );
  }
  if (blankProcessing !== expectedBlankProcessing) {
    throw new Error(
      `expected ${expectedBlankProcessing} blank processing cells, found ${blankProcessing} — `
      + 'an absent return line printed money',
    );
  }
  // And the real amounts still print: the both-fees return carries 7.73 / 3.00.
  if (!printedHtml.includes('$7.73') || !printedHtml.includes('$3.00')) {
    throw new Error('the real return amounts must still print — this must not pass by blanking everything');
  }
  ok(`the printable invoice blanks all ${expectedBlankPostage} absent postage lines while real amounts still print`);

  await db.execute(rawSql`delete from clients where id = 7907`);

  await db.execute(rawSql`delete from order_items where order_id in (9001, 9002)`);
  await db.execute(rawSql`delete from orders where id in (9001, 9002)`);
  // -------------------------------------------------------------------------------------
  // CP-059 AC-6 — the canonical return total against a REAL database.
  //
  // Review found RETURN_LINE_TYPES covering only 'return_postage' and 'return_processing_fee',
  // so the summary computed return_total = $0.00 for the producer's legacy bare-return shape
  // while grand_total carried the money. The browser proof could not catch this: it stubs a
  // detail DTO that already contains returnTotal, so it proves the GRID renders a correct
  // upstream value, not that either SQL authority produces one.
  //
  // This inserts the exact counterexample and reads it back through the real query.
  console.log('\nScenario: a bare `return` line funds the canonical return total');
  {
    const CLIENT = 7908;
    const FROM = '2026-08-01T00:00:00.000Z';
    const TO = '2026-09-01T00:00:00.000Z';
    await db.execute(rawSql`delete from billing_line_items where client_id = ${CLIENT}`);
    await db.execute(rawSql`delete from clients where id = ${CLIENT}`);
    await db.execute(rawSql`insert into clients (id, name) values (${CLIENT}, 'CP059 Return Vocab')`);
    await db.execute(rawSql`
      insert into billing_line_items
        (client_id, line_type, description, qty, unit_cost, total_cost, ship_date, billing_effective_date)
      values
        (${CLIENT}, 'return', 'Legacy bare return line', 1, 5.50, 5.50, ${FROM}::timestamptz, ${FROM}::timestamptz)
    `);

    const summaryInput = {
      clientId: CLIENT, dateFrom: FROM, dateTo: TO,
      scopeClientIds: null, scopeStoreIds: null, scopeRestricted: false,
    };
    const summary = await billingSummary(summaryInput as never);
    const row = summary.clients.find((c) => c.clientId === CLIENT);
    if (!row) throw new Error('the seeded client must appear in the billing summary');
    if (Number(row.returnTotal) !== 5.5) {
      throw new Error(
        `a bare 'return' line must fund returnTotal: expected 5.50, got ${row.returnTotal}. `
        + 'This is the exact defect review found — the line type was missing from RETURN_LINE_TYPES.',
      );
    }
    if (Number(row.grandTotal) !== 5.5) {
      throw new Error(`grandTotal must still be 5.50, got ${row.grandTotal}`);
    }
    // Both NAMED parts stay zero. That is the point: returnTotal cannot be derived from them,
    // because this row funds the total while leaving both at 0.00.
    if (Number(row.returnPostageTotal) !== 0 || Number(row.returnProcessingTotal) !== 0) {
      throw new Error(
        `a bare return line must leave both named parts at 0.00, got postage ${row.returnPostageTotal} `
        + `/ processing ${row.returnProcessingTotal}`,
      );
    }
    ok('a bare `return` line produces returnTotal 5.50 with both named parts at 0.00');

    // Item 4: the materialized metrics path must agree with the query above. Both read the same
    // registry; if they ever disagree, a customer's return money changes depending on whether
    // the summary happened to answer from cache.
    // The reporting tables come from a raw SQL migration, not a drizzle schema file, so
    // drizzle-kit push does not create them and the throwaway database has neither them nor
    // CP-059's return_total column. Apply both here. Every statement in these files is
    // CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, so this is safe to re-run.
    // The reporting tables come from raw SQL migrations rather than drizzle schema files, so
    // drizzle-kit push never creates them for a throwaway database.
    //
    // Two things make applying them here fiddly, and both are properties of the real migration
    // history rather than of this test:
    //
    //  - DEPENDENCY order, not numeric order. 0022 ALTERs billing_summary_metrics but is
    //    numbered BEFORE 0029, the file that CREATEs it.
    //  - 0022 also ALTERs billing_config with a plain ADD COLUMN, and those columns already
    //    exist here because drizzle push created them from the schema. Applying that file
    //    whole fails on "column already exists".
    //
    // So: 0029 whole (every statement is CREATE TABLE IF NOT EXISTS, and refresh checks all
    // five tables exist), then only the billing_summary_metrics statements of the rest.
    await db.execute(rawSql.raw(readFileSync('drizzle/0029_reporting_metrics.sql', 'utf8')));
    for (const migration of [
      'drizzle/0022_return_billing_config.sql',                  // + return_postage_total / return_processing_total
      'drizzle/0051_billing_summary_replacement_adjustment.sql', // + adjustment / replacement
      'drizzle/0052_billing_summary_return_total.sql',           // + return_total (CP-059)
    ]) {
      const statements = readFileSync(migration, 'utf8')
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter((statement) => /billing_summary_metrics/i.test(statement));
      if (statements.length === 0) {
        throw new Error(`${migration} contributed no billing_summary_metrics statement`);
      }
      for (const statement of statements) {
        await db.execute(rawSql.raw(statement));
      }
    }
    await refreshBillingSummaryMetrics(new Date(FROM), new Date(TO));
    const materializedRows = await db.execute<{ return_total: string; grand_total: string }>(rawSql`
      select return_total, grand_total
      from billing_summary_metrics
      where client_id = ${CLIENT}
        and period_from = ${FROM}::date
        and period_to = ${TO}::date
    `);
    const materialized = materializedRows[0];
    if (!materialized) throw new Error('the metrics refresh must materialize a row for the seeded client');
    if (Number(materialized.return_total) !== 5.5) {
      throw new Error(
        `the materialized metrics path must agree: expected return_total 5.50, got ${materialized.return_total}`,
      );
    }
    if (Number(materialized.return_total) !== Number(row.returnTotal)) {
      throw new Error(
        `metrics and non-metrics paths disagree: ${materialized.return_total} vs ${row.returnTotal}`,
      );
    }
    ok('the materialized metrics path agrees with the summary query on the same data');

    // The legacy PROCESSING alias is return money and is attributed the way the producer
    // attributes it. The legacy POSTAGE alias (return_label) is deliberately asserted as
    // EXCLUDED: CP-059 extended the customer-safety gate to cover it, so an unvalidated legacy
    // postage line is kept out of customer money exactly as 'return_postage' is. Adding it to
    // the postage aggregate without that gate would have opened a bypass.
    await db.execute(rawSql`
      insert into billing_line_items
        (client_id, line_type, description, qty, unit_cost, total_cost, ship_date, billing_effective_date)
      values
        (${CLIENT}, 'return_processing', 'Legacy processing alias', 1, 2.75, 2.75, ${FROM}::timestamptz, ${FROM}::timestamptz),
        (${CLIENT}, 'return_label', 'Legacy postage alias, no validated tuple', 1, 5.25, 5.25, ${FROM}::timestamptz, ${FROM}::timestamptz)
    `);
    const withAliases = await billingSummary(summaryInput as never);
    const aliasRow = withAliases.clients.find((c) => c.clientId === CLIENT);
    if (!aliasRow) throw new Error('the seeded client must still appear');
    if (Number(aliasRow.returnProcessingTotal) !== 2.75) {
      throw new Error(
        `the legacy 'return_processing' alias must count as return processing: got ${aliasRow.returnProcessingTotal}`,
      );
    }
    if (Number(aliasRow.returnPostageTotal) !== 0) {
      throw new Error(
        `an unvalidated legacy 'return_label' line must be gated out of customer money like `
        + `'return_postage' is: got ${aliasRow.returnPostageTotal}`,
      );
    }
    if (Number(aliasRow.returnTotal) !== 8.25) {
      throw new Error(`returnTotal must be 5.50 + 2.75 = 8.25, got ${aliasRow.returnTotal}`);
    }
    ok('legacy return aliases are counted and gated the way the producer and the safety rule say');

    await db.execute(rawSql`delete from billing_line_items where client_id = ${CLIENT}`);
    await db.execute(rawSql`delete from billing_summary_metrics where client_id = ${CLIENT}`);
    await db.execute(rawSql`delete from clients where id = ${CLIENT}`);
  }

  // -------------------------------------------------------------------------------------
  // CP-059 — CASE VARIANTS cannot classify one way and validate another.
  //
  // Review found the defect this proves against. The aggregates had been written as
  // `lower(b.line_type) in (...)` while the customer-safety gate compared the RAW text against
  // the same lowercase list. `billing_line_items.line_type` is a bare `text not null` with no
  // lowercase constraint, so a row spelled `RETURN_LABEL`:
  //   - was classified as return POSTAGE by the aggregate (lower() matched), and
  //   - slipped past the postage validation (raw text did not match),
  // putting unvalidated postage into customer-visible Return Postage and Return Total through
  // nothing but capitalisation.
  //
  // Both sides now go through isReturnPostageLineTypeSql(), so there is no second list to
  // normalise differently. These two scenarios prove the negative AND the positive: an
  // unvalidated case-variant is excluded everywhere, and a VALID one is still included once —
  // a gate that simply rejected every case variant would pass the first test and be wrong.
  console.log('\nScenario: an UNVALIDATED case-variant return_label is excluded everywhere');
  {
    const CLIENT = 7909;
    const ORDER = 79090;
    const FROM = '2026-08-01T00:00:00.000Z';
    const TO = '2026-09-01T00:00:00.000Z';
    const summaryInput = {
      clientId: CLIENT, dateFrom: FROM, dateTo: TO,
      scopeClientIds: null, scopeStoreIds: null, scopeRestricted: false,
    };
    const caseScope = {
      ...(scope as unknown as Record<string, unknown>),
      clientIds: null, storeIds: null, isRestricted: false,
    } as unknown as Parameters<typeof portalInvoiceSummary>[0];

    await db.execute(rawSql`delete from billing_line_items where client_id = ${CLIENT}`);
    await db.execute(rawSql`delete from billing_summary_metrics where client_id = ${CLIENT}`);
    await db.execute(rawSql`delete from returns where order_id = ${ORDER}`);
    await db.execute(rawSql`delete from orders where id = ${ORDER}`);
    await db.execute(rawSql`delete from clients where id = ${CLIENT}`);
    await db.execute(rawSql`insert into clients (id, name) values (${CLIENT}, 'CP059 Case Variant')`);
    await db.execute(rawSql`insert into orders (id, order_number) values (${ORDER}, '79090')`);

    // Uppercase, and with NO validated shipment/return tuple behind it.
    await db.execute(rawSql`
      insert into billing_line_items
        (client_id, order_id, line_type, description, qty, unit_cost, total_cost, ship_date, billing_effective_date)
      values
        (${CLIENT}, ${ORDER}, 'RETURN_LABEL', 'Uppercase unvalidated postage', 1, 5.25, 5.25, ${FROM}::timestamptz, ${FROM}::timestamptz)
    `);

    const unvalidated = await billingSummary(summaryInput as never);
    const unvalidatedRow = unvalidated.clients.find((c) => c.clientId === CLIENT);
    if (!unvalidatedRow) throw new Error('the seeded client must appear in the summary');
    if (Number(unvalidatedRow.returnPostageTotal) !== 0) {
      throw new Error(
        `an UNVALIDATED 'RETURN_LABEL' must not reach customer Return Postage — got `
        + `${unvalidatedRow.returnPostageTotal}. Classification lowercases; the safety gate must too.`,
      );
    }
    if (Number(unvalidatedRow.returnTotal) !== 0) {
      throw new Error(
        `an UNVALIDATED 'RETURN_LABEL' must not reach the canonical Return Total — got ${unvalidatedRow.returnTotal}`,
      );
    }

    // The materialized path must agree — a bypass that only exists in cache is still a bypass.
    await refreshBillingSummaryMetrics(new Date(FROM), new Date(TO));
    const metricRows = await db.execute<{ return_postage_total: string; return_total: string }>(rawSql`
      select return_postage_total, return_total
      from billing_summary_metrics
      where client_id = ${CLIENT} and period_from = ${FROM}::date and period_to = ${TO}::date
    `);
    const metric = metricRows[0];
    if (metric && (Number(metric.return_postage_total) !== 0 || Number(metric.return_total) !== 0)) {
      throw new Error(
        `the materialized metrics path let an unvalidated case-variant through: postage `
        + `${metric.return_postage_total}, total ${metric.return_total}`,
      );
    }

    // And every invoice-detail reader. These are the three surfaces the ps-435 guard counts.
    const detailSummary = await portalInvoiceSummary(caseScope, {
      clientId: CLIENT, dateFrom: FROM, dateTo: TO,
    } as never);
    const detailPeriod = await portalInvoicePeriodSummary(caseScope, {
      clientId: CLIENT, dateFrom: FROM, dateTo: TO, granularity: 'month',
    } as never);
    const detailRows = await portalInvoiceDetails(caseScope, {
      clientId: CLIENT, dateFrom: FROM, dateTo: TO,
    } as never);
    const readerTotals = [
      ['portalInvoiceSummary', detailSummary],
      ['portalInvoicePeriodSummary', detailPeriod],
      ['portalInvoiceDetails', detailRows],
    ] as const;
    for (const [name, result] of readerTotals) {
      const list = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
      for (const row of list as ReadonlyArray<{ returnPostageTotal?: unknown }>) {
        if (Number(row.returnPostageTotal ?? 0) !== 0) {
          throw new Error(
            `${name} exposed unvalidated case-variant return postage: ${String(row.returnPostageTotal)}`,
          );
        }
      }
    }
    ok('an UNVALIDATED case-variant return_label is excluded from every return surface');

    // ---- the positive counterpart -------------------------------------------------------
    //
    // A gate that rejected every case variant outright would pass the assertions above and
    // still be wrong: it would withhold money the customer legitimately owes. Give the SAME
    // uppercase spelling a complete, valid, policy-versioned tuple and it must be counted.
    const shipmentRows = await db.execute<{ id: number }>(rawSql`
      insert into shipments (order_id, is_return, selected_rate_json)
      values (${ORDER}, true, ${rawSql`${JSON.stringify({
        selectedRateCost: 4.18,
        cShippingRateAmount: 5.25,
        shippingMarginAmount: 1.07,
        shippingMarginPct: 25.6,
        customerRateSource: 'realized_customer_shipping_rate',
        rateCostSource: 'label_final_cost',
        customerShippingMoneyPolicyVersion: 'ps-437-v1',
      })}::jsonb`})
      returning id
    `);
    const returnShipmentId = shipmentRows[0]?.id;
    if (!returnShipmentId) throw new Error('failed to seed the return shipment');
    await db.execute(rawSql`
      insert into returns (order_id, client_id, return_shipment_id, return_customer_shipping_rate, initiated_by)
      values (${ORDER}, ${CLIENT}, ${returnShipmentId}, 5.25, 'cp059-integration')
    `);
    // Point the billing line at that shipment; amount matches the frozen tuple to the cent.
    await db.execute(rawSql`
      update billing_line_items
      set shipment_id = ${returnShipmentId}
      where client_id = ${CLIENT} and line_type = 'RETURN_LABEL'
    `);

    const validated = await billingSummary(summaryInput as never);
    const validatedRow = validated.clients.find((c) => c.clientId === CLIENT);
    if (!validatedRow) throw new Error('the seeded client must still appear');
    if (Number(validatedRow.returnPostageTotal) !== 5.25) {
      throw new Error(
        `a VALIDATED case-variant 'RETURN_LABEL' must be counted as return postage exactly once: `
        + `expected 5.25, got ${validatedRow.returnPostageTotal}. A gate that rejects every case `
        + `variant withholds money the customer legitimately owes.`,
      );
    }
    if (Number(validatedRow.returnTotal) !== 5.25) {
      throw new Error(
        `a VALIDATED case-variant must fund the canonical Return Total once: got ${validatedRow.returnTotal}`,
      );
    }
    ok('a VALIDATED case-variant return_label is counted exactly once, not permanently excluded');

    await db.execute(rawSql`delete from billing_line_items where client_id = ${CLIENT}`);
    await db.execute(rawSql`delete from billing_summary_metrics where client_id = ${CLIENT}`);
    await db.execute(rawSql`delete from returns where order_id = ${ORDER}`);
    await db.execute(rawSql`delete from shipments where order_id = ${ORDER}`);
    await db.execute(rawSql`delete from orders where id = ${ORDER}`);
    await db.execute(rawSql`delete from clients where id = ${CLIENT}`);
  }

  const EXPECTED_CHECKS = 25;
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
