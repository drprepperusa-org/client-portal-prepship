import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { setupTestEnv } from './guard';
import { loadFixtureModule } from '../lib/load-fixture-module';
setupTestEnv();
const { sql } = await import('../../src/db/client');
const { default: route } = await import('../../src/routes/client-portal/shipments');
const owner = await import('../../src/lib/client-portal/read-models/shipments');
const { exportPortalShipments, ShipmentExportTooLarge } = await import('../../src/lib/client-portal/read-models/shipment-export');
const { shipmentCsvHeader, shipmentCsvRow, SHIPMENT_EXPORT_MAX_BYTES } = await import('../../src/lib/client-portal/shipment-csv');
const oldFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw Error('External requests blocked in Shipments export fixtures'); }) as typeof fetch;
function appFor(clientIds: number[], storeIds: number[] = [], admin = false) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const actor = { userId: 'shipment-export-fixture', email: 'shipment-export@example.test',
      role: admin ? 'admin' : 'client_user', permissions: [], clientIds, storeIds };
    for (const [key, value] of Object.entries(actor)) c.set(key as never, value as never);
    await next();
  });
  app.route('/', route); return app;
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
  await sql`truncate shipments, orders, clients restart identity cascade`;
  const [a,b]=await sql`insert into clients(name,store_ids) values ('Ship Alpha',array[9901]),('Ship Beta',array[9902]) returning id`;
  assert.ok(a&&b);
  const [oa,ob,pending]=await sql`insert into orders(client_id,store_id,order_number,order_status,items)
    values (${a.id},9901,'ALPHA','shipped','[]'),(${b.id},9902,'BETA','shipped','[]'),
      (${a.id},9901,'PENDING','awaiting_shipment','[]') returning id`;
  assert.ok(oa&&ob&&pending);
  await sql`insert into shipments(order_id,client_id,order_number,label_tracking,tracking_number,ship_date,
    tracking_status,carrier_code,service_code,label_url,cost)
    select ${oa.id},${a.id},'CSV-'||g,'CANON-'||g,'LEGACY-'||g,
      '2026-09-01T00:00:00Z'::timestamptz + g * interval '1 minute',
      'exception','PRIVATE-CARRIER','PRIVATE-SERVICE','PRIVATE-LABEL',123.45 from generate_series(1,505) g`;
  await sql`insert into shipments(order_id,client_id,order_number,label_tracking,ship_date)
    values (${ob.id},${b.id},'PRIVATE-BETA','BETA-TRACK','2026-09-01T00:00:00Z'),
      (${pending.id},${a.id},'LABEL-ONLY','PENDING-TRACK','2026-09-01T00:00:00Z')`;
  await sql`insert into shipments(order_id,client_id,order_number,voided,is_return,source,ship_date)
    values (${oa.id},${a.id},'VOID',true,false,null,'2026-09-01T00:00:00Z'),
      (${oa.id},${a.id},'RETURN',false,true,null,'2026-09-01T00:00:00Z'),
      (${oa.id},${a.id},'REPLACE',false,false,'replacement','2026-09-01T00:00:00Z'),
      (null,null,'SEAuto-hidden',false,false,null,'2026-09-01T00:00:00Z')`;
  await sql`insert into shipments(order_id,client_id,order_number,label_ship_date,create_date)
    values (${oa.id},${a.id},'LABEL-DATE','2026-09-01T23:59:59.999Z','2026-08-01'),
      (${oa.id},${a.id},'CREATE-DATE',null,'2026-09-01T00:00:00Z'),
      (${oa.id},${a.id},'OLD',null,'2026-08-31T23:59:59.999Z'),
      (${oa.id},${a.id},'FUTURE',null,'2026-09-02T00:00:00Z'),
      (${oa.id},${a.id},'UNKNOWN-DATE',null,null)`;
  const alpha=appFor([a.id]),beta=appFor([b.id]),store=appFor([],[9901]),admin=appFor([],[],true);
  const query='&search=CSV-&status=shipped&sortBy=order&sortDir=asc';
  const response=await alpha.request('/shipments?format=csv'+query+'&page=2&pageSize=1');
  assert.equal(response.status,200);assert.match(response.headers.get('content-type')!,/text\/csv/);
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.equal(response.headers.get('content-disposition'),'attachment; filename="shipments.csv"');
  const text=await response.text(),csv=parseCsv(text),header=csv[0]!;
  assert.equal(csv.length,506);assert.equal(new Set(csv.slice(1).map(row=>row[0])).size,505);
  assert.deepEqual(header,['Shipment ID','Order #','Client','Tracking number','Ship date (UTC)','Status']);
  for(const hidden of ['PRIVATE-','LEGACY-','exception','trackingUrl','customerShippingRate','123.45']) assert.ok(!text.includes(hidden));
  assert.equal(csv[1]![3],'CANON-1');assert.equal(csv[1]![5],'shipped','fulfillment owner ignores carrier exception');
  const list=await (await alpha.request('/shipments?'+query.slice(1)+'&pageSize=500')).json() as any;
  assert.deepEqual(csv.slice(1,501).map(row=>Number(row[0])),list.data.map((row:any)=>row.id));
  async function exported(app:Hono,query='') {return parseCsv(await (await app.request('/shipments?format=csv'+query)).text());}
  assert.equal((await exported(store,query)).length,506);
  assert.equal((await exported(beta)).length,2);
  assert.equal((await exported(alpha,`&clientId=${b.id}`)).length,1);
  assert.equal((await exported(alpha,'&storeId=9902')).length,1);
  assert.equal((await exported(admin,`&clientId=${b.id}`)).length,2);
  assert.equal((await exported(admin,'&storeId=9902')).length,2);
  assert.equal((await exported(admin,`&clientId=${a.id}&storeId=9902`)).length,1);
  for(const q of ['&search=CANON-505','&search=LEGACY-505','&search=CSV-505']) assert.equal((await exported(alpha,q)).length,2);
  assert.equal((await exported(alpha,'&status=label_created'))[1]![1],'LABEL-ONLY');
  assert.equal((await exported(alpha,'&status=voided'))[1]![1],'VOID');
  assert.equal((await exported(alpha,'&status=delivered&search=CSV-')).length,506,'legacy status alias preserved');
  const all=await exported(alpha);
  for(const hidden of ['VOID','RETURN','REPLACE','SEAuto-hidden']) assert.ok(!all.some(row=>row[1]===hidden));
  const dates='&dateFrom=2026-09-01T00:00:00.000Z&dateTo=2026-09-01T23:59:59.999Z&status=shipped';
  const dated=await exported(alpha,dates);
  assert.equal(dated.length,508,'505 shipments plus inclusive label/create boundaries');
  assert.equal(dated.find(row=>row[1]==='LABEL-DATE')![4],'2026-09-01T23:59:59.999Z');
  assert.equal(dated.find(row=>row[1]==='CREATE-DATE')![4],'2026-09-01T00:00:00.000Z');
  for(const hidden of ['OLD','FUTURE','UNKNOWN-DATE']) assert.ok(!dated.some(row=>row[1]===hidden));
  const datedList=await (await alpha.request('/shipments?'+dates.slice(1))).json() as any;
  assert.equal(datedList.pagination.total,507,'list and export share date membership');
  for(const invalid of ['status=bad','dateFrom=bad','dateFrom=2026-09-02T00:00:00Z&dateTo=2026-09-01T00:00:00Z','clientId=no','storeId=-2']) {
    assert.equal((await alpha.request('/shipments?format=csv&'+invalid)).status,400);
  }
  assert.equal((await appFor([]).request('/shipments?format=csv')).status,403);
  assert.equal((await exported(alpha,'&search=missing')).length,1);
  const caller={userId:'shipment-export-fixture',clientIds:[a.id],storeIds:[],isGlobal:false,isRestricted:true,
    permissions:[],canViewFinancials:false,canViewCredentials:false};
  let observed=false;
  const snapshot=loadFixtureModule('src/lib/client-portal/read-models/shipment-export.ts', {
    './shipments':{listPortalShipments:async(...args:Parameters<typeof owner.listPortalShipments>)=>{
      const result=await owner.listPortalShipments(...args);
      if(args[1].page===1){
        observed=true;
        await sql`update shipments set voided=true where order_number='CSV-505'`;
        await sql`insert into shipments(order_id,client_id,order_number,label_tracking,ship_date)
          values (${oa.id},${a.id},'CSV-CONCURRENT','NEW-TRACK','2026-09-01T00:00:00Z')`;
      }
      return result;
    }},
  });
  const filters={search:'CSV-',status:'shipped' as const,sortBy:'order',sortDir:'asc'};
  const frozen=await snapshot.exportPortalShipments(caller,filters);
  assert.ok(observed);assert.equal(frozen.rows,505);assert.ok(!frozen.csv.includes('CSV-CONCURRENT'));
  assert.ok(parseCsv(frozen.csv).some(row=>row[1]==='CSV-505'&&row[5]==='shipped'));
  const fresh=await exportPortalShipments(caller,filters);
  assert.ok(fresh.csv.includes('CSV-CONCURRENT')&&!fresh.csv.includes('CSV-505'));
  const dto=list.data[0];
  for(const value of ['=1+1',' +cmd','-cmd','@SUM(A1)','\tvalue','\nvalue','Comma, quote " and\nline']) {
    const parsed=parseCsv(shipmentCsvHeader()+shipmentCsvRow({...dto,orderNumber:value}))[1]![1];
    assert.equal(parsed,value.startsWith('Comma')?value:"'"+value);
  }
  const oversized=loadFixtureModule('src/lib/client-portal/read-models/shipment-export.ts', {
    './shipments':{listPortalShipments:async()=>({data:[{...dto,orderNumber:'x'.repeat(SHIPMENT_EXPORT_MAX_BYTES)}],pagination:{total:1,totalPages:1}})},
  });
  await assert.rejects(oversized.exportPortalShipments(caller,{search:''}),/Too many bytes/);
  await sql`insert into shipments(order_id,client_id,order_number)
    select ${oa.id},${a.id},'LIMIT-'||g from generate_series(1,10001) g`;
  assert.equal((await alpha.request('/shipments?format=csv&search=LIMIT-')).status,413);
  const failedRoute=loadFixtureModule('src/routes/client-portal/shipments.ts', {
    '../../lib/client-portal/read-models/shipment-export':{ShipmentExportTooLarge,exportPortalShipments:async()=>{throw Error('private SQL failure');}},
  }).default;
  const failed=new Hono();failed.use('*',async(c,next)=>{c.set('clientIds' as never,[a.id] as never);await next();});failed.route('/',failedRoute);
  const unavailable=await failed.request('/shipments?format=csv');
  assert.equal(unavailable.status,503);assert.ok(!(await unavailable.text()).includes('private SQL'));
  console.log('PASS Shipments CSV all pages, canonical status/tracking/dates, snapshot, scope, exclusions, limits and errors');
} finally {globalThis.fetch=oldFetch;await sql.end({timeout:5});}
