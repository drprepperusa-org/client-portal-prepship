// Real Hono routes + PostgreSQL, with every provider/storage request blocked.
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { setupTestEnv } from './guard';

const testUrl = new URL(process.env.TEST_DATABASE_URL ?? 'http://invalid');
assert(['127.0.0.1', 'localhost'].includes(testUrl.hostname), 'local throwaway database only');
setupTestEnv();
let networkCalls = 0;
globalThis.fetch = (async () => { networkCalls++; throw new Error('Unexpected external network request'); }) as typeof fetch;
const { db, sql: pg } = await import('../../src/db/client');
const schema = await import('../../src/db/schema/index');
const { registerReturnActionRoutes } = await import('../../src/routes/client-portal/returns/actions');
const { getPortalOrder, listPortalOrders } = await import('../../src/lib/client-portal/read-models/orders');
const { getClientStoreScope } = await import('../../src/lib/client-store-scope');

function appFor(clientId: number) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId' as never, 'ps486-test' as never);
    c.set('email' as never, 'ps486@example.test' as never);
    c.set('role' as never, 'client_user' as never);
    c.set('permissions' as never, [] as never);
    c.set('clientIds' as never, [clientId] as never);
    c.set('storeIds' as never, [] as never);
    await next();
  });
  registerReturnActionRoutes(app);
  return app;
}
let checks = 0;
function check(actual: unknown, expected: unknown, name: string) {
  assert.deepEqual(actual, expected, name); checks++; console.log('PASS '+name);
}
async function counts(orderId: number) {
  const result = await db.execute(sql`select
    (select count(*)::int from returns where order_id=${orderId}) as headers,
    (select count(*)::int from return_items where order_id=${orderId}) as items`);
  return result[0];
}
try {
  await db.execute(sql`truncate table returns, shipments, order_items, orders, clients restart identity cascade`);
  const [client] = await db.insert(schema.clients).values({ name:'PS486 Test', isTest:false }).returning();
  const [other] = await db.insert(schema.clients).values({ name:'Other Test', isTest:false }).returning();
  const clientId=client!.id;
  const app=appFor(clientId);
  const scope={ ...getClientStoreScope({ role:'client_user', permissions:[], clientIds:[clientId], storeIds:[] }),
    userId:'ps486-test', email:'ps486@example.test', role:'client_user', permissions:[], canViewFinancials:false, canViewCredentials:false };
  async function seed(status:string, labels:Array<{voided:boolean; isReturn?:boolean; delivered?:boolean}> = []) {
    const [o]=await db.insert(schema.orders).values({ clientId, orderNumber:'PS486-'+Math.random().toString(36).slice(2), orderStatus:status,
      externallyShipped:status==='shipped', raw:{externallyFulfilled:false} }).returning();
    await db.insert(schema.orderItems).values({ orderId:o!.id, clientId, orderStatus:status, sku:'GEL', name:'Gel', quantity:'2', unitPrice:'1', lineTotal:'2' });
    for(const label of labels) await db.insert(schema.shipments).values({ orderId:o!.id,clientId,orderNumber:o!.orderNumber,
      voided:label.voided,isReturn:label.isReturn??false,trackingStatus:label.delivered?'delivered':null,cost:'9.50' });
    return o!;
  }
  const post=(id:number, target=app)=>target.request('/returns',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    orderId:id,reason:'Fixture return',items:[{sku:'GEL',quantity:1}],returnEligibility:{allowed:true},
  })});
  const original=await seed('shipped',[{voided:true}]);
  const detail=await getPortalOrder(scope,original.id);
  check(detail?.fulfillmentStatus,'voided','#1298-shaped detail status');
  check(detail?.returnEligibility.allowed,false,'voided-only detail denies return');
  const list=await listPortalOrders(scope,{page:1,pageSize:50,search:original.orderNumber!});
  check(list.data[0]?.fulfillmentStatus,detail?.fulfillmentStatus,'list/detail use identical shipment truth');
  check((await post(original.id)).status,409,'voided-only API rejects forged client eligibility');
  check(await counts(original.id),{headers:0,items:0},'denied request writes no return records');
  await db.insert(schema.shipments).values({orderId:original.id,clientId,voided:false,isReturn:true});
  check((await getPortalOrder(scope,original.id))?.fulfillmentStatus,'voided','inbound return label cannot override voided outbound');
  check((await post(original.id)).status,409,'return-only active label cannot unlock creation');
  await db.insert(schema.shipments).values({orderId:original.id,clientId,voided:false,isReturn:false});
  check((await getPortalOrder(scope,original.id))?.returnEligibility.allowed,true,'active replacement permits request');
  check((await post(original.id)).status,201,'active replacement creates request');
  check(await counts(original.id),{headers:1,items:1},'allowed header and items persisted together');
  check((await post(original.id)).status,409,'duplicate guard preserved');

  for(const status of ['cancelled','awaiting_shipment','on_hold']) {
    const o=await seed(status,status==='cancelled'?[{voided:false,delivered:true}]:[]);
    check((await post(o.id)).status,409,status+' creation blocked');
    check(await counts(o.id),{headers:0,items:0},status+' has no return writes');
  }
  const delivered=await seed('shipped',[{voided:false,delivered:true}]);
  check((await getPortalOrder(scope,delivered.id))?.fulfillmentStatus,'delivered','delivered status retained');
  check((await post(delivered.id)).status,201,'delivered request remains available');
  const external=await seed('shipped');
  check((await post(external.id)).status,201,'existing external shipped-without-label workflow retained');

  const stale=await seed('shipped',[{voided:false}]);
  check((await getPortalOrder(scope,stale.id))?.returnEligibility.allowed,true,'old page initially eligible');
  await db.update(schema.shipments).set({voided:true}).where(eq(schema.shipments.orderId,stale.id));
  check((await post(stale.id)).status,409,'create rechecks newer void despite stale page');
  const scoped=await seed('shipped',[{voided:false}]);
  check((await post(scoped.id,appFor(other!.id))).status,404,'other client cannot create return');
  check(await counts(scoped.id),{headers:0,items:0},'cross-client rejection writes nothing');

  const foreign=await seed('awaiting_shipment');
  await db.insert(schema.shipments).values({orderId:null,orderNumber:foreign.orderNumber,clientId:other!.id,voided:false,isReturn:false});
  check((await getPortalOrder(scope,foreign.id))?.fulfillmentStatus,'pending','foreign orphan cannot supply fulfillment');
  check((await post(foreign.id)).status,409,'foreign orphan cannot grant return');
  const ownOrphan=await seed('awaiting_shipment');
  await db.insert(schema.shipments).values({orderId:null,orderNumber:ownOrphan.orderNumber,clientId,voided:false,isReturn:false});
  check((await post(ownOrphan.id)).status,201,'same-client outbound orphan compatibility retained');
  check(networkCalls,0,'no provider, storage, postage or external calls');
  console.log(`PASS ${checks} PS486 PostgreSQL route/read-model checks`);
} finally { await pg.end({timeout:5}); }
