import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { setupTestEnv } from './guard';
import { loadFixtureModule } from '../lib/load-fixture-module';
setupTestEnv();
const { sql } = await import('../../src/db/client');
const { default: route } = await import('../../src/routes/client-portal/inbound');
const owner = await import('../../src/lib/client-portal/read-models/inbound-receipts');
const { exportPortalInboundReceipts, InboundReceiptExportTooLarge } = await import('../../src/lib/client-portal/read-models/inbound-receipt-export');
const { inboundReceiptCsvHeader, inboundReceiptCsvRow, INBOUND_RECEIPT_EXPORT_MAX_BYTES } = await import('../../src/lib/client-portal/inbound-receipt-csv');
const oldFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw Error('External requests blocked in receiving-history export fixtures'); }) as typeof fetch;
function appFor(clientIds: number[], storeIds: number[] = [], admin = false, router = route) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const actor = { userId: 'receipt-export-fixture', email: 'receipt-export@example.test',
      role: admin ? 'admin' : 'client_user', permissions: [], clientIds, storeIds };
    for (const [key, value] of Object.entries(actor)) c.set(key as never, value as never);
    await next();
  });
  app.route('/', router); return app;
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
  await sql`truncate inventory, clients restart identity cascade`;
  const [a,b]=await sql`insert into clients(name,store_ids) values ('Receipt Alpha',array[6601]),('Receipt Beta',array[6602]) returning id`;
  assert.ok(a&&b);
  const [ia,ib]=await sql`insert into inventory(client_id,sku,name)
    values (${a.id},'SKU-A','Widget, "Blue"'),(${b.id},'PRIVATE-BETA','Other item') returning id`;
  assert.ok(ia&&ib);
  await sql`insert into inventory_ledger(inventory_id,client_id,sku,type,qty,effective_at,created_at,created_by,note,
    idempotency_key,source_entity,source_id)
    select ${ia.id},${a.id},'SKU-A','receive',g,'2026-09-01T00:00:00Z'::timestamptz + g * interval '1 minute',
      '2026-09-17T00:00:00Z','PRIVATE-OPERATOR','PRIVATE-NOTE','receive-'||g,'fixture','receive-'||g
    from generate_series(1,505) g`;
  await sql`insert into inventory_ledger(inventory_id,client_id,sku,type,qty,effective_at,created_at,created_by,
    idempotency_key,source_entity,source_id) values
    (${ib.id},${b.id},'PRIVATE-BETA','receive',900,'2026-09-01T00:00:00Z','2026-09-17T00:00:00Z','fixture','beta','fixture','beta'),
    (${ia.id},${a.id},'SKU-A','ship',-20,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z','fixture','ship','fixture','ship'),
    (${ia.id},${a.id},'SKU-A','adjust',12,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z','fixture','adjust','fixture','adjust'),
    (${ia.id},${a.id},'SKU-A','receive',601,null,'2026-09-01T00:00:00Z','fixture','start','fixture','start'),
    (${ia.id},${a.id},'SKU-A','receive',602,'2026-09-01T23:59:59.999Z','2026-09-17T00:00:00Z','fixture','end','fixture','end'),
    (${ia.id},${a.id},'SKU-A','receive',603,'2026-08-31T23:59:59.999Z','2026-09-01T00:00:00Z','fixture','old','fixture','old'),
    (${ia.id},${a.id},'SKU-A','receive',604,'2026-09-02T00:00:00Z','2026-09-01T00:00:00Z','fixture','future','fixture','future')`;
  // Historical receipts must stay visible even after an item becomes inactive.
  await sql`update inventory set active=false where id=${ia.id}`;
  const alpha=appFor([a.id]),beta=appFor([b.id]),store=appFor([],[6601]),admin=appFor([],[],true);
  const dates='&dateFrom=2026-09-01T00:00:00.000Z&dateTo=2026-09-01T23:59:59.999Z';
  const response=await alpha.request('/inbound/receipts?format=csv&sortBy=receipt&sortDir=asc&page=2&pageSize=1'+dates);
  assert.equal(response.status,200);assert.match(response.headers.get('content-type')!,/text\/csv/);
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.equal(response.headers.get('content-disposition'),'attachment; filename="inbound-receipts.csv"');
  const text=await response.text(),csv=parseCsv(text);
  assert.equal(csv.length,508,'all 507 dated receipts beyond both page boundaries');
  assert.equal(new Set(csv.slice(1).map(row=>row[0])).size,507);
  assert.deepEqual(csv[0],['Receipt ID','Client','SKU','Item name','Received quantity','Received date (UTC)']);
  for(const hidden of ['PRIVATE-','createdBy','sourceEntity','idempotencyKey','client_id','store_ids']) assert.ok(!text.includes(hidden));
  assert.deepEqual(csv[1]!.slice(1),['Receipt Alpha','SKU-A','Widget, "Blue"','1','2026-09-01T00:01:00.000Z']);
  const list=await (await alpha.request('/inbound/receipts?sortBy=receipt&sortDir=asc&pageSize=500'+dates)).json() as any;
  assert.deepEqual(csv.slice(1,501).map(row=>Number(row[0])),list.data.map((row:any)=>row.id));
  assert.equal(list.pagination.total,507,'table and export share received-date membership');
  async function exported(app:Hono,query='') {
    const response=await app.request('/inbound/receipts?format=csv'+query);assert.equal(response.status,200);
    return parseCsv(await response.text());
  }
  assert.equal((await exported(alpha)).length,510,'empty date filters retain full receipt history');
  assert.equal((await exported(store,dates)).length,508);
  assert.equal((await exported(beta)).length,2);
  assert.equal((await exported(alpha,`&clientId=${b.id}`)).length,1);
  assert.equal((await exported(alpha,'&storeId=6602')).length,1);
  assert.equal((await exported(admin,`&clientId=${b.id}`)).length,2);
  assert.equal((await exported(admin,'&storeId=6602')).length,2);
  assert.equal((await exported(admin,`&clientId=${a.id}&storeId=6602`)).length,1);
  assert.equal(csv.find(row=>row[4]==='601')![5],'2026-09-01T00:00:00.000Z','legacy receipt uses persistence clock');
  assert.equal(csv.find(row=>row[4]==='602')![5],'2026-09-01T23:59:59.999Z');
  for(const excluded of ['603','604','-20']) assert.ok(!csv.some(row=>row[4]===excluded));
  assert.equal((await exported(alpha,'&dateFrom=2026-09-02T00:00:00Z')).length,2,'open-ended start');
  assert.equal((await exported(alpha,'&dateTo=2026-08-31T23:59:59.999Z')).length,2,'open-ended end');
  assert.equal((await exported(alpha,'&dateFrom=2030-01-01T00:00:00Z')).length,1);
  for(const invalid of ['format=bad','dateFrom=bad','dateFrom=2026-09-02T00:00:00Z&dateTo=2026-09-01T00:00:00Z','clientId=no','storeId=-2']) {
    assert.equal((await alpha.request('/inbound/receipts?'+invalid)).status,400);
  }
  assert.equal((await appFor([]).request('/inbound/receipts?format=csv')).status,403);
  const caller={userId:'receipt-export-fixture',clientIds:[a.id],storeIds:[],isGlobal:false,isRestricted:true,
    permissions:[],canViewFinancials:false,canViewCredentials:false};
  let observed=false;
  const snapshot=loadFixtureModule('src/lib/client-portal/read-models/inbound-receipt-export.ts', {
    './inbound-receipts':{listPortalInboundReceipts:async(...args:Parameters<typeof owner.listPortalInboundReceipts>)=>{
      const result=await owner.listPortalInboundReceipts(...args);
      if(args[1].page===1){
        observed=true;
        await sql`insert into inventory_ledger(inventory_id,client_id,sku,type,qty,effective_at,created_by,
          idempotency_key,source_entity,source_id) values
          (${ia.id},${a.id},'SKU-A','receive',777,'2026-09-01T12:00:00Z','fixture','concurrent','fixture','concurrent')`;
      }
      return result;
    }},
  });
  const filters={dateFrom:'2026-09-01T00:00:00Z',dateTo:'2026-09-01T23:59:59.999Z',sortBy:'receipt',sortDir:'asc'};
  const frozen=await snapshot.exportPortalInboundReceipts(caller,filters);
  assert.ok(observed);assert.equal(frozen.rows,507);assert.ok(!parseCsv(frozen.csv).some(row=>row[4]==='777'));
  const fresh=await exportPortalInboundReceipts(caller,filters);
  assert.equal(fresh.rows,508);assert.ok(parseCsv(fresh.csv).some(row=>row[4]==='777'));
  const dto=list.data[0];
  for(const value of ['=1+1',' +cmd','-cmd','@SUM(A1)','\tvalue','\nvalue','Comma, quote " and\nline']) {
    const parsed=parseCsv(inboundReceiptCsvHeader()+inboundReceiptCsvRow({...dto,name:value}))[1]![3];
    assert.equal(parsed,value.startsWith('Comma')?value:"'"+value);
  }
  const oversized=loadFixtureModule('src/lib/client-portal/read-models/inbound-receipt-export.ts', {
    './inbound-receipts':{listPortalInboundReceipts:async()=>({data:[{...dto,name:'x'.repeat(INBOUND_RECEIPT_EXPORT_MAX_BYTES)}],pagination:{total:1,totalPages:1}})},
  });
  await assert.rejects(oversized.exportPortalInboundReceipts(caller,{}),/Too many bytes/);
  const [limitClient]=await sql`insert into clients(name) values ('Limit fixture') returning id`;
  const [limitItem]=await sql`insert into inventory(client_id,sku) values (${limitClient!.id},'LIMIT') returning id`;
  await sql`insert into inventory_ledger(inventory_id,client_id,sku,type,qty,effective_at,created_by,idempotency_key,source_entity,source_id)
    select ${limitItem!.id},${limitClient!.id},'LIMIT','receive',1,now(),'fixture','limit-'||g,'fixture','limit-'||g from generate_series(1,10001) g`;
  assert.equal((await appFor([limitClient!.id]).request('/inbound/receipts?format=csv')).status,413);
  const failedRoute=loadFixtureModule('src/routes/client-portal/inbound.ts', {
    '../../lib/client-portal/read-models/inbound-receipt-export':{InboundReceiptExportTooLarge,exportPortalInboundReceipts:async()=>{throw Error('private SQL failure');}},
  }).default;
  const unavailable=await appFor([a.id],[],false,failedRoute).request('/inbound/receipts?format=csv');
  assert.equal(unavailable.status,503);assert.ok(!(await unavailable.text()).includes('private SQL'));
  const [unchanged]=await sql`select count(*)::int as count from inventory_ledger where inventory_id=${ia.id}`;
  assert.equal(unchanged!.count,512,'exports never append movements; only the explicit fixture insert did');
  console.log('PASS Inbound CSV all pages, canonical quantities/clock, snapshot, scope, exclusions, date bounds, limits and errors');
} finally {globalThis.fetch=oldFetch;await sql.end({timeout:5});}
