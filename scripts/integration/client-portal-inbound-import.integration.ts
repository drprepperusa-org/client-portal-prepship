import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { setupTestEnv } from './guard';
import { parseInboundImport } from '../../src/lib/client-portal/inbound-import-csv';
setupTestEnv();
const { sql } = await import('../../src/db/client');
const { default: route } = await import('../../src/routes/client-portal/inbound');
const oldFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw Error('External requests blocked'); }) as typeof fetch;
function appFor(clientIds: number[] = [], global = true, actor = 'import-fixture', permissions = ['settings:write']) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    for (const [key, value] of Object.entries({ userId: actor, role: global ? 'admin' : 'client_user', permissions, clientIds, storeIds: [] })) {
      c.set(key as never, value as never);
    }
    await next();
  });
  app.route('/', route); return app;
}
async function post(app: Hono, path: string, body: unknown) {
  const response = await app.request('/inbound/import' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const raw = await response.text();
  let responseBody: any; try { responseBody = JSON.parse(raw); } catch { responseBody = { error: raw }; }
  return { status: response.status, body: responseBody };
}
try {
  await sql.unsafe('drop trigger if exists import_fixture_failure on inbound_items; drop function if exists import_fixture_fail();');
  await sql`truncate client_portal_audit_logs, clients cascade`;
  const [a, b] = await sql`insert into clients(name,store_ids) values ('Import Alpha',array[6701]),('Import Beta',array[6702]) returning id,name`;
  const allowed = [{ id: a!.id as number, name: a!.name as string }];
  const csv = 'client,reference,supplier,expected_date,sku,name,qty\nImport Alpha,PO-A,"Acme, Inc",2026-09-24,A,"Quoted ""name""\nsecond line",3\n'
    + 'Import Alpha,PO-A,"Acme, Inc",2026-09-24,B,Second,0\nImport Alpha,PO-B,Other,2026-09-25,C,Third,5';
  const parsed = parseInboundImport(csv, allowed);
  assert.equal(parsed.preview.valid, true); assert.equal(parsed.preview.shipmentCount, 2); assert.equal(parsed.preview.itemCount, 3);
  assert.deepEqual(parsed.preview.rows.map(row => row.line), [2, 4, 5]);
  assert.equal(parsed.preview.rows[0]!.values.name, 'Quoted "name"\nsecond line');
  assert.equal(parsed.preview.rows[0]!.values.status, 'expected');
  const invalid = [
    'client,reference,sku,qty\nUnknown,PO,A,1', 'client,reference,sku,qty\nImport Alpha,,A,1',
    'client,reference,sku,qty\nImport Alpha,PO,,1', 'client,reference,sku,qty\nImport Alpha,PO,A,',
    ...['-1', '1.5', 'wat', '2147483648'].map(qty => `client,reference,sku,qty\nImport Alpha,PO,A,${qty}`),
    'client,reference,sku,qty,expected_date\nImport Alpha,PO,A,1,2026-02-30',
    'client,reference,sku,qty,status\nImport Alpha,PO,A,1,unknown',
    'client,reference,sku,qty,supplier\nImport Alpha,PO,A,1,ONE\nImport Alpha,PO,B,1,TWO',
    'client,reference,sku,qty\nImport Alpha,PO,A,1,EXTRA', 'client,reference,sku,qty\nImport Alpha,PO,A,"1',
    'client,reference,sku,qty,qty\nImport Alpha,PO,A,1,1', 'client,reference,sku,qty,typo\nImport Alpha,PO,A,1,x',
  ];
  for (const input of invalid) assert.equal(parseInboundImport(input, allowed).preview.valid, false, input);
  assert.equal(parseInboundImport('client,reference,sku,qty\nImport Alpha,PO,A,1', [...allowed, { id: b!.id, name: 'Import Alpha' }]).preview.valid, false);
  assert.equal(parseInboundImport('x'.repeat(1048577), allowed).preview.valid, false);
  assert.equal(parseInboundImport('client,reference,sku,qty\n' + Array.from({ length: 201 }, () => 'Import Alpha,PO,A,1').join('\n'), allowed).preview.valid, false);
  assert.equal(parseInboundImport('client,reference,sku,qty\n' + Array.from({ length: 501 }, (_, i) => `Import Alpha,PO-${i},A,1`).join('\n'), allowed).preview.valid, false);
  const conflict = 'client,reference,sku,qty,supplier\nImport Alpha,PO,A,1,ONE\nImport Alpha,PO,B,1,TWO\nImport Alpha,PO,C,1,ONE';
  assert.ok(parseInboundImport(conflict, allowed).preview.rows.every(row => row.errors.some(error => error.includes('conflict'))));
  const oversized = 'client,reference,sku,qty\n' + Array.from({ length: 5001 }, (_, i) => `Import Alpha,PO-${Math.floor(i / 100)},A,1`).join('\n');
  assert.equal(parseInboundImport(oversized, allowed).preview.valid, false);
  const app = appFor([a!.id], false);
  const preview = await post(app, '/preview', { csv }); assert.equal(preview.status, 200); assert.equal(preview.body.data.valid, true);
  assert.equal((await sql`select * from inbound_shipments`).length, 0, 'preview cannot write');
  assert.equal((await post(appFor([b!.id], false), '/preview', { csv })).body.data.valid, false);
  assert.equal((await post(appFor([a!.id], false, 'reader', []), '/preview', { csv })).status, 403);
  const input = { csv, fingerprint: preview.body.data.fingerprint, idempotencyKey: randomUUID() };
  const results = await Promise.all(Array.from({ length: 6 }, () => post(app, '', input)));
  assert.equal(results.filter(result => result.status === 201).length, 1); assert.equal(results.filter(result => result.status === 200).length, 5);
  for (const result of results) { assert.equal(result.body.data.created, 2); assert.equal(result.body.data.itemsCreated, 3); }
  assert.equal((await sql`select * from inbound_shipments`).length, 2);
  assert.equal((await sql`select * from inbound_items`).length, 3);
  assert.equal((await sql`select * from portal_inbound_create_requests`).length, 2);
  assert.equal((await sql`select * from client_portal_audit_logs where event='portal.inbound.import'`).length, 1);
  assert.equal((await post(app, '', input)).body.data.replayed, true, 'lost response safely replays');
  assert.equal((await post(app, '', { ...input, csv: csv + '\n' })).status, 409, 'original batch pinned');
  assert.equal((await post(appFor([b!.id], false), '', input)).status, 403, 'replay rechecks current scope');
  const [first] = await sql`select id from inbound_shipments order by id`;
  await sql`delete from inbound_shipments where id=${first!.id}`;
  assert.equal((await post(app, '', input)).status, 409, 'deleted import cannot be resurrected');
  const changed = { ...input, idempotencyKey: randomUUID(), fingerprint: '0'.repeat(64) };
  assert.equal((await post(app, '', changed)).status, 409);

  // A failing item insert must roll back every header, item and receipt in the batch.
  await sql.unsafe(`create or replace function import_fixture_fail() returns trigger language plpgsql as $$
    begin if NEW.sku='C' then raise exception 'fixture import failure'; end if; return NEW; end $$;
    create trigger import_fixture_failure before insert on inbound_items for each row execute function import_fixture_fail();`);
  const [before] = await sql`select count(*)::int as count from inbound_shipments`;
  const retry = { ...input, idempotencyKey: randomUUID() };
  assert.equal((await post(app, '', retry)).status, 500);
  assert.equal((await sql`select count(*)::int as count from inbound_shipments`)[0]!.count, before!.count);
  assert.equal((await sql`select * from portal_inbound_create_requests where request_key=${retry.idempotencyKey}`).length, 0);
  await sql.unsafe('drop trigger import_fixture_failure on inbound_items; drop function import_fixture_fail();');
  assert.equal((await post(app, '', retry)).status, 201); assert.equal((await post(app, '', retry)).status, 200);

  // A client name can resolve differently after preview; only the reviewed client may be committed.
  const globalApp = appFor();
  await sql`update clients set name='Renamed Alpha' where id=${a!.id}`;
  await sql`update clients set name='Import Alpha' where id=${b!.id}`;
  assert.equal((await post(globalApp, '', { ...input, idempotencyKey: randomUUID() })).status, 409);
  await sql`update clients set name='Import Beta' where id=${b!.id}`;
  await sql`update clients set name='Import Alpha' where id=${a!.id}`;
  const largeCsv = 'client,reference,sku,qty\n' + Array.from({ length: 501 }, (_, i) => `Import Alpha,CHUNK-${Math.floor(i / 200)},SKU-${i},1`).join('\n');
  const largePreview = await post(app, '/preview', { csv: largeCsv });
  const largeInput = { csv: largeCsv, fingerprint: largePreview.body.data.fingerprint, idempotencyKey: randomUUID() };
  const largeImport = await post(app, '', largeInput);
  assert.equal(largeImport.status, 201); assert.equal(largeImport.body.data.itemsCreated, 501); assert.equal(largeImport.body.data.created, 3);
  assert.equal((await post(app, '', largeInput)).body.data.itemsCreated, 501);
  console.log('PASS CSV syntax/row validation, scoped preview, atomic import, concurrent replay, altered retries, deletion and rollback');
} finally { globalThis.fetch = oldFetch; await sql.end({ timeout: 5 }); }
