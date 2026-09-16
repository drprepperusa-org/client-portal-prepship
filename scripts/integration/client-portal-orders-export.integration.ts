import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { setupTestEnv } from './guard';
import { loadFixtureModule } from '../lib/load-fixture-module';
setupTestEnv();
const { sql } = await import('../../src/db/client');
const { default: route } = await import('../../src/routes/client-portal/orders');
const owner = await import('../../src/lib/client-portal/read-models/orders');
const { exportPortalOrders, OrderExportTooLarge } = await import('../../src/lib/client-portal/read-models/order-export');
const { orderCsvHeader, orderCsvRow, ORDER_EXPORT_MAX_BYTES } = await import('../../src/lib/client-portal/order-csv');
const oldFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw Error('External requests blocked in Orders export fixtures'); }) as typeof fetch;
function appFor(clientIds: number[], storeIds: number[] = [], financials = false, admin = false) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const actor = { userId: 'export-fixture', email: 'orders-export@example.test', role: admin ? 'admin' : 'client_user',
      permissions: financials ? ['financials:read'] : [], clientIds, storeIds };
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
  await sql`truncate orders, clients restart identity cascade`;
  const [a, b] = await sql`insert into clients(name, active, store_ids)
    values ('Export Alpha', true, array[8811]), ('Export Beta', true, array[8822]) returning id`;
  assert.ok(a && b);
  await sql`insert into orders(client_id, store_id, order_number, order_status, order_date, order_total, items, raw)
    select ${a.id}, 8811, 'CSV-' || g, 'awaiting_shipment',
      '2026-09-01'::timestamptz + g * interval '1 minute', 12.34, '[]'::jsonb,
      '{"private":"DO-NOT-EXPORT-RAW"}'::jsonb from generate_series(1, 505) g`;
  await sql`insert into orders(client_id, store_id, order_number, order_status, order_date, items)
    values (${a.id},8811,'SHIPPED-OLD','shipped','2026-07-01','[]'::jsonb),
      (${a.id},8811,'SHIPPED-END','shipped','2026-09-01T23:59:59.999Z','[]'::jsonb),
      (${b.id},8822,'PRIVATE-BETA','awaiting_shipment','2026-09-01','[]'::jsonb)`;
  const [itemOrder] = await sql`select id from orders where order_number='CSV-1'`;
  await sql`insert into order_items(order_id,client_id,store_id,sku,name,quantity,order_status,line_index)
    values (${itemOrder!.id},${a.id},8811,'=FORMULA','Comma, quote " and\nline',2,'awaiting_shipment',0),
      (${itemOrder!.id},${a.id},8811,'SKU-2','Second item',3,'awaiting_shipment',1)`;
  const alpha = appFor([a.id]), beta = appFor([b.id]), store = appFor([], [8811]);
  const response = await alpha.request('/orders?format=csv&status=awaiting_shipment&sortBy=order&sortDir=asc&page=2&pageSize=1');
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type')!, /text\/csv/);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const text = await response.text(), csv = parseCsv(text), header = csv[0]!;
  assert.equal(csv.length, 506, 'all 505 rows, beyond API and table page limits');
  assert.equal(new Set(csv.slice(1).map(row => row[0])).size, 505);
  assert.ok(!text.includes('PRIVATE-BETA') && !text.includes('DO-NOT-EXPORT-RAW'));
  assert.ok(!header.includes('Order total') && !header.includes('Weight (oz)'));
  const list = await (await alpha.request('/orders?status=awaiting_shipment&sortBy=order&sortDir=asc&pageSize=500')).json() as any;
  assert.deepEqual(csv.slice(1,501).map(row => Number(row[0])),list.data.map((row: any) => row.id));
  const first = csv.find(row => row[1] === 'CSV-1')!;
  assert.equal(first[header.indexOf('Ordered units')], '5');
  assert.equal(first[header.indexOf('SKUs')], "'=FORMULA\nSKU-2");
  assert.ok(first[header.indexOf('Item names')]!.includes('Comma, quote "'));
  assert.equal(parseCsv(await (await store.request('/orders?format=csv&status=awaiting_shipment')).text()).length,506);
  assert.equal(parseCsv(await (await beta.request('/orders?format=csv')).text()).length,2);
  assert.equal(parseCsv(await (await alpha.request(`/orders?format=csv&clientId=${b.id}`)).text()).length,1);
  assert.equal(parseCsv(await (await alpha.request('/orders?format=csv&storeId=8822')).text()).length,1);
  const date = '&dateFrom=2026-09-01T00:00:00.000Z&dateTo=2026-09-01T23:59:59.999Z';
  const dated = parseCsv(await (await alpha.request('/orders?format=csv&status=shipped'+date)).text());
  assert.equal(dated.length,2); assert.equal(dated[1]![1],'SHIPPED-END');
  const datedList = await (await alpha.request('/orders?status=shipped'+date)).json() as any;
  assert.equal(datedList.pagination.total,1); assert.equal(datedList.data[0].orderNumber,'SHIPPED-END');
  const searched = parseCsv(await (await alpha.request('/orders?format=csv&search=SKU-2')).text());
  assert.equal(searched.length,2); assert.equal(searched[1]![1],'CSV-1');
  for (const invalid of ['status=bad','dateFrom=bad','dateFrom=2026-09-02T00:00:00Z&dateTo=2026-09-01T00:00:00Z','clientId=no','storeId=-2']) {
    assert.equal((await alpha.request('/orders?format=csv&'+invalid)).status,400);
  }
  assert.equal((await appFor([]).request('/orders?format=csv')).status,403);
  const financial = parseCsv(await (await appFor([a.id],[],true).request('/orders?format=csv&search=CSV-1')).text());
  assert.ok(financial[0]!.includes('Order total') && !financial[0]!.includes('Weight (oz)'));
  assert.equal(financial[1]![financial[0]!.indexOf('Order total')],'12.34');
  const admin = parseCsv(await (await appFor([],[],false,true).request(`/orders?format=csv&clientId=${b.id}`)).text());
  assert.equal(admin.length,2); assert.ok(admin[0]!.includes('Weight (oz)'));
  const caller = {userId:'export-fixture',clientIds:[a.id],storeIds:[],isGlobal:false,isRestricted:true,
    permissions:[],canViewFinancials:false,canViewCredentials:false};
  let observed = false;
  const snapshot = loadFixtureModule('src/lib/client-portal/read-models/order-export.ts', {
    './orders': {listPortalOrders: async (...args: Parameters<typeof owner.listPortalOrders>) => {
      const result = await owner.listPortalOrders(...args);
      if (args[1].page===1) {
        observed = true;
        await sql`insert into orders(client_id,store_id,order_number,order_status,order_date,items)
          values (${a.id},8811,'CONCURRENT-INSERT','awaiting_shipment','2026-09-03','[]'::jsonb)`;
      }
      return result;
    }},
  });
  const frozen = await snapshot.exportPortalOrders(caller,{search:'',status:'awaiting_shipment'});
  assert.ok(observed); assert.equal(frozen.rows,505); assert.ok(!frozen.csv.includes('CONCURRENT-INSERT'));
  assert.equal((await exportPortalOrders(caller,{search:'',status:'awaiting_shipment'})).rows,506);
  const dto = list.data[0];
  for (const text of ['=1+1',' +cmd','-cmd','@SUM(A1)','\tvalue','\nvalue']) {
    assert.equal(parseCsv(orderCsvHeader(caller)+orderCsvRow({...dto,orderNumber:text},caller))[1]![1],"'"+text);
  }
  const oversized = loadFixtureModule('src/lib/client-portal/read-models/order-export.ts', {
    './orders': {listPortalOrders: async () => ({data:[{...dto,orderNumber:'x'.repeat(ORDER_EXPORT_MAX_BYTES)}],
      pagination:{total:1,totalPages:1}})},
  });
  await assert.rejects(oversized.exportPortalOrders(caller,{search:''}), /Too many bytes/);
  await sql`insert into orders(client_id,store_id,order_number,order_status,items)
    select ${a.id},8811,'LIMIT-'||g,'awaiting_shipment','[]'::jsonb from generate_series(1,10001) g`;
  assert.equal((await alpha.request('/orders?format=csv&search=LIMIT-')).status,413);
  const failedRoute = loadFixtureModule('src/routes/client-portal/orders.ts', {
    '../../lib/client-portal/read-models/order-export': {OrderExportTooLarge,
      exportPortalOrders: async () => {throw Error('private SQL failure');}},
  }).default;
  const failed = new Hono();
  failed.use('*',async(c,next)=>{c.set('clientIds' as never,[a.id] as never);await next();});
  failed.route('/',failedRoute);
  const unavailable = await failed.request('/orders?format=csv');
  assert.equal(unavailable.status,503); assert.ok(!(await unavailable.text()).includes('private SQL'));
  console.log('PASS Orders CSV full pages, snapshot consistency, filters, scope, money/weight redaction, CSV escaping, limits and failure states');
} finally { globalThis.fetch=oldFetch; await sql.end({timeout:5}); }
