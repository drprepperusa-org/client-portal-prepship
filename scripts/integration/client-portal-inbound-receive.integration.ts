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
async function preview(app: Hono, id: number, body: unknown) {
  return app.request(`/inbound/${id}/receive/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
async function commit(app: Hono, id: number, body: unknown) {
  return app.request(`/inbound/${id}/receive`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
async function receive(app: Hono, id: number, body: unknown) {
  const result = await preview(app, id, body);
  if (result.status !== 200) return result;
  const plan = await result.json() as any;
  return commit(app, id, { ...(body as object), previewFingerprint: plan.data.fingerprint });
}
async function shipment(clientId: number | null, status = 'expected', skus = ['SKU-A', 'SKU-B']) {
  const [head] = await sql`insert into inbound_shipments(client_id,reference,status) values (${clientId},'PO-RECEIVE',${status}) returning id`;
  const items = [];
  for (const sku of skus) {
    const [item] = await sql`insert into inbound_items(inbound_id,sku,expected_qty) values (${head!.id},${sku},5) returning id`;
    items.push({ id: item!.id as number, receivedQty: 3 });
  }
  return { id: head!.id as number, body: { addToInventory: true, items } };
}
try {
  await sql.unsafe('drop trigger if exists receive_fixture_failure on inventory_ledger; drop function if exists receive_fixture_fail();');
  await sql`truncate inventory, clients cascade`;
  const [a, b] = await sql`insert into clients(name,store_ids) values ('Receive Alpha',array[6601]),('Receive Beta',array[6602]) returning id`;
  const [inv] = await sql`insert into inventory(client_id,sku) values (${a!.id},'SKU-A') returning id`;
  await sql`insert into inventory(client_id,sku) values (${b!.id},'SKU-A'),(${a!.id},'SKU-B')`;
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
  assert.deepEqual(saved.data.bumps.map((row: any) => row.matched), [true, true]);
  assert.equal((await sql`select sum(qty)::int as qty from inventory_ledger where inventory_id=${inv!.id}`)[0]!.qty, 3);
  assert.equal((await sql`select * from inventory_ledger`).length, 2, 'one movement per item, no cross-client match');
  const receipts = await (await app.request('/inbound/receipts')).json() as any;
  assert.equal(receipts.data.length, 2);
  assert.ok(receipts.data.some((row: any) => row.sku === 'SKU-A' && row.receivedUnits === 3));
  assert.ok(receipts.data.some((row: any) => row.sku === 'SKU-B' && row.receivedUnits === 3));
  assert.equal((await receive(app, fixture.id, { ...fixture.body, items: fixture.body.items.map(item => ({ ...item, receivedQty: 9 })) })).status, 409);
  assert.ok((await sql`select received_qty from inbound_items where inbound_id=${fixture.id}`).every(item => item.received_qty === 3));
  const cancelled = await shipment(a!.id, 'cancelled');
  assert.equal((await receive(app, cancelled.id, cancelled.body)).status, 409);
  const unassigned = await shipment(null);
  assert.equal((await receive(appFor(), unassigned.id, unassigned.body)).status, 409);
  const zero = await shipment(a!.id);
  const zeroBody = { addToInventory: false, items: zero.body.items.map((item, index) => ({ ...item, receivedQty: index ? 10 : 0 })) };
  assert.equal((await receive(app, zero.id, zeroBody)).status, 200, 'explicit zero and over-expected counts remain valid');
  assert.equal((await sql`select * from inventory_ledger`).length, 2, 'unchecked inventory option adds nothing');

  // Duplicate matches block the receipt before any quantities or ledger rows are saved.
  await sql`insert into inventory(client_id,sku) values (${a!.id},'DUP'),(${a!.id},'dup')`;
  const duplicate = await shipment(a!.id, 'expected', ['SKU-A', 'DuP']);
  const duplicatePreview = (await (await preview(app, duplicate.id, duplicate.body)).json() as any).data;
  assert.equal(duplicatePreview.canConfirm, false); assert.equal(duplicatePreview.rows[1].inventoryMatch, 'ambiguous');
  assert.equal((await receive(app, duplicate.id, duplicate.body)).status, 409);
  assert.equal((await sql`select status from inbound_shipments where id=${duplicate.id}`)[0]!.status, 'expected');
  assert.ok((await sql`select received_qty from inbound_items where inbound_id=${duplicate.id}`).every(item => item.received_qty === 0));
  assert.equal((await sql`select * from inventory_ledger`).length, 2, 'blocked receipt adds no movement');
  const review = await shipment(a!.id, 'expected', ['sku-a', 'MISSING']);
  const reviewBody = { ...review.body, items: [{ ...review.body.items[0]!, receivedQty: 2 }, { ...review.body.items[1]!, receivedQty: 8 }] };
  const beforeLedger = (await sql`select * from inventory_ledger`).length;
  const blockedResponse = await preview(app, review.id, reviewBody);
  assert.equal(blockedResponse.status, 200);
  const blocked = (await blockedResponse.json() as any).data;
  assert.equal(blocked.canConfirm, false); assert.equal(blocked.fingerprint, null);
  assert.deepEqual(blocked.rows.map((row: any) => [row.difference, row.quantityStatus, row.inventoryMatch, row.inventoryUnits]),
    [[-3, 'short', 'matched', 2], [3, 'extra', 'missing', 0]]);
  assert.deepEqual([blocked.expectedUnits, blocked.receivedUnits, blocked.inventoryUnits], [10, 10, 2]);
  assert.ok(blocked.rows[1].issue);
  assert.equal((await receive(app, review.id, reviewBody)).status, 409, 'unmatched positive quantities cannot silently skip inventory');
  assert.equal((await sql`select * from inventory_ledger`).length, beforeLedger, 'preview and rejection are read-only');
  assert.equal((await sql`select status from inbound_shipments where id=${review.id}`)[0]!.status, 'expected');
  assert.ok((await sql`select received_qty from inbound_items where inbound_id=${review.id}`).every(item => item.received_qty === 0));
  const withoutInventory = (await (await preview(app, review.id, { ...reviewBody, addToInventory: false })).json() as any).data;
  assert.equal(withoutInventory.canConfirm, true); assert.equal(withoutInventory.inventoryUnits, 0);
  const zeroMissing = { ...reviewBody, items: [reviewBody.items[0]!, { ...reviewBody.items[1]!, receivedQty: 0 }] };
  const ready = (await (await preview(app, review.id, zeroMissing)).json() as any).data;
  assert.equal(ready.canConfirm, true); assert.equal(ready.rows[1].issue, null);
  assert.equal((await commit(app, review.id, zeroMissing)).status, 409, 'preview fingerprint required');
  assert.equal((await commit(app, review.id, { ...zeroMissing, previewFingerprint: ready.fingerprint,
    items: [{ ...zeroMissing.items[0]!, receivedQty: 4 }, zeroMissing.items[1]!] })).status, 409, 'changed intent rejected');
  await sql`update inbound_items set expected_qty=6 where id=${reviewBody.items[0]!.id}`;
  assert.equal((await commit(app, review.id, { ...zeroMissing, previewFingerprint: ready.fingerprint })).status, 409, 'changed expected quantity rejected');
  await sql`update inbound_items set expected_qty=5 where id=${reviewBody.items[0]!.id}`;
  await sql`update inventory set sku='RENAMED' where id=${inv!.id}`;
  assert.equal((await commit(app, review.id, { ...zeroMissing, previewFingerprint: ready.fingerprint })).status, 409, 'lost inventory match rejected');
  await sql`update inventory set sku='SKU-A' where id=${inv!.id}`;
  assert.equal((await commit(appFor([b!.id], false), review.id, { ...zeroMissing, previewFingerprint: ready.fingerprint })).status, 403);
  assert.equal((await commit(app, review.id, { ...zeroMissing, previewFingerprint: ready.fingerprint })).status, 200);

  const remap = await shipment(a!.id, 'expected', ['SKU-B']);
  const remapPlan = (await (await preview(app, remap.id, remap.body)).json() as any).data;
  await sql`update inventory set sku='OLD-B' where client_id=${a!.id} and sku='SKU-B'`;
  await sql`insert into inventory(client_id,sku) values (${a!.id},'SKU-B')`;
  assert.equal((await commit(app, remap.id, { ...remap.body, previewFingerprint: remapPlan.fingerprint })).status, 409, 'new match identity rejected');

  // Trigger failure on the second actual ledger insertion proves complete rollback.
  const rollback = await shipment(a!.id);
  await sql.unsafe(`create or replace function receive_fixture_fail() returns trigger language plpgsql as $$
    begin if NEW.sku='SKU-B' then raise exception 'fixture receive failure'; end if; return NEW; end $$;
    create trigger receive_fixture_failure before insert on inventory_ledger for each row execute function receive_fixture_fail();`);
  const ledgerBeforeFailure = (await sql`select * from inventory_ledger`).length;
  assert.equal((await receive(app, rollback.id, rollback.body)).status, 500);
  assert.equal((await sql`select * from inventory_ledger`).length, ledgerBeforeFailure);
  assert.equal((await sql`select status from inbound_shipments where id=${rollback.id}`)[0]!.status, 'expected');
  assert.ok((await sql`select received_qty from inbound_items where inbound_id=${rollback.id}`).every(item => item.received_qty === 0));
  await sql.unsafe('drop trigger receive_fixture_failure on inventory_ledger; drop function receive_fixture_fail();');
  assert.equal((await receive(app, rollback.id, rollback.body)).status, 200);
  console.log('PASS receive: quantity/identity validation, exact membership, authorization, concurrency, receipt truth, preview, stale intent/matches and rollback');
} finally { globalThis.fetch = oldFetch; await sql.end({ timeout: 5 }); }
