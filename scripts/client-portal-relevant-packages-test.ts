/** Real scoped rate-sheet route/read model on disposable in-memory PostgreSQL. */
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { Hono } from 'hono';
import { clients } from '../src/db/schema/clients';
import { packages } from '../src/db/schema/packages';
import { billingConfig, clientPackagePrices } from '../src/db/schema/billing';
import { loadFixtureModule } from './lib/load-fixture-module';

process.env.DATABASE_URL = 'postgres://fixture:fixture@127.0.0.1:1/relevant_packages';
process.env.SUPABASE_URL = 'https://fixture.supabase.co';
process.env.SUPABASE_ANON_KEY = 'fixture';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture';
process.env.SUPABASE_JWT_SECRET = 'fixture';
process.env.PREPSHIP_API_URL = 'https://packaging.fixture.test';
const { db, sql: networkSql } = await import('../src/db/client');
const { fetchRelevantClientPackageIds } = await import('../src/lib/client-portal/prepship-client-packages-proxy');
const memory = new PGlite();
const reader = drizzle(memory, { casing: 'snake_case' });
Object.assign(db, { select: reader.select.bind(reader) });
const rateSheetOwner = await import('../src/lib/client-portal/read-models/rate-sheet');
const route = loadFixtureModule('src/routes/client-portal/rate-sheet.ts', {
  '../../lib/client-portal/read-models/rate-sheet': rateSheetOwner,
  '../../lib/client-portal/audit': { recordPortalAudit: async () => {} },
}).default;
const originalFetch = globalThis.fetch;
let payload: unknown = { data: [{ packageId:11, unitCost:123 }, {packageId:12, marginPct:90}, {packageId:null,needsPackageCreation:true}] };
let responseStatus = 200;
const requested: number[] = [];
globalThis.fetch = (async (input, init) => {
  const url = new URL(String(input));
  assert.equal(url.origin, 'https://packaging.fixture.test');
  assert.equal(url.pathname, '/billing/package-prices');
  assert.equal(new Headers(init?.headers).get('authorization'),'Bearer fixture');
  assert.equal(new Headers(init?.headers).get('x-request-id'),'packaging-test');
  requested.push(Number(url.searchParams.get('clientId')));
  return Response.json(payload, {status:responseStatus});
}) as typeof fetch;
function appFor(ids: number[], financials = true, global = false) {
  const app = new Hono();
  app.use('*', async (c,next) => {
    const actor = { userId:'fixture',role:global?'admin':'client_user',email:'client@fixture.test',
      clientIds:ids,storeIds:[],permissions:financials?['financials:read']:[] };
    for (const [key,value] of Object.entries(actor)) c.set(key as never,value as never);
    await next();
  });
  app.route('/',route);return app;
}
const headers = {authorization:'Bearer fixture','x-request-id':'packaging-test'};
try {
  const dialect = new PgDialect({casing:'snake_case'});
  for (const table of [clients,packages,billingConfig,clientPackagePrices]) {
    const columns = Object.values(getTableColumns(table)).map(column => `"${dialect.casing.getColumnCasing(column)}" ${column.getSQLType()}`);
    await memory.exec(`create table "${getTableName(table)}" (${columns.join(',')})`);
  }
  await memory.exec(`
    insert into clients(id,name,active,store_ids) values (1,'Heritage',true,'{}'),(2,'Other client',true,'{}');
    insert into billing_config(client_id,active,pick_pack_fee,pick_pack_max_units,additional_unit_fee,storage_fee_per_cu_ft,updated_at)
      values (1,true,2.50,1,0.50,0.1234,'2026-11-06'),(2,true,9.99,1,0,0,'2026-11-06');
    insert into packages(id,name,source,length,width,height) values
      (11,'Used free box','custom',8,8,2),(12,'Configured box','custom',10,11,1),(13,'Unused catalog box','custom',20,20,20);
    insert into client_package_prices(client_id,package_id,price,updated_at) values
      (1,11,0,'2026-11-06'),(1,12,0.20,'2026-11-06'),(1,13,0,'2026-11-06'),(2,12,9.99,'2026-11-06');
  `);
  const app = appFor([1]);
  const response = await app.request('/rate-sheet',{headers});
  assert.equal(response.status,200,await response.clone().text());
  const body = await response.json();
  assert.equal(body.data.length,1);
  assert.equal(body.data[0].services.storageFeePerCuFt,'0.1234');
  assert.deepEqual(body.data[0].packages.map((p:any)=>[p.packageId,p.configuredPrice]),[[12,'0.20'],[11,'0.00']]);
  assert.ok(!JSON.stringify(body).match(/unitCost|marginPct|Other client|Unused catalog/));
  assert.deepEqual(requested,[1]);
  assert.deepEqual(await (await app.request('/rate-sheet?clientId=2',{headers})).json(),{data:[]});
  assert.deepEqual(requested,[1], 'client cannot request another client upstream');
  assert.equal((await appFor([1],false).request('/rate-sheet',{headers})).status,403);
  assert.equal((await appFor([]).request('/rate-sheet',{headers})).status,403);
  assert.equal((await app.request('/rate-sheet')).status,401);
  const second = await (await appFor([2]).request('/rate-sheet',{headers})).json();
  assert.deepEqual(second.data[0].packages.map((p:any)=>[p.packageId,p.configuredPrice]),[[12,'9.99']]);
  const admin = await (await appFor([],true,true).request('/rate-sheet',{headers})).json();
  assert.equal(admin.data.length,2);
  responseStatus=503;
  assert.equal((await app.request('/rate-sheet',{headers})).status,503);
  responseStatus=200;
  for (const malformed of [{}, {data:[{}]}, {data:[{packageId:-1}]}, {data:[{packageId:11},{packageId:11}]}, {data:[{packageId:null}]}]) {
    payload=malformed;
    await assert.rejects(fetchRelevantClientPackageIds(1,'Bearer fixture','packaging-test'));
  }
  payload={data:[]};
  assert.deepEqual((await (await app.request('/rate-sheet',{headers})).json()).data[0].packages,[]);
  console.log('PASS relevant packages: scoped SQL, used free boxes, exact saved prices, redaction, auth forwarding, malformed/unavailable fail closed');
} finally {
  globalThis.fetch=originalFetch;
  await memory.close();
  await networkSql.end({timeout:1});
}
