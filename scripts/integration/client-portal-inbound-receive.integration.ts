import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { setupTestEnv } from './guard';
setupTestEnv();
const { sql } = await import('../../src/db/client');
const { default: route } = await import('../../src/routes/client-portal/inbound');
const oldFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw Error('External requests blocked'); }) as typeof fetch;
function appFor(clientIds: number[] = [], global = true, permissions = ['settings:write']) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    for (const [key, value] of Object.entries({ userId: 'receive-fixture', role: global ? 'admin' : 'client_user', permissions, clientIds, storeIds: [] })) {
      c.set(key as never, value as never);
    }
    await next();
  });
  app.route('/', route); return app;
}
async function receive(app: Hono, id: number, body: unknown) {
  return app.request(`/inbound/${id}/receive`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
async function shipment(clientId: number | null, status = 'expected', skus = ['SKU-A', 'MISSING']) {
  const [head] = await sql`insert into inbound_shipments(client_id,reference,status) values (${clientId},'PO-RECEIVE',${status}) returning id`;
  const items = [];
  for (const sku of skus) {
    const [item] = await sql`insert into inbound_items(inbound_id,sku,expected_qty) values (${head!.id},${sku},5) returning id`;
    items.push({ id: item!.id as number, receivedQty: 3 });
  }
  return { id: head!.id as number, body: { addToInventory: true, items } };
}
try {
  await sql`truncate inventory, clients cascade`;
  const [a, b] = await sql`insert into clients(name,store_ids) values ('Receive Alpha',array[6601]),('Receive Beta',array[6602]) returning id`;
  const [inv] = await sql`insert into inventory(client_id,sku) values (${a!.id},'SKU-A') returning id`;
  await sql`insert into inventory(client_id,sku) values (${b!.id},'SKU-A')`;
  const app = appFor([a!.id], false), fixture = await shipment(a!.id);
  for (const value of ['', ' ', null, -1, 1.5, 2147483648, 'bad', true, {}, []]) {
    const response = await receive(app, fixture.id, { ...fixture.body, items: [{ ...fixture.body.items[0], receivedQty: value }, fixture.body.items[1]] });
    assert.equal(response.status, 400, JSON.stringify(value));
    const error = await response.json() as any; assert.ok(error.fieldErrors['items.0.receivedQty']);
  }
  for (const body of [null, {}, { ...fixture.body, addToInventory: 'false' }, { ...fixture.body, items: [fixture.body.items[0], fixture.body.items[0]] }]) {
    assert.equal((await receive(app, fixture.id, body)).status, 400);
  }
  assert.equal((await receive(app, fixture.id, { ...fixture.body, items: [fixture.body.items[0]] })).status, 409);
  assert.equal((await receive(app, fixture.id, { ...fixture.body, items: [{ id: 2147483647, receivedQty: 1 }, fixture.body.items[1]] })).status, 409);
  assert.equal((await receive(appFor([b!.id], false), fixture.id, fixture.body)).status, 403);
  assert.equal((await receive(appFor([a!.id], false, []), fixture.id, fixture.body)).status, 403);
  assert.equal((await sql`select status from inbound_shipments where id=${fixture.id}`)[0]!.status, 'expected');
  assert.equal((await sql`select * from inventory_ledger`).length, 0);

  const attempts = await Promise.all(Array.from({ length: 5 }, () => receive(app, fixture.id, fixture.body)));
  assert.equal(attempts.filter(response => response.status === 200).length, 1);
  assert.equal(attempts.filter(response => response.status === 409).length, 4);
  const saved = await attempts.find(response => response.status === 200)!.json() as any;
  assert.deepEqual(saved.data.bumps.map((row: any) => row.matched), [true, false]);
  assert.equal((await sql`select sum(qty)::int as qty from inventory_ledger where inventory_id=${inv!.id}`)[0]!.qty, 3);
  assert.equal((await sql`select * from inventory_ledger`).length, 1, 'one canonical movement, no cross-client match');
  const receipts = await (await app.request('/inbound/receipts')).json() as any;
  assert.equal(receipts.data[0].receivedUnits, 3); assert.equal(receipts.data[0].sku, 'SKU-A');
  assert.equal((await receive(app, fixture.id, { ...fixture.body, items: fixture.body.items.map(item => ({ ...item, receivedQty: 9 })) })).status, 409);
  assert.ok((await sql`select received_qty from inbound_items where inbound_id=${fixture.id}`).every(item => item.received_qty === 3));
  const cancelled = await shipment(a!.id, 'cancelled');
  assert.equal((await receive(app, cancelled.id, cancelled.body)).status, 409);
  const unassigned = await shipment(null);
  assert.equal((await receive(appFor(), unassigned.id, unassigned.body)).status, 409);
  const zero = await shipment(a!.id);
  const zeroBody = { addToInventory: false, items: zero.body.items.map((item, index) => ({ ...item, receivedQty: index ? 10 : 0 })) };
  assert.equal((await receive(app, zero.id, zeroBody)).status, 200, 'explicit zero and over-expected counts remain valid');
  assert.equal((await sql`select * from inventory_ledger`).length, 1, 'unchecked inventory option adds nothing');

  // Fail after a preceding line has already written, proving complete transaction rollback.
  await sql`insert into inventory(client_id,sku) values (${a!.id},'DUP'),(${a!.id},'dup')`;
  const duplicate = await shipment(a!.id, 'expected', ['SKU-A', 'DuP']);
  assert.equal((await receive(app, duplicate.id, duplicate.body)).status, 409);
  assert.equal((await sql`select status from inbound_shipments where id=${duplicate.id}`)[0]!.status, 'expected');
  assert.ok((await sql`select received_qty from inbound_items where inbound_id=${duplicate.id}`).every(item => item.received_qty === 0));
  assert.equal((await sql`select * from inventory_ledger`).length, 1, 'earlier movement was rolled back too');
  console.log('PASS receive: quantity/identity validation, exact membership, authorization, concurrency, receipt truth and rollback');
} finally { globalThis.fetch = oldFetch; await sql.end({ timeout: 5 }); }
