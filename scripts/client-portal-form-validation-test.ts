import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { loadFixtureModule } from './lib/load-fixture-module';
import * as contract from '../src/lib/client-portal/contracts/create-form-validation';
import { orders } from '../src/db/schema/orders';
import { orderItems } from '../src/db/schema/order-items';

const goodReturn = { orderId: 101, reason: 'Wrong item', returnRecipientName: 'Client', items: [{ sku: 'SKU-A', quantity: 1 }] };
assert.deepEqual(contract.validateReturnCreate(goodReturn), {});
assert.deepEqual(contract.validateReturnCreate({ ...goodReturn, returnRecipientName: undefined }), {}, 'legacy backend recipient default remains allowed');
assert.ok(contract.validateReturnCreate({ ...goodReturn, reason: '  ' }).reason);
assert.ok(contract.validateReturnCreate({ ...goodReturn, reason: 'x'.repeat(501) }).reason);
assert.ok(contract.validateReturnCreate({ ...goodReturn, returnRecipientName: 'x'.repeat(121) }).returnRecipientName);
assert.ok(contract.returnQuantityError(Infinity));
assert.equal(contract.returnQuantityError(1.5, 2), undefined, 'return quantities follow the existing numeric column, not inbound integer rules');
assert.ok(contract.returnQuantityError(3, 2));
assert.deepEqual(contract.validateInboundCreate({}), {}, 'optional inbound headers stay optional');
assert.deepEqual(contract.validateInboundCreate({ items: [{ sku: '', name: '', expectedQty: '' }] }), {}, 'empty placeholders are allowed');
assert.deepEqual(contract.validateInboundCreate({ items: [{ name: 'Item', expectedQty: 0 }], expectedDate: '2028-02-29' }), {});
for (const qty of [-1, 0.5, Infinity, NaN, 'bad', true, {}, 2147483648]) {
  assert.ok(contract.validateInboundCreate({ items: [{ sku: 'A', expectedQty: qty }] })['items.0.expectedQty']);
}
for (const date of ['2026-02-30', '2026-02-29', 'yesterday', 'bad', 123]) assert.ok(contract.validateInboundCreate({ expectedDate: date }).expectedDate);
assert.ok(contract.validateInboundCreate({ items: [{ expectedQty: 2 }] })['items.0.sku']);
assert.ok(contract.validateInboundCreate({ items: Array(201).fill({ sku: 'A' }) }).items);
assert.ok(contract.validateReturnCreate({ ...goodReturn, items: [{ sku: {}, quantity: 0 }] })['items.0.quantity']);

// Real Hono handlers; only I/O owners are substituted. No DB/provider credentials or external calls.
const writes: unknown[] = [];
let scopedReads = 0;
let orderVisible = true;
let capturedReturn: any;
const oldFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw new Error('External I/O forbidden in form-validation fixtures'); }) as typeof fetch;
const db = {
  insert: (table: unknown) => ({ values: (values: unknown) => {
    writes.push({ table, values }); return { returning: async () => [{ id: 900 }] };
  } }),
  select: () => {
    let table: unknown;
    const rows = () => table === orders ? (orderVisible ? [{ id: 101, clientId: 1, clientName: 'Backend client', orderNumber: '101', raw: {} }] : []) :
      table === orderItems ? [{ id: 10, sku: 'SKU-A', name: 'Item', quantity: 2 }] : [];
    const chain: any = { from: (next: unknown) => { table = next; return chain; }, leftJoin: () => chain,
      where: () => chain, limit: async () => rows(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows()).then(resolve) };
    return chain;
  },
};
const query = { scopeOrResponse: (c: any) => c.get('fixtureScope') };
const scope = { isClientPortalScope: (value: unknown) => Boolean(value) };
const audit = { recordPortalAudit: async () => {} };
const returnsPath = 'src/routes/client-portal/returns/actions.ts';
const returnRoutes = loadFixtureModule(returnsPath, {
  '../../../lib/client-portal/contracts/create-form-validation': contract,
  '../../../db/schema/orders': { orders }, '../../../db/schema/order-items': { orderItems },
  '../../../db/client': { db }, '../../../lib/client-portal/query-params': query, '../../../lib/client-portal/scope': scope,
  '../../../lib/client-portal/audit': audit,
  '../../../lib/client-portal/predicates': { orderScopePredicate: () => { scopedReads++; return sql`true`; } },
  '../../../services/return-request': { createReturnRequest: async (args: unknown) => { writes.push(args); capturedReturn = args; return { id: 900 }; }, ReturnRequestRejectedError: class extends Error {} },
  '../../../services/returns': {}, '../../../services/return-delivery': {},
  '../../../services/return-activity': { recordReturnActivity: async () => {} },
  './billing-date': {}, './external-label': {}, './shared': { buildReturnReference: async () => '101-RETURN' },
}, readFileSync(returnsPath, 'utf8') + '\nexport { registerReturnCreateRoute };');
const inboundRoutes = loadFixtureModule('src/routes/client-portal/inbound.ts', {
  '../../lib/client-portal/contracts/create-form-validation': contract,
  '../../db/client': { db }, '../../lib/client-portal/query-params': query, '../../lib/client-portal/scope': scope,
  '../../lib/client-portal/audit': audit, '../../lib/client-portal/dto': {}, '../../services/inventory-movement': {},
  '../../lib/client-portal/read-models/inbound-receipts': {}, '../../lib/client-portal/read-models/inbound-receipt-export': {},
}).default;
function appFor(isGlobal = true, permissions: string[] = []) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('fixtureScope' as never, { isGlobal, permissions, clientIds: [1], storeIds: [], email: 'fixture@example.test' } as never);
    await next();
  });
  returnRoutes.registerReturnCreateRoute(app);
  app.route('/', inboundRoutes);
  return app;
}
const app = appFor();
async function post(path: string, body: unknown, target = app) {
  return target.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
try {
  for (const [path, body, field] of [
    ['/returns', { ...goodReturn, reason: ' ' }, 'reason'],
    ['/returns', { ...goodReturn, returnRecipientName: [] }, 'returnRecipientName'],
    ['/returns', { ...goodReturn, items: [{ sku: 'SKU-A', quantity: 3 }] }, 'items.0.quantity'],
    ['/returns', { ...goodReturn, items: [{ sku: {}, quantity: 0 }] }, 'items.0.quantity'],
    ['/returns', { ...goodReturn, items: null }, 'items'],
    ['/inbound', { items: [{ sku: 'A', expectedQty: 0.25 }] }, 'items.0.expectedQty'],
    ['/inbound', { items: [{ expectedQty: 4 }] }, 'items.0.sku'],
    ['/inbound', { expectedDate: '2026-02-30' }, 'expectedDate'],
    ['/inbound', { clientId: '1' }, 'clientId'],
    ['/inbound', { status: ['expected'] }, 'status'],
    ['/inbound', null, 'form'],
  ] as const) {
    writes.length = 0;
    const response = await post(path, body);
    assert.equal(response.status, 400, `${path} ${field}`);
    const payload = await response.json() as any;
    assert.equal(typeof payload.fieldErrors[field], 'string');
    assert.equal(writes.length, 0, 'invalid fields cannot partially create a record');
  }
  assert.equal((await post('/inbound', {}, appFor(false))).status, 403, 'admin permission remains required');
  assert.equal((await post('/inbound', { clientId: 2 }, appFor(false, ['settings:write']))).status, 403, 'staff client scope remains checked');
  orderVisible = false;
  assert.equal((await post('/returns', goodReturn)).status, 404, 'invisible order stays inaccessible');
  orderVisible = true;
  assert.equal((await post('/returns', { ...goodReturn, returnRecipientName: undefined })).status, 201);
  assert.equal(capturedReturn.values.returnRecipientName, 'Backend client');
  assert.equal(capturedReturn.items[0].quantity, 1);
  assert.ok(scopedReads > 0, 'return read still delegates scope to its canonical predicate');
  assert.equal((await post('/inbound', { items: [{ name: 'Only name', expectedQty: 0 }] })).status, 201);
  assert.equal((await post('/inbound', {})).status, 201);
  console.log('PASS shared form syntax, field error paths, real-route rejection before writes, optional defaults and scope boundaries');
} finally { globalThis.fetch = oldFetch; }
