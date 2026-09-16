import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { setupTestEnv } from './guard';
import type { PortalRateSheet } from '../../src/lib/client-portal/contracts/rate-sheet';

setupTestEnv();
const { sql } = await import('../../src/db/client');
const { default: routes } = await import('../../src/routes/client-portal/rate-sheet');
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw Error('Rate sheet fixtures block external requests'); }) as typeof fetch;
function appFor(clientIds: number[], financials = true, admin = false, storeIds: number[] = []) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const actor = { userId: 'rates-fixture', email: 'rates@example.test', role: admin ? 'admin' : 'client_user',
      permissions: financials ? ['financials:read'] : [], clientIds, storeIds };
    for (const [key,value] of Object.entries(actor)) c.set(key as never,value as never);
    await next();
  });
  app.route('/',routes); return app;
}
async function get(app: Hono, params = '') {
  const response = await app.request(`/rate-sheet?${params}`);
  assert.equal(response.status,200,await response.clone().text());
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  return (await response.json() as {data:PortalRateSheet[]}).data;
}
let clientIds: number[] = [], packageIds: number[] = [];
try {
  const [a,b,missing,inactive,zero] = await sql`insert into clients(name) values
    ('Rate Alpha'),('Rate Beta'),('Rate Missing'),('Rate Inactive'),('Rate Zero') returning id`;
  assert.ok(a && b && missing && inactive && zero);
  clientIds = [a.id,b.id,missing.id,inactive.id,zero.id];
  await sql`insert into billing_config(client_id,pick_pack_fee,pick_pack_max_units,additional_unit_fee,
    storage_fee_per_cu_ft,package_cost_markup,shipping_markup_pct,active,updated_at) values
    (${a.id},2.50,3,0.75,0.1234,20,99,true,'2026-09-01T12:00:00Z'),
    (${b.id},9.99,1,4.99,0.5000,30,80,true,'2026-09-02T12:00:00Z'),
    (${inactive.id},1.50,1,0,0.0001,0,0,false,'2026-09-03T12:00:00Z'),
    (${zero.id},0,1,0,0,0,0,true,'2026-09-04T12:00:00Z')`;
  const [box,provider] = await sql`insert into packages(name,source,length,width,height,unit_cost,carrier_code,package_code)
    values ('Rate Test Box','custom',7,4,2,0.07,'private-carrier','private-code'),
           ('Provider secret box','shipstation',8,5,3,0.99,'private-carrier','private-code') returning id`;
  assert.ok(box && provider); packageIds = [box.id,provider.id];
  await sql`insert into client_package_prices(client_id,package_id,price,updated_at) values
    (${a.id},${box.id},0.20,'2026-09-05T12:00:00Z'),(${b.id},${box.id},9.99,'2026-09-05T12:00:00Z'),
    (${a.id},${provider.id},999.99,'2026-09-05T12:00:00Z'),(${zero.id},${box.id},0,'2026-09-05T12:00:00Z')`;
  const alpha = appFor([a.id]), admin = appFor([],true,true);
  const [rate] = await get(alpha);
  assert.deepEqual(rate,{
    clientId:a.id,clientName:'Rate Alpha',configurationStatus:'configured',
    services:{pickPackFee:'2.50',includedUnits:3,additionalUnitFee:'0.75',storageFeePerCuFt:'0.1234',updatedAt:'2026-09-01T12:00:00.000Z'},
    packages:[{packageId:box.id,name:'Rate Test Box',dimensions:'7 × 4 × 2 in',configuredPrice:'0.20',updatedAt:'2026-09-05T12:00:00.000Z'}],
  },'exact allowlist uses saved customer configuration, not warehouse cost or a second markup formula');
  const absent=(await get(appFor([missing.id])))[0]!;
  assert.equal(absent.configurationStatus,'not_configured'); assert.equal(absent.services,null); assert.deepEqual(absent.packages,[]);
  const disabled=(await get(appFor([inactive.id])))[0]!;
  assert.equal(disabled.configurationStatus,'inactive'); assert.equal(disabled.services?.storageFeePerCuFt,'0.0001');
  const free=(await get(appFor([zero.id])))[0]!;
  assert.equal(free.configurationStatus,'configured'); assert.equal(free.services?.pickPackFee,'0.00');
  assert.equal(free.packages[0]?.configuredPrice,'0.00');
  assert.equal((await get(alpha,`clientId=${b.id}`)).length,0);
  assert.equal((await get(admin,`clientId=${b.id}`))[0]?.services?.pickPackFee,'9.99');
  assert.equal((await get(appFor([a.id,b.id]),`clientId=${a.id}`)).length,1);
  assert.equal((await get(appFor([],true,false,[7711]))).length,0);
  assert.equal((await appFor([]).request('/rate-sheet')).status,403);
  const denied=await appFor([a.id],false).request('/rate-sheet');
  assert.equal(denied.status,403); assert.ok(!(await denied.text()).includes('2.50'));
  for (const input of ['-1','abc','1.2','0','']) assert.equal((await alpha.request(`/rate-sheet?clientId=${input}`)).status,400);
  // Inject a DB failure in this guarded, disposable database; never report it as missing rates.
  await sql`alter table billing_config rename to rate_sheet_fixture_config`;
  try {
    const failure=await alpha.request('/rate-sheet'); assert.equal(failure.status,503);
    assert.deepEqual(await failure.json(),{error:'rate_sheet_unavailable'});
  } finally { await sql`alter table rate_sheet_fixture_config rename to billing_config`; }
  console.log('PASS Rate Sheet: exact saved values, precision, zero/missing/inactive, scope, financial permission, safe DTO and DB failure');
} finally {
  if(clientIds.length) {
    await sql`delete from client_package_prices where client_id in ${sql(clientIds)}`;
    await sql`delete from clients where id in ${sql(clientIds)}`;
  }
  if(packageIds.length) await sql`delete from packages where id in ${sql(packageIds)}`;
  await sql.end({timeout:5});globalThis.fetch=originalFetch;
}
