import { expect, test } from '@playwright/test';
const base = 'http://127.0.0.1:5177';
const ids = Array.from({ length: 102 }, (_, i) => ((i + 1) * 37) % 103);
const reference = n => `SORT-${n}`;
const tables = [
  { path: '/orders', api: '/orders', header: 'Order #', key: 'order', col: 3,
    row: n => ({ id:n, orderNumber:reference(n), orderStatus:'shipped', fulfillmentStatus:'in_transit', orderDate:'2026-09-01', orderedUnits:n, items:[], orderTotal:n }) },
  { path: '/inventory', api:'/inventory', header:'SKU', key:'sku', col:0,
    row:n=>({id:n,sku:reference(n),name:reference(n),inventoryQuantity:n,stockStatus:'in',warehouseShipped30d:n}) },
  { path: '/shipments', api:'/shipments', header:'Order', key:'order', col:0,
    row:n=>({id:n,orderId:n,orderNumber:reference(n),items:[],shipmentStatus:'in_transit',customerShippingRate:n,shipDate:'2026-09-01'}) },
  { path:'/returns', api:'/returns', header:'Return ref', key:'returnReference', col:0,
    row:n=>({id:n,orderId:n,returnReference:reference(n),orderNumber:reference(n),status:'requested',returnedSkus:[],returnedQuantity:n,createdAt:'2026-09-01'}) },
  { path:'/inbound', api:'/inbound/receipts', header:'SKU', key:'sku', col:1,
    row:n=>({id:n,inventoryId:n,sku:reference(n),name:reference(n),receivedUnits:n,receivedAt:'2026-09-01',clientName:'Fixture'}) },
  { path:'/inventory', api:'/inventory-history', header:'SKU', key:'sku', col:1, history:true,
    row:n=>({id:n,sku:reference(n),qty:n,type:'receive',createdAt:'2026-09-01'}) },
];
const summary = {clientId:1,clientName:'Fixture',periodStart:'2026-09-01',periodEnd:'2026-09-15',orders:102,rowTotal:1};
const billingFields = {
  'Billing Date':'billingEffectiveDate', Reference:'displayReference', Type:'rowType', Destination:'destination',
  'SKU(s)':'itemSkus', Qty:'qty', 'Pick & Pack':'pickpackTotal', 'Addl Units':'additionalTotal',
  'Box Charge':'packageTotal', 'Box Size':'boxSize', Shipping:'shippingTotal', Storage:'storageTotal',
  Adjustment:'adjustmentTotal', 'Return Processing':'returnProcessingTotal', 'Return Postage':'returnPostageTotal',
  'Return Total':'returnTotal', 'Replacement Postage':'replacePostageTotal', 'Replacement Pick & Pack':'replacePickPackTotal',
  'Fulfillment Fee':'grandTotal',
};
async function setup(page, custom) {
  const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const user={id:'sort-test',aud:'authenticated',role:'authenticated',email:'sort@portal-e2e.test',app_metadata:{role:'admin',permissions:['scope:global']},user_metadata:{}};
  const token=[encode({alg:'HS256',typ:'JWT'}),encode({...user,sub:user.id,exp:4102444800}),'fixture'].join('.');
  await page.addInitScript(session=>localStorage.setItem('sb-portal-e2e-auth-token',JSON.stringify(session)),{
    access_token:token,refresh_token:'fixture',expires_at:4102444800,expires_in:2147483647,token_type:'bearer',user,
  });
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.startsWith('/api/client-portal/')) {
      const extra=await custom?.(url);
      let body=extra??{data:[],pagination:{page:1,pageSize:50,total:0,totalPages:1}};
      if(extra===undefined && url.pathname.endsWith('/me'))body={...user,isAdmin:true,isGlobal:true,isRestricted:false,canViewFinancials:true,canViewAudit:true,clientIds:[],storeIds:[]};
      if(extra===undefined && url.pathname.endsWith('/clients'))body={data:[{id:1,name:'Fixture'}]};
      if(extra===undefined && url.pathname.endsWith('/sync-status'))body={status:'ok',lastSyncAt:null};
      if(extra===undefined && url.pathname.endsWith('/awaiting-active-count'))body={count:102};
      await route.fulfill({json:body}); return;
    }
    if(url.origin===base){await route.continue();return;}
    await route.abort();
  });
}
for(const t of tables) test(`${t.api}: sorts full result, persists on page 2, resets page on direction change`,async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  const requests=[];
  await setup(page,url=>{
    if(url.pathname!==`/api/client-portal${t.api}`)return;
    const p=Number(url.searchParams.get('page')||1),size=Number(url.searchParams.get('pageSize')||50);
    const key=url.searchParams.get('sortBy'),dir=url.searchParams.get('sortDir'); requests.push({p,size,key,dir});
    const ordered=key?[...ids].sort((a,b)=>(a-b)*(dir==='desc'?-1:1)):ids;
    return {data:ordered.slice((p-1)*size,p*size).map(t.row),pagination:{page:p,pageSize:size,total:102,totalPages:Math.ceil(102/size)}};
  });
  await page.goto(base+t.path);
  if(t.history)await page.getByRole('button',{name:'History',exact:true}).click();
  const table=page.locator('table').filter({has:page.getByRole('button',{name:t.header,exact:true})});
  const first=()=>table.locator('tbody tr').first().locator('td').nth(t.col);
  await table.getByRole('button',{name:t.header,exact:true}).click();
  await expect(first()).toHaveText('SORT-1');
  expect(requests.at(-1)).toMatchObject({p:1,key:t.key,dir:'asc'});
  const size=requests.at(-1).size;
  await page.getByRole('button',{name:'Next page',exact:true}).click();
  await expect(first()).toHaveText(`SORT-${size+1}`);
  await expect(table.locator('th[aria-sort="ascending"]')).toHaveCount(1);
  await table.getByRole('button',{name:t.header,exact:true}).click();
  await expect(first()).toHaveText('SORT-102');
  expect(requests.at(-1)).toMatchObject({p:1,key:t.key,dir:'desc'});
});

for (const t of tables) test(`${t.api}: pending sort retains rows and shows Updating until the response arrives`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const body = { data: [37, 1].map(t.row), pagination: { page: 1, pageSize: 50, total: 2, totalPages: 1 } };
  await setup(page, url => url.pathname === `/api/client-portal${t.api}` ? body : undefined);
  await page.goto(base + t.path);
  if (t.history) await page.getByRole('button', { name: 'History', exact: true }).click();
  const table = page.locator('table').filter({ has: page.getByRole('button', { name: t.header, exact: true }) });
  const first = table.locator('tbody tr').first().locator('td').nth(t.col);
  await expect(first).toHaveText('SORT-37');
  await first.evaluate(node => { node.dataset.retained = 'original'; });
  const pending = [];
  await page.route(`**/api/client-portal${t.api}?**`, route => { pending.push(route); });
  await table.getByRole('button', { name: t.header, exact: true }).click();
  await expect.poll(() => pending.length).toBe(1);
  await expect(page.getByRole('status')).toHaveText('Updating…');
  await expect(first).toHaveText('SORT-37');
  await expect(first).toHaveAttribute('data-retained', 'original');
  await pending[0].fulfill({ json: { ...body, data: [1, 37].map(t.row) } });
  await expect(first).toHaveText('SORT-1');
  await expect(page.getByRole('status')).toHaveCount(0);
  // Returning to a fresh cached sort requires no request or artificial spinner.
  await table.getByRole('button', { name: t.header, exact: true }).click();
  await expect.poll(() => pending.length).toBe(2);
  await table.getByRole('button', { name: t.header, exact: true }).click();
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(first).toHaveText('SORT-1');
  await pending[1].fulfill({ json: { ...body, data: [99].map(t.row) } }).catch(() => {});
  await expect(first).toHaveText('SORT-1');
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('Inventory filter retains rows, an empty response clears them, and client changes hide old rows', async ({ page }) => {
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  const body = { data: [tables[1].row(37)], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } };
  await setup(page, url => {
    if (url.pathname.endsWith('/inventory')) return body;
    if (url.pathname.endsWith('/clients')) return { data: [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }] };
  });
  await page.goto(base + '/inventory');
  const cell = page.getByRole('table').getByText('SORT-37', { exact: true }).first();
  await expect(cell).toBeVisible();
  const pending = [];
  await page.route('**/api/client-portal/inventory?**', route => { pending.push(route); });
  await page.getByRole('textbox', { name: 'Search inventory' }).fill('missing');
  await expect.poll(() => pending.length).toBe(1);
  await expect(page.getByRole('status')).toHaveText('Updating…');
  await expect(cell).toBeVisible();
  await pending[0].fulfill({ json: { data: [], pagination: { ...body.pagination, total: 0 } } });
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(cell).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search inventory' }).fill('available');
  await expect.poll(() => pending.length).toBe(2);
  await expect(page.getByRole('status')).toHaveText('Updating…');
  await pending[1].fulfill({ json: body });
  await expect(cell).toBeVisible();
  await page.getByRole('button', { name: 'All clients', exact: true }).click();
  await page.getByRole('button', { name: 'Beta', exact: true }).click();
  await expect.poll(() => pending.length).toBe(3);
  await expect(cell).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveCount(0);
  await pending[2].fulfill({ json: { ...body, data: [tables[1].row(88)] } });
  await expect(page.getByRole('table').getByText('SORT-88', { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('mobile return sort shows the shared updating status', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const body = { data: [tables[3].row(37)], pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 } };
  await setup(page, url => url.pathname.endsWith('/returns') ? body : undefined);
  await page.goto(base + '/returns');
  const sort = page.getByRole('combobox', { name: 'Sort by', exact: true });
  await expect(sort).toBeVisible();
  let pending;
  await page.route('**/api/client-portal/returns?**', route => { pending = route; });
  await sort.selectOption('returnReference');
  await expect.poll(() => Boolean(pending)).toBe(true);
  await expect(page.getByRole('status')).toBeVisible();
  await expect(sort).toBeVisible();
  await pending.fulfill({ json: body });
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('failed filter stops Updating and supports Retry', async ({ page }) => {
  const body = { data: [tables[1].row(37)], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } };
  await setup(page, url => url.pathname.endsWith('/inventory') ? body : undefined);
  await page.goto(base + '/inventory');
  await expect(page.getByRole('table')).toBeVisible();
  let pending;
  await page.route('**/api/client-portal/inventory?**', route => { pending = route; });
  await page.getByRole('textbox', { name: 'Search inventory' }).fill('test-failure');
  await expect.poll(() => Boolean(pending)).toBe(true);
  await expect(page.getByRole('status')).toHaveText('Updating…');
  await pending.fulfill({ status: 400, json: { error: 'Fixture rejection' } });
  await expect(page.getByText("Couldn't load data")).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
  pending = null;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await pending.fulfill({ json: body });
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('Billing defaults to Reference descending and maps every header to canonical sort intent',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  const requests=[];
  await setup(page,url=>{
    if(url.pathname.endsWith('/invoice-summary'))return {data:[summary],totals:summary,billingVisible:true};
    if(!url.pathname.endsWith('/invoice-details'))return;
    const key=url.searchParams.get('sortBy'),dir=url.searchParams.get('sortDir');requests.push({key,dir});
    const data=[3857,3855,3918,3892,3890,3845,3880,3913].sort((a,b)=>(a-b)*(dir==='desc'?-1:1)).map(n=>({
      canonicalEventId:String(n),clientId:1,clientName:'Fixture',orderId:n,orderNumber:String(n),displayReference:String(n),
      rowType:'Outbound',destination:'Domestic',billingEffectiveDate:'2026-09-01',qty:n,rowTotal:n,shippingTotal:n,skus:String(n),
    }));
    return {data,pagination:{page:1,pageSize:100,total:8,totalPages:1},billingVisible:true};
  });
  await page.goto(base+'/billing');
  await page.locator('table tbody tr').filter({hasText:'Fixture'}).click();
  const table=page.locator('table').filter({has:page.getByRole('button',{name:'Reference',exact:true})});
  await expect(table.locator('tbody tr')).toHaveCount(8);
  expect(requests.at(-1)).toEqual({key:'displayReference',dir:'desc'});
  expect(await table.locator('tbody tr').evaluateAll(rs=>rs.map(r=>r.cells[1].textContent.trim()))).toEqual(['3918','3913','3892','3890','3880','3857','3855','3845']);
  for(const [label,key] of Object.entries(billingFields)){
    const b=table.getByRole('button',{name:label,exact:true});
    const current=await b.locator('xpath=ancestor::th').getAttribute('aria-sort');
    const dir=current==='ascending'?'desc':'asc';
    await b.click();
    await expect.poll(()=>requests.at(-1)).toEqual({key,dir});
    await expect(b.locator('xpath=ancestor::th')).toHaveAttribute('aria-sort',dir==='asc'?'ascending':'descending');
  }
});

test('mobile sort uses the same full-result request',async({page})=>{
  await page.setViewportSize({width:375,height:812});const requests=[];
  await setup(page,url=>{
    if(!url.pathname.endsWith('/returns'))return;
    requests.push(url.searchParams.get('sortDir'));
    return {data:[tables[3].row(1)],pagination:{page:1,pageSize:50,total:1,totalPages:1}};
  });
  await page.goto(base+'/returns');
  await page.getByRole('combobox',{name:'Sort by',exact:true}).selectOption('returnReference');
  await expect.poll(()=>requests.at(-1)).toBe('asc');
  await page.getByRole('button',{name:'Ascending',exact:true}).click();
  await expect.poll(()=>requests.at(-1)).toBe('desc');
});
