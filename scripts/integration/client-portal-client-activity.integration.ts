import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { setupTestEnv } from './guard';
setupTestEnv();
const { sql } = await import('../../src/db/client');
const { readClientActivity } = await import('../../src/lib/client-portal/read-models/client-activity');
const { default: summaryRoute } = await import('../../src/routes/client-portal/client-activity');
const { default: auditRoute } = await import('../../src/routes/client-portal/audit-log');
const now = new Date('2026-09-22T12:00:00.000Z');
const actor = 'activity-fixture';
let clientIds: number[] = [];
function appFor(admin: boolean) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const scope = { userId: actor, email: 'activity@example.test', role: admin ? 'admin' : 'client_user',
      permissions: [], clientIds: admin ? [] : clientIds.slice(0, 1), storeIds: [] };
    for (const [key,value] of Object.entries(scope)) c.set(key as never,value as never);
    await next();
  });
  app.route('/',summaryRoute); app.route('/',auditRoute); return app;
}
async function event(event: string, metadata = {}, scope: number[] = [], stores: number[] = [], at = '2026-09-20T12:00:00Z') {
  const [row] = await sql`insert into client_portal_audit_logs(event,actor_user_id,actor_email,client_ids,store_ids,metadata,created_at)
    values (${event},${actor},'client@example.test',${scope},${stores},${JSON.stringify(metadata)}::jsonb,${at}) returning id`;
  return row!.id as number;
}
try {
  const inserted = await sql`insert into clients(name,store_ids) values
    ('Activity Alpha',array[88101,88102]),('Activity Beta',array[88103]),('Activity Empty',array[]::int[]) returning id`;
  clientIds=inserted.map(row=>row.id); const [a,b,empty]=clientIds;
  assert.ok(a && b && empty);
  await sql`insert into clients(name) select 'Activity Page ' || lpad(n::text,2,'0') from generate_series(1,25) n`;
  clientIds=(await sql`select id from clients where name like 'Activity %'`).map(row=>row.id);
  const [order]=await sql`insert into orders(client_id,order_number) values (${a},'activity-order') returning id`;
  const [inventory]=await sql`insert into inventory(client_id,sku) values (${b},'activity-sku') returning id`;
  assert.ok(order && inventory);
  const requested=await event('portal.replacements.create.requested',{orderId:order.id,token:'do-not-show',raw:{secret:'never'}});
  const [storeOrder]=await sql`insert into orders(store_id,order_number) values (88103,'activity-store-order') returning id`;
  const [returnRow]=await sql`insert into returns(order_id,client_id,initiated_by) values (${order.id},${b},${actor}) returning id`;
  const [shipment]=await sql`insert into shipments(order_id,client_id) values (${order.id},${b}) returning id`;
  assert.ok(storeOrder && returnRow && shipment);
  const extraBeta = [
    await event('portal.orders.detail',{orderId:storeOrder.id}),
    await event('portal.returns.detail',{returnId:returnRow.id}),
    await event('portal.shipments.list',{shipmentId:shipment.id}),
    await event('portal.orders.list',{clientIds:[b,b]}),
    await event('portal.orders.list',{storeIds:[88103]}),
  ];
  const resource=await event('portal.inventory.update',{inventoryId:inventory.id});
  const explicit=await event('portal.orders.list',{clientId:b},[a]);
  const single=await event('portal.ui.click',{target:'Inventory',to:'/inventory'},[a]);
  const singleStore=await event('portal.ui.click',{target:'Orders'},[],[88103]);
  await event('portal.ui.click',{target:'Global'},[a,b],[88101,88103]);
  await event('portal.me.view',{},[a],[],'2026-09-22T11:00:00Z');
  await event('portal.orders.awaiting_active_count',{},[a],[],'2026-09-22T11:30:00Z');
  const old=await event('portal.inventory.receive.failed',{clientId:a},[],[],'2026-08-01T12:00:00Z');
  const boundary=await event('portal.inventory.receive.failed',{clientId:a},[],[],now.toISOString());
  const denied=await event('portal.orders.denied',{clientId:a});
  await sql`insert into client_portal_audit_logs(event,actor_user_id,actor_email,metadata,created_at)
    select 'portal.inventory.receive.failed',${actor},'client@example.test',jsonb_build_object('clientId',${a}::int),
      '2026-09-21T12:00:00Z'::timestamptz from generate_series(1,125)`;
  for (const metadata of [{clientId:'99999999999999999999999'},{clientId:2147483648},{clientIds:[-1,'x',null,{},999999999999]},
    {clientIds:'wrong'}, {clientId:0}, {clientId:''}, {clientId:null,orderId:'bad'}]) {
    await event('portal.orders.failed',metadata,[a]);
  }
  const summary=await readClientActivity({search:'Activity ',page:1,days:30},now);
  assert.equal(summary.pagination.hasMore,true); assert.equal(summary.data.length,25);
  const alpha=summary.data.find(row=>row.clientId===a)!; const beta=summary.data.find(row=>row.clientId===b)!;
  assert.equal(alpha.failedCount,125,'counts span all audit pages'); assert.equal(alpha.deniedCount,1);
  assert.equal(alpha.latestEvent?.activity.outcome,'Failed');
  assert.equal(alpha.recentActions.length,3); assert.ok(alpha.recentActions[0]!.id>alpha.recentActions[1]!.id,'same-clock events sort by id');
  assert.equal(beta.failedCount,0); assert.equal(beta.recentActions.length,2);
  assert.equal(summary.data.find(row=>row.clientId===empty)!.latestEvent,null);
  assert.ok(!JSON.stringify(summary).includes('do-not-show')); assert.ok(!JSON.stringify(summary).includes('metadata'));
  const more=await readClientActivity({search:'Activity ',page:2,days:30},now);
  assert.equal(more.data.length,3); assert.equal(more.pagination.hasMore,false);
  const admin=appFor(true), client=appFor(false);
  const params=new URLSearchParams({clientId:String(a),...{dateFrom:summary.window.dateFrom,dateTo:summary.window.dateTo},hideBackground:'true',limit:'250'});
  const response=await admin.request(`/audit-log?${params}`); assert.equal(response.status,200,await response.clone().text());
  const listed=await response.json() as any; const ids=listed.data.map((row:any)=>row.id);
  assert.equal(ids.length,128); assert.ok(ids.includes(requested) && ids.includes(single) && ids.includes(denied));
  for(const id of [resource,explicit,singleStore,old,boundary]) assert.ok(!ids.includes(id));
  const betaResponse=await admin.request(`/audit-log?${new URLSearchParams({...Object.fromEntries(params),clientId:String(b)})}`);
  const betaIds=((await betaResponse.json()) as any).data.map((row:any)=>row.id);
  assert.ok(extraBeta.every(id=>betaIds.includes(id)));
  assert.ok(extraBeta.every(id=>!ids.includes(id)),'resource client overrides parent order client');
  assert.equal(betaIds.length,8,'explicit arrays do not duplicate an event');
  const longWindow=await readClientActivity({search:'Activity Alpha',page:1,days:90},now);
  assert.equal(longWindow.data[0]!.failedCount,126,'older failures belong only to the larger window');
  const csv=await admin.request(`/audit-log?${params}&format=csv`); assert.equal(csv.status,200);
  assert.ok(!(await csv.text()).includes('do-not-show'));
  assert.equal((await client.request('/audit-log/client-activity')).status,403);
  assert.equal((await client.request(`/audit-log?${params}`)).status,403);
  for(const suffix of ['?days=1','?days=365','?page=0','?page=x','?search='+ 'x'.repeat(121)]) {
    assert.equal((await admin.request('/audit-log/client-activity'+suffix)).status,400);
  }
  for(const value of ['0','x','-1','2147483648']) assert.equal((await admin.request('/audit-log?clientId='+value)).status,400);
  const live=await admin.request('/audit-log/client-activity?search=Activity');
  assert.equal(live.status,200); assert.equal(live.headers.get('cache-control'),'private, no-store');
  await sql`alter table client_portal_audit_logs rename to activity_unavailable`;
  try {
    const failure=await admin.request('/audit-log/client-activity'); assert.equal(failure.status,503);
    assert.deepEqual(await failure.json(),{error:'Client activity is temporarily unavailable'});
  } finally { await sql`alter table activity_unavailable rename to client_portal_audit_logs`; }
  console.log('PASS client activity: real DB attribution, full counts, windows, pagination, redaction, admin access and failure state');
} finally {
  await sql`delete from client_portal_audit_logs where actor_user_id=${actor}`;
  if(clientIds.length) {
    await sql`delete from inventory where client_id in ${sql(clientIds)}`;
    await sql`delete from shipments where client_id in ${sql(clientIds)}`;
    await sql`delete from orders where client_id in ${sql(clientIds)} or order_number='activity-store-order'`;
    await sql`delete from clients where id in ${sql(clientIds)}`;
  }
  await sql.end({timeout:5});
}
