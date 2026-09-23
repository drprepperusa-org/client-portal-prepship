import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { setupTestEnv } from './guard';

setupTestEnv();
const { sql } = await import('../../src/db/client');
const { default: route } = await import('../../src/routes/client-portal/inbound');
const oldFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw Error('External requests blocked in inbound create tests'); }) as typeof fetch;
function appFor(actor = 'inbound-fixture', clientIds: number[] = [], global = true, permissions = ['settings:write']) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    for (const [key, value] of Object.entries({ userId: actor, role: global ? 'admin' : 'client_user', permissions, clientIds, storeIds: [] })) {
      c.set(key as never, value as never);
    }
    await next();
  });
  app.route('/', route); return app;
}
async function post(app: Hono, body: unknown) {
  const response = await app.request('/inbound', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.text() };
}
const parsed = (response: { body: string }) => JSON.parse(response.body);
try {
  await sql`truncate portal_inbound_create_requests, inbound_items, inbound_shipments, client_portal_audit_logs, clients cascade`;
  const [a, b] = await sql`insert into clients(name, store_ids) values ('Inbound Alpha',array[6501]),('Inbound Beta',array[6502]) returning id`;
  const app = appFor();
  const intent = { idempotencyKey: randomUUID(), clientId: a!.id, reference: 'PO-RETRY', items: [{ sku: 'SKU-1', expectedQty: 4 }, { name: 'Name only', expectedQty: 0 }] };
  const responses = await Promise.all(Array.from({ length: 8 }, () => post(app, intent)));
  assert.equal(responses.filter(r => r.status === 201).length, 1);
  assert.equal(responses.filter(r => r.status === 200).length, 7);
  const saved = parsed(responses[0]!).data;
  assert.ok(responses.every(r => parsed(r).data.id === saved.id));
  assert.equal(saved.reference, 'PO-RETRY'); assert.equal(saved.clientName, 'Inbound Alpha');
  assert.equal(saved.items.length, 2); assert.equal(saved.expectedUnits, 4);
  assert.equal((await sql`select * from inbound_shipments`).length, 1);
  assert.equal((await sql`select * from inbound_items`).length, 2);
  assert.equal((await sql`select * from portal_inbound_create_requests`).length, 1);
  assert.equal((await sql`select * from client_portal_audit_logs where event='portal.inbound.create'`).length, 1);
  assert.ok(!/requestHash|actorUserId|idempotencyKey/.test(JSON.stringify(saved)), 'private receipt fields never enter the DTO');
  // Simulate a committed save whose HTTP response was lost: a fresh request still resolves the same record.
  const retried = await post(appFor(), intent);
  assert.equal(retried.status, 200); assert.equal(parsed(retried).data.id, saved.id);
  assert.equal((await post(app, { ...intent, reference: 'CHANGED' })).status, 409);
  assert.equal((await post(appFor('different-actor'), intent)).status, 201, 'keys are actor scoped');
  assert.equal((await post(appFor('inbound-fixture', [b!.id], false), intent)).status, 403);
  assert.equal((await post(appFor('inbound-fixture', [a!.id], false, []), intent)).status, 403, 'permission rechecked on replay');
  await sql`update inbound_shipments set client_id=${b!.id} where id=${saved.id}`;
  assert.equal((await post(appFor('inbound-fixture', [a!.id], false), intent)).status, 403, 'saved record current scope rechecked');
  await sql`update inbound_shipments set client_id=${a!.id} where id=${saved.id}`;
  await sql`delete from inbound_shipments where id=${saved.id}`;
  assert.equal((await post(app, intent)).status, 409, 'deleted shipment cannot be resurrected by replay');
  assert.equal((await sql`select inbound_id from portal_inbound_create_requests where actor_user_id='inbound-fixture'`)[0]!.inbound_id, null);

  // Force an actual item INSERT failure after the header INSERT, proving database rollback.
  await sql.unsafe(`create or replace function inbound_fixture_fail() returns trigger language plpgsql as $$
    begin if NEW.sku='FAIL-ITEM' then raise exception 'fixture item failure'; end if; return NEW; end $$;
    create trigger inbound_fixture_failure before insert on inbound_items for each row execute function inbound_fixture_fail();`);
  const failure = { ...intent, idempotencyKey: randomUUID(), reference: 'ROLLBACK', items: [{ sku: 'FAIL-ITEM', expectedQty: 2 }] };
  assert.equal((await post(app, failure)).status, 500);
  assert.equal((await sql`select id from inbound_shipments where reference='ROLLBACK'`).length, 0);
  assert.equal((await sql`select request_key from portal_inbound_create_requests where request_key=${failure.idempotencyKey}`).length, 0);
  assert.equal((await post(app, { ...failure, idempotencyKey: undefined })).status, 500, 'legacy caller is also atomic');
  assert.equal((await sql`select id from inbound_shipments where reference='ROLLBACK'`).length, 0);
  await sql.unsafe('drop trigger inbound_fixture_failure on inbound_items; drop function inbound_fixture_fail();');
  assert.equal((await post(app, failure)).status, 201, 'rolled back intent can safely retry');
  assert.equal((await post(app, failure)).status, 200);
  assert.equal((await post(app, { ...intent, idempotencyKey: 'bad' })).status, 400);
  assert.equal((await post(app, { ...intent, idempotencyKey: randomUUID(), items: [{ sku: 'A', expectedQty: -1 }] })).status, 400);
  assert.equal((await post(app, {})).status, 201, 'optional legacy headers remain supported');

  // Apply the exact migration twice, including default grants that it must remove.
  await sql.unsafe(`do $$ begin
    if not exists(select from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    end $$; grant all on portal_inbound_create_requests to anon, authenticated;`);
  const migration = readFileSync('drizzle/0053_portal_inbound_create_requests.sql', 'utf8');
  await sql.unsafe(migration); await sql.unsafe(migration);
  assert.equal((await sql`select relrowsecurity from pg_class where oid='public.portal_inbound_create_requests'::regclass`)[0]!.relrowsecurity, true);
  for (const role of ['anon', 'authenticated']) {
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      assert.equal((await sql`select has_table_privilege(${role},'public.portal_inbound_create_requests',${privilege}) as allowed`)[0]!.allowed, false);
    }
  }
  console.log('PASS inbound create: concurrency, rollback, durable replay, scope, deletion, DTO and private migration');
} finally { globalThis.fetch = oldFetch; await sql.end({ timeout: 5 }); }
