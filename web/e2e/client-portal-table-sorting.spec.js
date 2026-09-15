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

for (const scenario of ['stock search', 'low stock', 'stock client', 'history search', 'history type', 'history client', 'history dates']) {
  test(`Inventory requests only page 1 after ${scenario} changes from page 2`, async ({ page }) => {
    const history = scenario.startsWith('history');
    const endpoint = `/api/client-portal/${history ? 'inventory-history' : 'inventory'}`;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      window.inventoryReads = [];
      const original = window.fetch;
      window.fetch = (...args) => {
        const url = new URL(String(args[0]), window.location.origin);
        if (url.pathname.startsWith('/api/client-portal/inventory')) window.inventoryReads.push(url.href);
        return original(...args);
      };
    });
    const row = (p) => history
      ? { id: p, sku: `PAGE-${p}`, type: 'receive', qty: 7, createdAt: '2026-09-01' }
      : { id: p, sku: `PAGE-${p}`, name: 'Fixture', inventoryQuantity: 7, stockStatus: 'in', warehouseShipped30d: 3 };
    const body = (p) => ({ data: [row(p)], pagination: { page: p, pageSize: 100, total: 200, totalPages: 2 } });
    await setup(page, url => {
      if (url.pathname === endpoint) return body(Number(url.searchParams.get('page') || 1));
      if (url.pathname.endsWith('/clients')) return { data: [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }] };
    });
    await page.goto(base + '/inventory');
    if (history) await page.getByRole('button', { name: 'History', exact: true }).click();
    await expect(page.getByRole('table').getByText('PAGE-1', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    const oldCell = page.getByRole('table').getByText('PAGE-2', { exact: true });
    await expect(oldCell).toBeVisible();
    await page.evaluate(() => { window.inventoryReads = []; });
    const pending = [];
    await page.route(`**${endpoint}?**`, route => { pending.push(route); });
    if (scenario.endsWith('search')) {
      await page.getByRole('textbox', { name: history ? 'Search history' : 'Search inventory' }).fill('NEW-SKU');
    } else if (scenario === 'low stock') {
      await page.getByText('Low/Out only', { exact: true }).click();
    } else if (scenario.endsWith('client')) {
      await page.getByRole('button', { name: 'All clients', exact: true }).click();
      await page.getByRole('button', { name: 'Beta', exact: true }).click();
    } else if (scenario === 'history type') {
      await page.getByRole('button', { name: 'All types', exact: true }).click();
      await page.getByRole('option', { name: 'Receive', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Date range filter', exact: true }).click();
      await page.getByRole('button', { name: 'Last 7 days', exact: true }).click();
      await page.getByRole('button', { name: 'Apply', exact: true }).click();
    }
    await expect.poll(() => pending.length).toBeGreaterThan(0);
    const reads = await page.evaluate(path => window.inventoryReads.filter(raw => new URL(raw).pathname === path), endpoint);
    expect(reads.map(raw => new URL(raw).searchParams.get('page'))).toEqual(['1']);
    const params = new URL(reads[0]).searchParams;
    if (scenario.endsWith('client')) {
      expect(params.get('clientId')).toBe('2');
      await expect(oldCell).toHaveCount(0);
    } else {
      await expect(oldCell).toBeVisible();
      await expect(page.getByRole('status')).toHaveText('Updating…');
    }
    if (scenario.endsWith('search')) expect(params.get(history ? 'sku' : 'search')).toBe('NEW-SKU');
    if (scenario === 'low stock') expect(params.get('lowStock')).toBe('1');
    if (scenario === 'history type') expect(params.get('type')).toBe('Receive');
    if (scenario === 'history dates') expect(Date.parse(params.get('to')) - Date.parse(params.get('from'))).toBe(7 * 86400000 - 1);
    await pending[0].fulfill({ json: body(1) });
    await expect(page.getByRole('table').getByText('PAGE-1', { exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
    // The settled request stays singular; no effect schedules a second page read.
    expect(await page.evaluate(path => window.inventoryReads.filter(raw => new URL(raw).pathname === path).length, endpoint)).toBe(1);
  });
}

for (const filter of ['search', 'status', 'client', 'topbar client']) {
  test(`Shipments requests only page 1 after ${filter} changes from page 2`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      window.shipmentReads = [];
      const original = window.fetch;
      window.fetch = (...args) => {
        const url = new URL(String(args[0]), window.location.origin);
        if (url.pathname === '/api/client-portal/shipments') window.shipmentReads.push(url.href);
        return original(...args);
      };
    });
    const body = p => ({ data: [{ id: p, orderNumber: `SHIP-PAGE-${p}`, items: [], shipmentStatus: 'shipped',
      displayTrackingNumber: `TRACK-${p}`, customerShippingRate: 8.75 }],
      pagination: { page: p, pageSize: 50, total: 100, totalPages: 2 } });
    await setup(page, url => {
      if (url.pathname.endsWith('/shipments')) return body(Number(url.searchParams.get('page') || 1));
      if (url.pathname.endsWith('/clients')) return { data: [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }] };
    });
    await page.goto(base + '/shipments');
    await expect(page.getByRole('table').getByText('SHIP-PAGE-1', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    const oldCell = page.getByRole('table').getByText('SHIP-PAGE-2', { exact: true });
    await expect(oldCell).toBeVisible();
    await page.evaluate(() => { window.shipmentReads = []; });
    const pending = [];
    await page.route('**/api/client-portal/shipments?**', route => { pending.push(route); });
    if (filter === 'search') await page.getByRole('textbox', { name: 'Search shipments' }).fill('TRACK-NEW');
    if (filter === 'status') await page.getByRole('combobox', { name: 'Filter by status' }).selectOption('shipped');
    if (filter === 'client') await page.getByRole('combobox', { name: 'Filter by client' }).selectOption('2');
    if (filter === 'topbar client') {
      await page.getByRole('button', { name: 'All clients', exact: true }).click();
      await page.getByRole('button', { name: 'Beta', exact: true }).click();
    }
    await expect.poll(() => pending.length).toBeGreaterThan(0);
    const reads = await page.evaluate(() => window.shipmentReads);
    expect(reads.map(raw => new URL(raw).searchParams.get('page'))).toEqual(['1']);
    const params = new URL(reads[0]).searchParams;
    if (filter.includes('client')) {
      expect(params.get('clientId')).toBe('2');
      await expect(oldCell).toHaveCount(0);
    } else {
      await expect(oldCell).toBeVisible();
      await expect(page.getByRole('status')).toHaveText('Updating…');
    }
    if (filter === 'search') expect(params.get('search')).toBe('TRACK-NEW');
    if (filter === 'status') expect(params.get('status')).toBe('shipped');
    await pending[0].fulfill({ json: body(1) });
    await expect(page.getByRole('table').getByText('SHIP-PAGE-1', { exact: true })).toBeVisible();
    await expect(page.getByRole('table').getByText('$8.75', { exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
    expect(await page.evaluate(() => window.shipmentReads.length)).toBe(1);
  });
}

for (const scenario of [
  { width: 390, timezone: 'Asia/Manila', day: '2026-09-16', from: '2026-09-15T16:00:00.000Z', to: '2026-09-16T16:00:00.000Z' },
  { width: 1440, timezone: 'Asia/Manila', day: '2026-09-16', from: '2026-09-15T16:00:00.000Z', to: '2026-09-16T16:00:00.000Z' },
  { width: 1440, timezone: 'America/Los_Angeles', day: '2026-03-08', from: '2026-03-08T08:00:00.000Z', to: '2026-03-09T07:00:00.000Z' },
]) test.describe(`Audit investigation ${scenario.width}px ${scenario.timezone}`, () => {
  test.use({ viewport: { width: scenario.width, height: 900 }, timezoneId: scenario.timezone });
  test('dates, activity and background filters reset history and preserve user/store intent', async ({ page }) => {
    const requests = [];
    await setup(page, url => {
      if (url.pathname !== '/api/client-portal/audit-log') return;
      const params = Object.fromEntries(url.searchParams);
      requests.push(params);
      return { data: params.search === 'EMPTY' ? [] : [{ id: Number(params.page || 1), event: 'portal.orders.list',
        actorUserId: 'fixture', actorEmail: 'client@example.test', clientIds: [], storeIds: [77], clientNames: [], storeNames: ['Store'],
        scopeLabel: 'Store', metadata: { orderId: 123 }, createdAt: '2026-09-16T01:00:00Z' }],
        filters: { stores: [{ id: 77, name: 'Store' }], users: ['client@example.test'] },
        pagination: { page: Number(params.page || 1), pageSize: 100, hasMore: params.search !== 'EMPTY' } };
    });
    await page.goto(base + '/audit-log');
    await expect(page.getByRole('button', { name: 'View details for event 1' })).toBeVisible();
    await page.getByRole('button', { name: 'Older events' }).click();
    await expect(page.getByRole('button', { name: 'View details for event 2' })).toBeVisible();
    const beforeDates = requests.length;
    await page.getByLabel('Audit start date', { exact: true }).fill(scenario.day);
    await page.getByLabel('Audit end date', { exact: true }).fill(scenario.day);
    expect(requests.length).toBe(beforeDates);
    await page.getByRole('button', { name: 'Apply dates' }).click();
    await expect(page.getByRole('button', { name: 'View details for event 1' })).toBeVisible();
    expect(requests.slice(beforeDates)).toHaveLength(1);
    expect(requests.at(-1)).toMatchObject({ page: '1', dateFrom: scenario.from, dateTo: scenario.to });
    await page.getByRole('combobox', { name: 'Filter audit log by user' }).selectOption('client@example.test');
    await expect.poll(() => requests.at(-1).actorEmail).toBe('client@example.test');
    await page.getByRole('combobox', { name: 'Filter audit log by store' }).selectOption('77');
    await expect.poll(() => requests.at(-1).storeId).toBe('77');
    await page.getByRole('combobox', { name: 'Filter audit log by activity' }).selectOption('failed');
    await expect.poll(() => requests.at(-1).activity).toBe('failed');
    await page.getByRole('checkbox', { name: 'Hide background checks' }).check();
    await expect.poll(() => requests.at(-1).hideBackground).toBe('true');
    expect(requests.at(-1)).toMatchObject({ actorEmail: 'client@example.test', storeId: '77', activity: 'failed',
      hideBackground: 'true', dateFrom: scenario.from, dateTo: scenario.to });
    await page.getByRole('button', { name: 'Older events' }).click();
    await expect.poll(() => requests.at(-1).page).toBe('2');
    await page.getByRole('button', { name: 'Clear dates' }).click();
    await expect.poll(() => requests.at(-1).page).toBe('1');
    expect(requests.at(-1).dateFrom).toBeUndefined();
    expect(requests.at(-1).dateTo).toBeUndefined();
    expect(requests.at(-1)).toMatchObject({ activity: 'failed', hideBackground: 'true', actorEmail: 'client@example.test', storeId: '77' });
    await page.getByRole('checkbox', { name: 'Hide background checks' }).uncheck();
    await expect.poll(() => requests.at(-1).hideBackground).toBe('false');
    await page.getByRole('textbox', { name: 'Search event or user' }).fill('EMPTY');
    await expect(page.getByRole('heading', { name: 'No audit events' })).toBeVisible();
    await expect(page.getByText('No events match the selected filters.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});

test('Audit investigation retry preserves selected filters', async ({ page }) => {
  await setup(page);
  let fail = false;
  const requests = [];
  await page.route('**/api/client-portal/audit-log?**', async route => {
    const params = Object.fromEntries(new URL(route.request().url()).searchParams);
    requests.push(params);
    if (fail) { await route.fulfill({ status: 503, json: { error: 'private database diagnostic' } }); return; }
    await route.fulfill({ json: { data: [], filters: { stores: [], users: [] }, pagination: { page: 1, pageSize: 100, hasMore: false } } });
  });
  await page.goto(base + '/audit-log');
  await expect(page.getByRole('heading', { name: 'No audit events' })).toBeVisible();
  fail = true;
  await page.getByRole('combobox', { name: 'Filter audit log by activity' }).selectOption('denied');
  await expect(page.getByRole('heading', { name: 'Audit log unavailable' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('private database diagnostic')).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No audit events' })).toBeVisible();
  expect(requests.at(-1).activity).toBe('denied');
});

const replacementFixture = n => ({ id: n, reference: `RP-${String(n).padStart(4, '0')}`, orderId: n,
  orderNumber: `ORDER-${n}`, clientId: 1, clientName: 'Alpha', status: n % 2 ? 'requested' : 'shipped',
  reasonCode: null, itemCount: 2, requestedAt: '2026-09-01' });
for (const width of [390, 1440]) test(`Replace searches, filters and reaches older pages at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const requests = [];
  await setup(page, url => {
    if (url.pathname === '/api/client-portal/replacements') {
      const p = Number(url.searchParams.get('page') || 1), size = Number(url.searchParams.get('pageSize') || 50);
      const search = url.searchParams.get('search') || '', status = url.searchParams.get('status') || '';
      requests.push({ p, size, search, status });
      const rows = Array.from({ length: 210 }, (_, i) => replacementFixture(210 - i)).filter(row =>
        (!search || row.reference.includes(search) || row.orderNumber === search) && (!status || row.status === status));
      return { data: rows.slice((p - 1) * size, p * size),
        pagination: { page: p, pageSize: size, total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / size)) } };
    }
    if (url.pathname === '/api/client-portal/replacements/1') return { data: { ...replacementFixture(1),
      items: [{ id: 1, sku: 'REPLACE-SKU', quantity: 7 }] } };
  });
  await page.goto(base + '/replace');
  await expect(page.getByText('RP-0210', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Rows per page' }).selectOption('200');
  await expect.poll(() => requests.at(-1).size).toBe(200);
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByText('RP-0001', { exact: true })).toBeVisible();
  expect(requests.at(-1)).toMatchObject({ p: 2, size: 200 });
  await page.getByRole('combobox', { name: 'Filter by status' }).selectOption('requested');
  await expect(page.getByText('RP-0209', { exact: true })).toBeVisible();
  expect(requests.at(-1)).toMatchObject({ p: 1, status: 'requested' });
  await page.getByRole('textbox', { name: 'Search replacements' }).fill('ORDER-1');
  await expect(page.getByText('RP-0209', { exact: true })).toHaveCount(0);
  await expect(page.getByText('RP-0001', { exact: true })).toBeVisible();
  expect(requests.at(-1)).toMatchObject({ p: 1, search: 'ORDER-1', status: 'requested' });
  await page.getByRole('button', { name: /RP-0001/ }).click();
  await expect(page.getByRole('dialog').getByText('REPLACE-SKU')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: 'Search replacements' }).fill('NO-MATCH');
  await expect(page.getByRole('heading', { name: 'No matching replacements' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const filter of ['search', 'status', 'client']) test(`Replace ${filter} resets page once and respects loading scope`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    window.replacementReads = [];
    const original = window.fetch;
    window.fetch = (...args) => {
      const url = new URL(String(args[0]), window.location.origin);
      if (url.pathname === '/api/client-portal/replacements') window.replacementReads.push(url.href);
      return original(...args);
    };
  });
  const body = (p, id) => ({ data: [replacementFixture(id)], pagination: { page: p, pageSize: 50, total: 100, totalPages: 2 } });
  await setup(page, url => {
    if (url.pathname === '/api/client-portal/replacements') { const p = Number(url.searchParams.get('page') || 1); return body(p, p); }
    if (url.pathname.endsWith('/clients')) return { data: [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }] };
  });
  await page.goto(base + '/replace');
  await expect(page.getByText('RP-0001', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  const old = page.getByText('RP-0002', { exact: true });
  await expect(old).toBeVisible();
  await page.evaluate(() => { window.replacementReads = []; });
  const pending = [];
  await page.route('**/api/client-portal/replacements?**', route => { pending.push(route); });
  if (filter === 'search') await page.getByRole('textbox', { name: 'Search replacements' }).fill('RP-0003');
  if (filter === 'status') await page.getByRole('combobox', { name: 'Filter by status' }).selectOption('requested');
  if (filter === 'client') {
    await page.getByRole('button', { name: 'All clients', exact: true }).click();
    await page.getByRole('button', { name: 'Beta', exact: true }).click();
  }
  await expect.poll(() => pending.length).toBe(1);
  const reads = await page.evaluate(() => window.replacementReads);
  expect(reads.map(raw => new URL(raw).searchParams.get('page'))).toEqual(['1']);
  if (filter === 'client') {
    expect(new URL(reads[0]).searchParams.get('clientId')).toBe('2');
    await expect(old).toHaveCount(0);
  } else {
    await expect(old).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('Updating…');
  }
  await pending[0].fulfill({ json: body(1, 3) });
  await expect(page.getByText('RP-0003', { exact: true })).toBeVisible();
  await expect(old).toHaveCount(0);
  expect(await page.evaluate(() => window.replacementReads.length)).toBe(1);
});

for (const width of [390, 1440]) for (const filter of (width === 390 ? ['client'] : ['client', 'topbar client'])) {
  test(`Inbound requests only page 1 after ${filter} changes from page 2 at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      window.receiptReads = [];
      const original = window.fetch;
      window.fetch = (...args) => {
        const url = new URL(String(args[0]), window.location.origin);
        if (url.pathname === '/api/client-portal/inbound/receipts') window.receiptReads.push(url.href);
        return original(...args);
      };
    });
    const body = (p, client = 'Alpha') => ({ data: [{ id: p, inventoryId: p, sku: `${client}-RECEIPT-${p}`,
      name: 'Recorded product', clientName: client, receivedUnits: 37, receivedAt: '2026-09-01' }],
      pagination: { page: p, pageSize: 50, total: 100, totalPages: 2 } });
    await setup(page, url => {
      if (url.pathname === '/api/client-portal/inbound/receipts') return body(Number(url.searchParams.get('page') || 1));
      if (url.pathname.endsWith('/clients')) return { data: [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }] };
    });
    await page.goto(base + '/inbound');
    await expect(page.getByText('Alpha-RECEIPT-1', { exact: true }).filter({ visible: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    const oldCell = page.getByText('Alpha-RECEIPT-2', { exact: true });
    await expect(oldCell.filter({ visible: true })).toBeVisible();
    await page.evaluate(() => { window.receiptReads = []; });
    const pending = [];
    await page.route('**/api/client-portal/inbound/receipts?**', route => { pending.push(route); });
    if (filter === 'client') await page.getByRole('combobox', { name: 'Filter by client' }).selectOption('2');
    else {
      await page.getByRole('button', { name: 'All clients', exact: true }).click();
      await page.getByRole('button', { name: 'Beta', exact: true }).click();
    }
    await expect.poll(() => pending.length).toBeGreaterThan(0);
    const reads = await page.evaluate(() => window.receiptReads);
    expect(reads.map(raw => new URL(raw).searchParams.get('page'))).toEqual(['1']);
    expect(new URL(reads[0]).searchParams.get('clientId')).toBe('2');
    await expect(oldCell).toHaveCount(0);
    await pending[0].fulfill({ json: body(1, 'Beta') });
    await expect(page.getByText('Beta-RECEIPT-1', { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByText('37', { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByText(/Alpha-RECEIPT/)).toHaveCount(0);
    expect(await page.evaluate(() => window.receiptReads.length)).toBe(1);
  });
}

for (const filter of ['search', 'status', 'client', 'topbar client', 'order link']) {
  test(`Returns requests only page 1 after ${filter} changes from page 2`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      window.returnReads = [];
      const original = window.fetch;
      window.fetch = (...args) => {
        const url = new URL(String(args[0]), window.location.origin);
        if (url.pathname === '/api/client-portal/returns') window.returnReads.push(url.href);
        return original(...args);
      };
    });
    const body = p => ({ data: [{ id: p, orderId: 99, returnReference: `RETURN-PAGE-${p}`, status: 'requested',
      returnedSkus: ['SKU-A'], returnedQuantity: 2, returnCustomerShippingRate: 8.75, createdAt: '2026-09-01' }],
      pagination: { page: p, pageSize: 50, total: 100, totalPages: 2 } });
    await setup(page, url => {
      if (url.pathname === '/api/client-portal/returns') return body(Number(url.searchParams.get('page') || 1));
      if (url.pathname.endsWith('/clients')) return { data: [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }] };
    });
    await page.goto(base + '/returns');
    await expect(page.getByRole('table').getByText('RETURN-PAGE-1', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    const oldCell = page.getByRole('table').getByText('RETURN-PAGE-2', { exact: true });
    await expect(oldCell).toBeVisible();
    await page.evaluate(() => { window.returnReads = []; });
    const pending = [];
    await page.route('**/api/client-portal/returns?**', route => { pending.push(route); });
    if (filter === 'search') await page.getByRole('textbox', { name: 'Search returns' }).fill('ORDER-RETURN');
    if (filter === 'status') await page.getByRole('combobox', { name: 'Filter by status' }).selectOption('requested');
    if (filter === 'client') await page.getByRole('combobox', { name: 'Filter by client' }).selectOption('2');
    if (filter === 'topbar client') {
      await page.getByRole('button', { name: 'All clients', exact: true }).click();
      await page.getByRole('button', { name: 'Beta', exact: true }).click();
    }
    if (filter === 'order link') await page.evaluate(() => {
      window.history.pushState({}, '', '/returns?order=99');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect.poll(() => pending.length).toBeGreaterThan(0);
    const reads = await page.evaluate(() => window.returnReads);
    expect(reads.map(raw => new URL(raw).searchParams.get('page'))).toEqual(['1']);
    const params = new URL(reads[0]).searchParams;
    if (filter.includes('client') || filter === 'order link') {
      expect(params.get(filter === 'order link' ? 'orderId' : 'clientId')).toBe(filter === 'order link' ? '99' : '2');
      await expect(oldCell).toHaveCount(0);
    } else {
      await expect(oldCell).toBeVisible();
      await expect(page.getByRole('status')).toHaveText('Updating…');
    }
    if (filter === 'search') expect(params.get('search')).toBe('ORDER-RETURN');
    if (filter === 'status') expect(params.get('status')).toBe('requested');
    await pending[0].fulfill({ json: body(1) });
    await expect(page.getByRole('table').getByText('RETURN-PAGE-1', { exact: true })).toBeVisible();
    await expect(page.getByRole('table').getByText('$8.75', { exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
    expect(await page.evaluate(() => window.returnReads.length)).toBe(1);
  });
}

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
