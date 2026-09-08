import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadFixtureModule } from './lib/load-fixture-module';
import { portalQueryKey, portalReadKeys } from '../portal-client/src/lib/query-keys';
import ts from 'typescript';

const fixture = JSON.parse(readFileSync('fixtures/cp-059-producer-billing-rows.json', 'utf8'));
const rows = fixture.shapes[0].rows;
const { fetchCanonicalBillingDetails } = loadFixtureModule('src/lib/client-portal/prepship-billing-details-proxy.ts', {
  '../env.js': { env: { PREPSHIP_API_URL: 'http://127.0.0.1/fixture' } },
  '../env': { env: { PREPSHIP_API_URL: 'http://127.0.0.1/fixture' } },
});
let requested = '', calls = 0;
let body: any = { data: rows, totals: null, pagination: { page: 1, pageSize: 1, total: 3, totalPages: 3 } };
globalThis.fetch = async (url: any) => { requested = String(url); calls++; return Response.json(body); };
const query = { clientId: 7, dateFrom: '2026-07-01', dateTo: '2026-07-31', page: 1, pageSize: 1, sortBy: 'grandTotal', sortDir: 'desc' };
assert.equal((await fetchCanonicalBillingDetails('Bearer offline', query)).ok, true);
for (const [k, v] of Object.entries(query)) assert.equal(new URL(requested).searchParams.get(k), String(v));
for (const pagination of [undefined, { ...body.pagination, totalPages: 2 }, { ...body.pagination, page: 2 }, { ...body.pagination, pageSize: 500 }, { ...body.pagination, total: -1 }]) {
  body = { data: rows, totals: null, pagination };
  const before = calls;
  const result = await fetchCanonicalBillingDetails('Bearer offline', query);
  assert.equal(result.ok, false); assert.equal(result.status, 502);
  assert.equal(calls - before, 1, 'malformed page never falls back to full download');
}
body = { data: [], totals: null, pagination: { page: 5, pageSize: 1, total: 3, totalPages: 3 } };
assert.equal((await fetchCanonicalBillingDetails('Bearer offline', { ...query, page: 5 })).ok, true);
body = { data: rows, totals: null };
assert.equal((await fetchCanonicalBillingDetails('Bearer offline', { dateFrom: query.dateFrom, dateTo: query.dateTo })).ok, true, 'unpaged compatibility');

let executions = 0, release!: () => void;
let columns = ['selling_fee', 'selling_fee_breakdown', 'selling_fee_synced_at', 'selling_fee_source'];
const held = new Promise<void>(resolve => { release = resolve; });
const { ensureAnalyticsSchemaCapability } = loadFixtureModule('src/services/analytics-schema-capability.ts', {
  '../db/client': { db: { execute: async () => { executions++; await held; return columns.map(column_name => ({ column_name })); } } },
});
const startup = Array.from({ length: 20 }, () => ensureAnalyticsSchemaCapability());
assert.equal(executions, 1); release(); await Promise.all(startup);
await ensureAnalyticsSchemaCapability(); assert.equal(executions, 1);
columns = ['selling_fee'];
const missing = loadFixtureModule('src/services/analytics-schema-capability.ts', {
  '../db/client': { db: { execute: async () => { executions++; return columns.map(column_name => ({ column_name })); } } },
});
await assert.rejects(missing.ensureAnalyticsSchemaCapability(), (e: any) => e.status === 503);
const before = executions;
await assert.rejects(missing.ensureAnalyticsSchemaCapability(), (e: any) => e.status === 503);
assert.equal(executions, before, 'missing capability does not stampede');
const realNow = Date.now;
try {
  const later = realNow() + 31_000;
  Date.now = () => later;
  columns = ['selling_fee', 'selling_fee_breakdown', 'selling_fee_synced_at', 'selling_fee_source'];
  await missing.ensureAnalyticsSchemaCapability();
  assert.equal(executions, before + 1, 'capability recovers after backoff without a process restart');
  await missing.ensureAnalyticsSchemaCapability();
  assert.equal(executions, before + 1, 'successful recovery is retained');
} finally { Date.now = realNow; }
assert.notDeepEqual(portalQueryKey('A', portalReadKeys.inventory(1)), portalQueryKey('B', portalReadKeys.inventory(1)));
assert.notDeepEqual(portalReadKeys.inventory(1), portalReadKeys.inventory(1, '', 1, 50));
assert.notDeepEqual(portalReadKeys.inventory(1), portalReadKeys.inventory(2));

// Execute the real error registration without booting an API or connecting to a database.
// A controlled capability message is allowed; arbitrary 500/503 errors must stay redacted.
const mainSource = readFileSync('src/main.ts', 'utf8');
const parsed = ts.createSourceFile('main.ts', mainSource, ts.ScriptTarget.Latest, true);
const registration = parsed.statements.find(node => ts.isExpressionStatement(node)
  && ts.isCallExpression(node.expression) && node.expression.expression.getText(parsed) === 'app.onError');
assert(registration, 'main app error boundary must exist');
function errorBoundary(source: string) {
  return loadFixtureModule('src/main.ts', { 'fixture-capability': missing }, `
    import { AnalyticsSchemaUnavailable } from 'fixture-capability';
    let captured: any;
    const console = { error() {} };
    const app = { onError(fn: any) { captured = fn; } };
    ${source}
    export { captured };
  `).captured;
}
const registrationSource = registration.getText(parsed);
const respond = (handler: any, error: Error) => handler(error, {
  req: { url: 'http://fixture.test/dashboard', method: 'GET' }, get: () => 'fixture',
  json: (body: unknown, status: number) => ({ body, status }),
});
function assertErrorRedaction(handler: any) {
  for (const status of [500, 503]) {
    assert.deepEqual(respond(handler, Object.assign(new Error('secret query credentials'), { status })), {
      status, body: { error: 'Internal server error' },
    });
  }
  const unavailable = new missing.AnalyticsSchemaUnavailable();
  assert.deepEqual(respond(handler, unavailable), { status: 503, body: { error: unavailable.message } });
}
assertErrorRedaction(errorBoundary(registrationSource));
const exposed = registrationSource.replace('isSafeClientError || err instanceof AnalyticsSchemaUnavailable', 'true');
assert.notEqual(exposed, registrationSource, 'redaction mutation must apply');
assert.throws(() => assertErrorRedaction(errorBoundary(exposed)), /secret query credentials/);
console.log('PASS shared-db: paginated producer contract/fail-closed, read-only schema singleflight, cache identities');
