import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { setupTestEnv } from './guard';
import { loadFixtureModule } from '../lib/load-fixture-module';
setupTestEnv();
const { sql } = await import('../../src/db/client');
const { default: route } = await import('../../src/routes/client-portal/inventory');
const owner = await import('../../src/lib/client-portal/read-models/inventory');
const { exportPortalInventory, InventoryExportTooLarge } = await import('../../src/lib/client-portal/read-models/inventory-export');
const { inventoryCsvHeader, inventoryCsvRow, INVENTORY_EXPORT_MAX_BYTES } = await import('../../src/lib/client-portal/inventory-csv');
const oldFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw Error('External requests blocked in Inventory export fixtures'); }) as typeof fetch;
function appFor(clientIds: number[], storeIds: number[] = [], admin = false) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const actor = { userId: 'inventory-export-fixture', email: 'inventory-export@example.test',
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
  await sql`truncate inventory, clients restart identity cascade`;
  const [a, b] = await sql`insert into clients(name, active, store_ids)
    values ('Inventory Alpha', true, array[8801]), ('Inventory Beta', true, array[8802]) returning id`;
  assert.ok(a && b);
  await sql`insert into inventory(client_id, sku, name, reorder_level)
    select ${a.id}, 'CSV-' || g, 'Fixture SKU ' || g, 10 from generate_series(1,505) g`;
  await sql`insert into inventory(client_id, sku, name, reorder_level, active)
    values (${b.id}, 'PRIVATE-BETA', 'Other client', 5, true),
      (${a.id}, 'INACTIVE', 'Hidden', 10, false), (null, 'ORPHAN', 'Hidden', 10, true)`;
  await sql`insert into inventory_ledger(inventory_id, client_id, sku, type, qty,
    effective_at, created_by, idempotency_key, source_entity, source_id)
    select id, client_id, sku, 'receive', 7, now(), 'fixture', 'receive-'||id, 'fixture', 'receive-'||id
    from inventory where client_id=${a.id} and active=true`;
  await sql`insert into inventory_ledger(inventory_id, client_id, sku, type, qty,
    effective_at, created_by, idempotency_key, source_entity, source_id)
    select id, client_id, sku, 'ship', -10, now(), 'fixture', 'ship-'||id, 'fixture', 'ship-'||id
    from inventory where sku='CSV-505'`;
  const specialName = 'Comma, quote " and\nline';
  await sql`update inventory set name=${specialName} where sku='CSV-1'`;
  const alpha=appFor([a.id]), beta=appFor([b.id]), store=appFor([],[8801]), admin=appFor([],[],true);
  const response=await alpha.request('/inventory?format=csv&sortBy=sku&sortDir=asc&page=2&pageSize=1');
  assert.equal(response.status,200);assert.match(response.headers.get('content-type')!,/text\/csv/);
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.equal(response.headers.get('content-disposition'),'attachment; filename="inventory.csv"');
  const text=await response.text(), csv=parseCsv(text), header=csv[0]!;
  assert.equal(csv.length,506,'all 505 SKUs beyond both page boundaries');
  assert.equal(new Set(csv.slice(1).map(row=>row[0])).size,505);
  for(const hidden of ['PRIVATE-BETA','INACTIVE','ORPHAN','client_id','store_ids','image_url']) assert.ok(!text.includes(hidden));
  const list=await (await alpha.request('/inventory?sortBy=sku&sortDir=asc&pageSize=500')).json() as any;
  assert.deepEqual(csv.slice(1,501).map(row=>Number(row[0])),list.data.map((row:any)=>row.id));
  assert.equal(csv[1]![2],specialName);
  assert.equal(csv[1]![header.indexOf('Current quantity')],'7');
  assert.equal(csv[1]![header.indexOf('Stock status')],'Low stock');
  assert.equal(csv[1]![header.indexOf('Reorder level')],'10');
  const last=csv.find(row=>row[1]==='CSV-505')!;
  assert.equal(last[header.indexOf('Current quantity')],'-3','negative numeric stock remains numeric');
  assert.equal(last[header.indexOf('Warehouse shipped (30 days)')],'10');
  assert.equal(last[header.indexOf('Stock status')],'Out of stock');
  async function exported(app:Hono,query='') {return parseCsv(await (await app.request('/inventory?format=csv'+query)).text());}
  assert.equal((await exported(store)).length,506);
  assert.equal((await exported(beta)).length,2);
  assert.equal((await exported(alpha,`&clientId=${b.id}`)).length,1);
  assert.equal((await exported(alpha,'&storeId=8802')).length,1);
  assert.equal((await exported(admin,`&clientId=${b.id}`)).length,2);
  assert.equal((await exported(admin,'&storeId=8802')).length,2);
  assert.equal((await exported(admin,`&clientId=${a.id}&storeId=8802`)).length,1);
  assert.equal((await exported(alpha,'&search=SKU%20504')).length,2,'name search');
  assert.equal((await exported(alpha,'&search=CSV-505&lowStock=1')).length,2);
  assert.equal((await exported(alpha,'&search=missing')).length,1,'empty scope returns only headers');
  for(const invalid of ['format=bad','clientId=no','storeId=-2','lowStock=maybe']) {
    assert.equal((await alpha.request('/inventory?'+invalid)).status,400);
  }
  assert.equal((await appFor([]).request('/inventory?format=csv')).status,403);
  const caller={userId:'inventory-export-fixture',clientIds:[a.id],storeIds:[],isGlobal:false,isRestricted:true,
    permissions:[],canViewFinancials:false,canViewCredentials:false};
  let observed=false;
  const snapshot=loadFixtureModule('src/lib/client-portal/read-models/inventory-export.ts', {
    './inventory':{listPortalInventory:async(...args:Parameters<typeof owner.listPortalInventory>)=>{
      const result=await owner.listPortalInventory(...args);
      if(args[1].page===1){
        observed=true;
        await sql`insert into inventory_ledger(inventory_id,client_id,sku,type,qty,
          effective_at,created_by,idempotency_key,source_entity,source_id)
          select id,client_id,sku,'receive',20,now(),'fixture','concurrent-'||id,'fixture','concurrent-'||id
          from inventory where sku='CSV-505'`;
      }
      return result;
    }},
  });
  const frozen=await snapshot.exportPortalInventory(caller,{search:'',lowStock:true,sortBy:'sku',sortDir:'asc'});
  assert.ok(observed);assert.equal(frozen.rows,505);
  assert.equal(parseCsv(frozen.csv).find(row=>row[1]==='CSV-505')![header.indexOf('Current quantity')],'-3');
  assert.equal((await exportPortalInventory(caller,{search:'',lowStock:true})).rows,504,'new exports reflect committed ledger changes');
  const dto=list.data[0];
  for(const text of ['=1+1',' +cmd','-cmd','@SUM(A1)','\tvalue','\nvalue']) {
    assert.equal(parseCsv(inventoryCsvHeader()+inventoryCsvRow({...dto,sku:text}))[1]![1],"'"+text);
  }
  const oversized=loadFixtureModule('src/lib/client-portal/read-models/inventory-export.ts', {
    './inventory':{listPortalInventory:async()=>({data:[{...dto,name:'x'.repeat(INVENTORY_EXPORT_MAX_BYTES)}],
      pagination:{total:1,totalPages:1}})},
  });
  await assert.rejects(oversized.exportPortalInventory(caller,{search:'',lowStock:false}),/Too many bytes/);
  await sql`insert into inventory(client_id,sku) select ${a.id},'LIMIT-'||g from generate_series(1,10001) g`;
  assert.equal((await alpha.request('/inventory?format=csv&search=LIMIT-')).status,413);
  const failedRoute=loadFixtureModule('src/routes/client-portal/inventory.ts', {
    '../../lib/client-portal/read-models/inventory-export':{InventoryExportTooLarge,
      exportPortalInventory:async()=>{throw Error('private SQL failure');}},
  }).default;
  const failed=new Hono();
  failed.use('*',async(c,next)=>{c.set('clientIds' as never,[a.id] as never);await next();});failed.route('/',failedRoute);
  const unavailable=await failed.request('/inventory?format=csv');
  assert.equal(unavailable.status,503);assert.ok(!(await unavailable.text()).includes('private SQL'));
  console.log('PASS Inventory CSV all pages, ledger snapshot, filters, scope, stock status, escaping, limits and failures');
} finally {globalThis.fetch=oldFetch;await sql.end({timeout:5});}
