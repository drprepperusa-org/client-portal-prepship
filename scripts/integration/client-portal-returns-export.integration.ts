import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { setupTestEnv } from './guard';
import { loadFixtureModule } from '../lib/load-fixture-module';
setupTestEnv();
const { sql } = await import('../../src/db/client');
const { registerReturnReadRoutes } = await import('../../src/routes/client-portal/returns/reads');
const owner = await import('../../src/routes/client-portal/returns/list');
const { exportPortalReturns, ReturnExportTooLarge } = await import('../../src/routes/client-portal/returns/export');
const { returnCsvHeader, returnCsvRow, RETURN_EXPORT_MAX_BYTES } = await import('../../src/lib/client-portal/return-csv');
const oldFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw Error('External requests blocked in Returns export fixtures'); }) as typeof fetch;
function appFor(clientIds: number[], storeIds: number[] = [], admin = false, register = registerReturnReadRoutes) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const actor = { userId: 'return-export-fixture', email: 'return-export@example.test',
      role: admin ? 'admin' : 'client_user', permissions: [], clientIds, storeIds };
    for (const [key, value] of Object.entries(actor)) c.set(key as never, value as never);
    await next();
  });
  register(app); return app;
}
function parseCsv(text: string) {
  const rows: string[][] = []; let row: string[] = [], value = '', quoted = false;
  for (let i = text.charCodeAt(0) === 0xFEFF ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(value); value = ''; }
    else if (c === '\r' && text[i + 1] === '\n' && !quoted) { row.push(value); rows.push(row); row = []; value = ''; i++; }
    else value += c;
  }
  assert.equal(quoted, false); return rows;
}
try {
  await sql`truncate returns, shipments, orders, clients restart identity cascade`;
  const [a,b]=await sql`insert into clients(name,store_ids) values ('Return Alpha',array[9901]),('Return Beta',array[9902]) returning id`;
  assert.ok(a&&b);
  const [oa,ob]=await sql`insert into orders(client_id,store_id,order_number,order_status,items,ship_to_name)
    values (${a.id},9901,'ALPHA','shipped','[]','PRIVATE-NAME'),(${b.id},9902,'BETA','shipped','[]','PRIVATE-BETA') returning id`;
  assert.ok(oa&&ob);
  const [shipment]=await sql`insert into shipments(order_id,client_id,is_return,label_tracking,tracking_status,delivered_at,
    carrier_code,service_code,label_url,cost)
    values (${oa.id},${a.id},true,'RETURN-TRACK','delivered','2026-09-02T00:00:00Z',
      'PRIVATE-CARRIER','PRIVATE-SERVICE','PRIVATE-LABEL',123.45) returning id`;
  assert.ok(shipment);
  await sql`insert into orders(client_id,store_id,order_number,order_status,items)
    select ${a.id},9901,'CSV-'||g,'shipped','[]' from generate_series(1,505) g`;
  await sql`insert into returns(order_id,client_id,return_reference,status,initiated_by,return_shipment_id,created_at)
    select id,client_id,order_number,'label_created','client',${shipment.id},
      '2026-09-01T00:00:00Z'::timestamptz + id * interval '1 minute' from orders where order_number like 'CSV-%'`;
  await sql`insert into return_items(return_id,order_id,sku,name,quantity)
    select id,order_id,'SKU-A','Widget, "Blue"',2 from returns`;
  await sql`insert into return_items(return_id,order_id,sku,name,quantity)
    select id,order_id,'SKU-B','Second item',1.5 from returns`;
  // Deliberately stale return.client_id must never grant access to the wrong order.
  await sql`insert into returns(order_id,client_id,return_reference,status,initiated_by,created_at)
    values (${ob.id},${a.id},'BETA-RETURN','requested','client','2026-09-01T00:00:00Z'),
      (${oa.id},${a.id},'START','requested','client','2026-09-01T00:00:00Z'),
      (${oa.id},${a.id},'END','closed','client','2026-09-01T23:59:59.999Z'),
      (${oa.id},${a.id},'OLD','closed','client','2026-08-31T23:59:59.999Z'),
      (${oa.id},${a.id},'FUTURE','closed','client','2026-09-02T00:00:00Z')`;
  const alpha=appFor([a.id]),beta=appFor([b.id]),store=appFor([],[9901]),admin=appFor([],[],true);
  const query='&search=CSV-&status=label_created&sortBy=returnReference&sortDir=asc';
  const response=await alpha.request('/returns?format=csv'+query+'&page=2&pageSize=1');
  assert.equal(response.status,200);assert.match(response.headers.get('content-type')!,/text\/csv/);
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.equal(response.headers.get('content-disposition'),'attachment; filename="returns.csv"');
  const text=await response.text(),csv=parseCsv(text);
  assert.equal(csv.length,506);assert.equal(new Set(csv.slice(1).map(row=>row[0])).size,505);
  assert.deepEqual(csv[0],['Return reference','Order #','Client','Item names','SKUs','Item quantities','Total quantity','Return status','Created (UTC)']);
  for(const hidden of ['PRIVATE-','BETA-RETURN','trackingUrl','customerShippingRate','123.45','delivered']) assert.ok(!text.includes(hidden));
  assert.deepEqual(csv[1]!.slice(3,8),['Widget, "Blue"\nSecond item','SKU-A\nSKU-B','2.000\n1.500','3.5','label_created']);
  const list=await (await alpha.request('/returns?'+query.slice(1)+'&pageSize=500')).json() as any;
  assert.deepEqual(csv.slice(1,501).map(row=>row[0]),list.data.map((row:any)=>row.returnReference));
  assert.equal(list.data[0].arrivedReadyToReceive,true,'arrival stays separate from lifecycle status');
  async function exported(app:Hono,query='') {
    const response=await app.request('/returns?format=csv'+query);assert.equal(response.status,200);
    return parseCsv(await response.text());
  }
  assert.equal((await exported(store,query)).length,506);
  assert.equal((await exported(beta))[1]![0],'BETA-RETURN','order owns scope even if return.client_id is stale');
  assert.equal((await exported(alpha,`&clientId=${b.id}`)).length,1);
  assert.equal((await exported(alpha,'&storeId=9902')).length,1);
  assert.equal((await exported(admin,`&clientId=${b.id}`)).length,2);
  assert.equal((await exported(admin,'&storeId=9902')).length,2);
  assert.equal((await exported(admin,`&clientId=${a.id}&storeId=9902`)).length,1);
  assert.equal((await exported(alpha,`&orderId=${ob.id}`)).length,1);
  assert.equal((await exported(alpha,`&orderId=${list.data[0].orderId}`+query)).length,2);
  assert.equal((await exported(alpha,'&search=RETURN-TRACK')).length,506);
  assert.ok((await exported(alpha,'&status=closed')).some(row=>row[0]==='END'));
  const dates='&dateFrom=2026-09-01T00:00:00.000Z&dateTo=2026-09-01T23:59:59.999Z';
  const dated=await exported(alpha,dates);
  assert.equal(dated.length,508,'505 returns plus inclusive created-date boundaries');
  assert.equal(dated.find(row=>row[0]==='START')![8],'2026-09-01T00:00:00.000Z');
  assert.equal(dated.find(row=>row[0]==='END')![8],'2026-09-01T23:59:59.999Z');
  for(const hidden of ['OLD','FUTURE','BETA-RETURN']) assert.ok(!dated.some(row=>row[0]===hidden));
  const datedList=await (await alpha.request('/returns?'+dates.slice(1))).json() as any;
  assert.equal(datedList.pagination.total,507,'list and export share date membership');
  for(const invalid of ['status=bad','dateFrom=bad','dateFrom=2026-09-02T00:00:00Z&dateTo=2026-09-01T00:00:00Z','clientId=no','storeId=-2','orderId=no']) {
    assert.equal((await alpha.request('/returns?format=csv&'+invalid)).status,400);
  }
  assert.equal((await appFor([]).request('/returns?format=csv')).status,403);
  assert.equal((await exported(alpha,'&search=missing')).length,1);
  const caller={userId:'return-export-fixture',clientIds:[a.id],storeIds:[],isGlobal:false,isRestricted:true,
    permissions:[],canViewFinancials:false,canViewCredentials:false};
  let observed=false;
  const snapshot=loadFixtureModule('src/routes/client-portal/returns/export.ts', {
    './list':{listPortalReturns:async(...args:Parameters<typeof owner.listPortalReturns>)=>{
      const result=await owner.listPortalReturns(...args);
      if(args[1].page===1){
        observed=true;
        await sql`update returns set status='closed' where return_reference='CSV-505'`;
        await sql`update return_items set quantity=9 where sku='SKU-A'`;
        const [newOrder]=await sql`insert into orders(client_id,store_id,order_number,order_status,items)
          values (${a.id},9901,'CSV-CONCURRENT','shipped','[]') returning id`;
        await sql`insert into returns(order_id,client_id,return_reference,status,initiated_by)
          values (${newOrder!.id},${a.id},'CSV-CONCURRENT','label_created','client')`;
      }
      return result;
    }},
  });
  const filters={search:'CSV-',status:'label_created',sortBy:'returnReference',sortDir:'asc'};
  const frozen=await snapshot.exportPortalReturns(caller,filters);
  assert.ok(observed);assert.equal(frozen.rows,505);assert.ok(!frozen.csv.includes('CSV-CONCURRENT'));
  assert.ok(parseCsv(frozen.csv).some(row=>row[0]==='CSV-505'&&row[6]==='3.5'&&row[7]==='label_created'));
  const fresh=await exportPortalReturns(caller,filters);
  assert.ok(fresh.csv.includes('CSV-CONCURRENT')&&!fresh.csv.includes('CSV-505'));
  assert.equal(parseCsv(fresh.csv).find(row=>row[0]==='CSV-1')![6],'10.5');
  const dto=list.data[0];
  for(const value of ['=1+1',' +cmd','-cmd','@SUM(A1)','\tvalue','\nvalue','Comma, quote " and\nline']) {
    const parsed=parseCsv(returnCsvHeader()+returnCsvRow({...dto,orderNumber:value},[]))[1]![1];
    assert.equal(parsed,value.startsWith('Comma')?value:"'"+value);
  }
  const oversized=loadFixtureModule('src/routes/client-portal/returns/export.ts', {
    './list':{listPortalReturns:async()=>({data:[{...dto,orderNumber:'x'.repeat(RETURN_EXPORT_MAX_BYTES)}],pagination:{total:1,totalPages:1}})},
  });
  await assert.rejects(oversized.exportPortalReturns(caller,{search:''}),/Too many bytes/);
  await sql`insert into returns(order_id,client_id,return_reference,status,initiated_by)
    select ${oa.id},${a.id},'LIMIT-'||g,'closed','client' from generate_series(1,10001) g`;
  assert.equal((await alpha.request('/returns?format=csv&search=LIMIT-')).status,413);
  const failedRoute=loadFixtureModule('src/routes/client-portal/returns/reads.ts', {
    './export':{ReturnExportTooLarge,exportPortalReturns:async()=>{throw Error('private SQL failure');}},
  });
  const unavailable=await appFor([a.id],[],false,failedRoute.registerReturnReadRoutes).request('/returns?format=csv');
  assert.equal(unavailable.status,503);assert.ok(!(await unavailable.text()).includes('private SQL'));
  console.log('PASS Returns CSV all pages, items, lifecycle, snapshot, scope, date bounds, limits and errors');
} finally {globalThis.fetch=oldFetch;await sql.end({timeout:5});}
