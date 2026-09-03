/* CP-062 — the return arrival signal ("delivered, not yet received") has ONE owner, and every
 * surface delegates to it.
 *
 * Executed, not described: the owner's rule runs against a truth table here; its SQL twin is
 * rendered through drizzle's PgDialect and the bound params compared with the constants; the
 * read model, the receiving queue, the contract and the two portal renders are checked for
 * delegation and for the absence of any second derivation. The twin's agreement with the JS
 * rule on real rows is the CP-062 integration's job (real PostgreSQL).
 *
 * AC-4 is held here too: nothing on the read path — the owner, the read model, the queue GET —
 * writes returns.status.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  RETURN_PRE_RECEIPT_STATUSES,
  isReturnShipmentDelivered,
  resolveReturnArrival,
  returnArrivedReadyToReceiveSql,
} from '../src/services/return-arrival';

const read = (file: string): string => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}\n  ${(error as Error).message}`);
  }
}

const OWNER = 'src/services/return-arrival.ts';
const DTO = 'src/routes/client-portal/returns/dto.ts';
const READS = 'src/routes/client-portal/returns/reads.ts';
const RECEIVING = 'src/routes/client-portal/returns/receiving.ts';
const CONTRACT = 'src/lib/client-portal/contracts/returns.ts';
const FE_LIST = 'portal-client/src/pages/Returns.tsx';
const FE_QUEUE = 'portal-client/src/components/returns/ReturnReceivingModal.tsx';
const FE_PRESENTATION = 'portal-client/src/components/returns/returnPresentation.ts';

const DELIVERED_AT = new Date('2026-07-24T18:04:00Z');

/** The call site hands the owner the four source facts, by name, in the owner's order. */
function delegatesToOwner(src: string, opener: string): void {
  const start = src.indexOf(opener);
  assert.ok(start >= 0, `${opener} present`);
  const block = src.slice(start, src.indexOf('})', start));
  let cursor = 0;
  for (const field of [
    'status: row.ret.status,',
    'trackingStatus: row.returnTrackingStatus,',
    'deliveredAt: row.returnDeliveredAt,',
    'shipmentVoided: row.returnShipmentVoided,',
  ]) {
    const at = block.indexOf(field, cursor);
    assert.ok(at > cursor, `${opener} passes ${field} in order`);
    cursor = at;
  }
}
const base = { status: 'in_transit', trackingStatus: 'delivered', deliveredAt: DELIVERED_AT, shipmentVoided: false };

// ── 1. The rule, executed ───────────────────────────────────────────────────
check('executed: delivered + in_transit → arrived, with the carrier fields surfaced', () => {
  assert.deepEqual(resolveReturnArrival(base), {
    trackingStatus: 'delivered',
    deliveredAt: '2026-07-24T18:04:00.000Z',
    arrivedReadyToReceive: true,
  });
});
check('executed: a status-only delivery (no event time) still counts as arrived', () => {
  const signal = resolveReturnArrival({ ...base, deliveredAt: null });
  assert.equal(signal.arrivedReadyToReceive, true);
  assert.equal(signal.deliveredAt, null);
});
check('executed: a delivery time with a stale status still counts as arrived', () => {
  assert.equal(resolveReturnArrival({ ...base, trackingStatus: 'in_transit' }).arrivedReadyToReceive, true);
});
check('executed: delivered but already received / inspected / closed / cancelled → NOT arrived (the time is still surfaced)', () => {
  for (const status of ['received', 'inspected', 'closed', 'cancelled']) {
    const signal = resolveReturnArrival({ ...base, status });
    assert.equal(signal.arrivedReadyToReceive, false, `${status} must not be ready to receive`);
    assert.equal(signal.deliveredAt, '2026-07-24T18:04:00.000Z', `${status} keeps deliveredAt`);
  }
});
check('executed: a voided return label never arrives', () => {
  assert.equal(isReturnShipmentDelivered({ ...base, shipmentVoided: true }), false);
  assert.equal(resolveReturnArrival({ ...base, shipmentVoided: true }).arrivedReadyToReceive, false);
});
check('executed: not delivered → not arrived, nulls where the carrier said nothing', () => {
  assert.deepEqual(resolveReturnArrival({ status: 'in_transit', trackingStatus: 'in_transit', deliveredAt: null, shipmentVoided: false }), {
    trackingStatus: 'in_transit',
    deliveredAt: null,
    arrivedReadyToReceive: false,
  });
  assert.deepEqual(resolveReturnArrival({ status: 'requested', trackingStatus: null, deliveredAt: null, shipmentVoided: null }), {
    trackingStatus: null,
    deliveredAt: null,
    arrivedReadyToReceive: false,
  });
});
check('executed: every pre-receipt status arrives when delivered; label_failed and unknown statuses do not', () => {
  assert.deepEqual([...RETURN_PRE_RECEIPT_STATUSES], ['requested', 'label_created', 'in_transit']);
  for (const status of RETURN_PRE_RECEIPT_STATUSES) {
    assert.equal(resolveReturnArrival({ ...base, status }).arrivedReadyToReceive, true, `${status} arrives`);
  }
  assert.equal(resolveReturnArrival({ ...base, status: 'label_failed' }).arrivedReadyToReceive, false);
  assert.equal(resolveReturnArrival({ ...base, status: 'something_new' }).arrivedReadyToReceive, false);
});
check('executed: an ISO string deliveredAt round-trips; an unparseable one renders null', () => {
  assert.equal(resolveReturnArrival({ ...base, deliveredAt: '2026-07-24T18:04:00Z' }).deliveredAt, '2026-07-24T18:04:00.000Z');
  assert.equal(resolveReturnArrival({ ...base, deliveredAt: 'not a date' }).deliveredAt, null);
});

// ── 2. The SQL twin, rendered ───────────────────────────────────────────────
check('rendered: the SQL twin binds delivered + the pre-receipt statuses in order and reads the shipment columns + returns.status', () => {
  const query = new PgDialect({ casing: 'snake_case' }).sqlToQuery(returnArrivedReadyToReceiveSql());
  assert.deepEqual(query.params, ['delivered', ...RETURN_PRE_RECEIPT_STATUSES], 'bound params');
  assert.match(query.sql, /coalesce\("shipments"\."voided", false\) = false/, 'voided arm');
  assert.match(query.sql, /"shipments"\."delivered_at" is not null or "shipments"\."tracking_status" = \$1/, 'delivered arm');
  assert.match(query.sql, /"returns"\."status" in \(\$2, \$3, \$4\)/, 'pre-receipt arm');
  // A return with no linked shipment renders NULL inside; NULL sorts FIRST under DESC. The whole
  // predicate must be coalesced to false so "no shipment" sorts with "not arrived".
  assert.match(query.sql.trim(), /^coalesce\(\([\s\S]*\), false\)$/, 'null-safe: the whole predicate is coalesced to false');
});

// ── 3. Delegation and the absence of a second derivation ────────────────────
check('the owner is a leaf: no db client, no writes', () => {
  const src = read(OWNER);
  assert.doesNotMatch(src, /db\/client|from '\.\.\/db\/client'/, 'owner imports the db client');
  assert.doesNotMatch(src, /\.update\(|\.insert\(|\.delete\(/, 'owner writes');
});
check('dto.ts delegates to resolveReturnArrival and exposes exactly its three fields', () => {
  const src = read(DTO);
  assert.match(src, /import \{ resolveReturnArrival \} from '\.\.\/\.\.\/\.\.\/services\/return-arrival'/);
  delegatesToOwner(src, 'const arrival = resolveReturnArrival({');
  assert.match(src, /trackingStatus: arrival\.trackingStatus,/);
  assert.match(src, /deliveredAt: arrival\.deliveredAt,/);
  assert.match(src, /arrivedReadyToReceive: arrival\.arrivedReadyToReceive,/);
});
check('reads.ts projects tracking_status + delivered_at of the linked return shipment for BOTH the list and the detail', () => {
  const src = read(READS);
  assert.equal(src.split('returnTrackingStatus: shipments.trackingStatus,').length - 1, 2, 'trackingStatus projected twice');
  assert.equal(src.split('returnDeliveredAt: shipments.deliveredAt,').length - 1, 2, 'deliveredAt projected twice');
  assert.doesNotMatch(src, /trackingStatus:\s*row\.returnTrackingStatus/, 'the detail no longer maps trackingStatus on its own');
});
check('receiving.ts orders arrived-first through the SQL twin, then newest, and maps rows through the owner', () => {
  const src = read(RECEIVING);
  const order = src.indexOf('.orderBy(desc(returnArrivedReadyToReceiveSql()), desc(returns.requestedAt), desc(returns.id))');
  assert.ok(order > 0, 'arrived-first orderBy present');
  delegatesToOwner(src, '...resolveReturnArrival({');
  for (const column of ['returnTrackingStatus: shipments.trackingStatus', 'returnDeliveredAt: shipments.deliveredAt', 'returnShipmentVoided: shipments.voided']) {
    assert.ok(src.includes(column), `queue projects ${column}`);
  }
});
check('no surface re-derives delivery: the delivered literal and the comparisons live only in the owner', () => {
  for (const file of [DTO, READS, RECEIVING, FE_LIST, FE_QUEUE, FE_PRESENTATION]) {
    const src = read(file);
    assert.doesNotMatch(src, /['"]delivered['"]/, `${file} carries the delivered literal`);
    assert.doesNotMatch(src, /trackingStatus\s*[!=]==?/, `${file} compares trackingStatus`);
    assert.doesNotMatch(src, /deliveredAt\s*[!=]==?/, `${file} compares deliveredAt`);
  }
});
check('AC-4: nothing on the read path writes returns.status (owner, read model, queue GET)', () => {
  assert.doesNotMatch(read(READS), /\.update\(/, 'reads.ts updates');
  const queue = read(RECEIVING);
  const start = queue.indexOf('function registerReceivingQueueRoute');
  const end = queue.indexOf('\n}\n', start);
  assert.ok(start > 0 && end > start, 'queue route located');
  assert.doesNotMatch(queue.slice(start, end), /\.update\(|\.set\(/, 'the queue GET writes');
});
check('contract: PortalReturnRow declares the three fields, the detail inherits them, the receiving row picks them', () => {
  const src = read(CONTRACT);
  const row = src.slice(src.indexOf('export interface PortalReturnRow {'), src.indexOf('export interface PortalReturnItem'));
  assert.match(row, /\n  trackingStatus: string \| null;/);
  assert.match(row, /\n  deliveredAt: string \| null;/);
  assert.match(row, /\n  arrivedReadyToReceive: boolean;/);
  const detail = src.slice(src.indexOf('export interface PortalReturnDetail'), src.indexOf('export interface', src.indexOf('export interface PortalReturnDetail') + 10));
  assert.doesNotMatch(detail, /trackingStatus/, 'the detail re-declares trackingStatus');
  const receiving = src.slice(src.indexOf('export interface PortalReturnReceivingRow'), src.indexOf('export type ReturnInspectionCondition'));
  for (const field of ["'trackingStatus'", "'deliveredAt'", "'arrivedReadyToReceive'"]) assert.ok(receiving.includes(field), `receiving row picks ${field}`);
});
check('the portal renders the backend flag verbatim on the list and the queue', () => {
  const list = read(FE_LIST);
  assert.match(list, /row\.arrivedReadyToReceive && \(/, 'list renders the flag');
  assert.match(list, /Arrived — ready to receive/, 'list wording');
  assert.match(list, /row\.deliveredAt \? \(/, 'list renders the delivered time');
  assert.match(read(FE_QUEUE), /row\.arrivedReadyToReceive/, 'queue renders the flag');
});
check('wiring: package.json and the integration workflow run the CP-062 proofs', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts['test:client-portal-returns-cp062'], 'tsx scripts/client-portal-returns-cp062-guard.ts');
  assert.equal(pkg.scripts['test:client-portal-returns-cp062:integration'], 'tsx scripts/integration/client-portal-returns-cp062.integration.ts');
  assert.match(read('.github/workflows/integration-tests.yml'), /npm run test:client-portal-returns-cp062:integration/);
});

console.log(`\nCP-062 guard: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
