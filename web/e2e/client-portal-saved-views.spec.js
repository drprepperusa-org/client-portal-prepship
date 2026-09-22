import { expect, test } from '@playwright/test';
const base = 'http://127.0.0.1:5177';
test.use({ contextOptions: { reducedMotion: 'reduce' } });
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
      if(extra===undefined && url.pathname.endsWith('/clients'))body={data:[{id:1,name:'Alpha'},{id:2,name:'Beta'}]};
      if(extra===undefined && url.pathname.endsWith('/sync-status'))body={status:'ok',lastSyncAt:null};
      if(extra===undefined && url.pathname.endsWith('/awaiting-active-count'))body={count:102};
      await route.fulfill({json:body}); return;
    }
    if(url.origin===base){await route.continue();return;}
    await route.abort();
  });
}


const key=(page='orders',user='sort-test',client=null)=>`portal-saved-views:v1:${JSON.stringify([user,client,page])}`;
const dialog=page=>page.getByRole('dialog',{name:'Save current view',exact:true});
async function fixture(page) {
  const state={requests:[],exports:[]};
  await setup(page,url=>{
    const name=url.pathname.split('/').at(-1);
    if(!['orders','inventory','shipments','returns'].includes(name))return;
    const params=Object.fromEntries(url.searchParams);
    state.requests.push({name,...params});
    const p=Number(params.page||1),size=Number(params.pageSize||50);
    const row=name==='orders'
      ?{id:p,orderNumber:`ORDER-${p}`,orderDate:'2026-09-01',clientName:'Alpha',fulfillmentStatus:'pending',orderedUnits:1,items:[],orderTotal:10}
      :name==='shipments'?{id:p,orderNumber:`SHIP-${p}`,clientName:'Alpha',shipmentStatus:'shipped',
        displayTrackingNumber:'CANON-TRACK',shipDate:'2026-09-01',items:[]}
      :name==='returns'?{id:p,orderNumber:`RETURN-${p}`,clientName:'Alpha',returnReference:`RETURN-${p}-REF`,
        status:'requested',trackingNumber:null,createdAt:'2026-09-01',returnedSkus:['SKU-A'],returnedQuantity:2}
      :{id:p,sku:`SKU-${p}`,name:'Current backend item',clientName:'Alpha',inventoryQuantity:7,reorderLevel:10,stockStatus:'low',
        warehouseShipped30d:3,length:null,width:null,height:null,cuFt:null,packageLength:null,active:true};
    return {data:[row],pagination:{page:p,pageSize:size,total:505,totalPages:Math.ceil(505/size)}};
  });
  await page.route('**/api/client-portal/*?*format=csv*',async route=>{
    state.exports.push(Object.fromEntries(new URL(route.request().url()).searchParams));
    await route.fulfill({contentType:'text/csv',headers:{'Content-Disposition':'attachment; filename="saved-view.csv"'},body:'backend CSV'});
  });
  return state;
}
async function save(page,name) {
  await page.getByRole('button',{name:'Save view',exact:true}).click();
  await dialog(page).getByRole('textbox',{name:'View name'}).fill(name);
  await dialog(page).getByRole('button',{name:'Save',exact:true}).click();
  await expect(dialog(page)).toHaveCount(0);
}
async function open(page,name) {
  await page.getByRole('combobox',{name:'Open saved view'}).selectOption({label:name});
  await expect(page.getByRole('status').filter({hasText:`Opened “${name}”.`})).toBeVisible();
}

test('Orders saves and restores current filters, sort and page size across reloads with matching CSV intent',async({page})=>{
  const state=await fixture(page);await page.goto(base+'/orders');
  await page.getByRole('button',{name:'Shipped',exact:true}).click();
  await page.getByRole('textbox',{name:'Search orders',exact:true}).fill('ORDER');
  await page.getByRole('button',{name:'Order #',exact:true}).click();
  await page.getByRole('combobox',{name:'Rows per page'}).selectOption('100');
  await expect.poll(()=>state.requests.at(-1)).toMatchObject({search:'ORDER',status:'shipped',sortBy:'order',sortDir:'asc',pageSize:'100'});
  await save(page,'My shipped orders');
  const stored=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key());
  expect(stored.views[0].filters).toEqual({page:'orders',search:'ORDER',status:'shipped',sort:{key:'order',dir:'asc'},pageSize:100});
  expect(Object.keys(stored.views[0]).sort()).toEqual(['filters','id','name']);
  await page.reload();
  await page.getByRole('button',{name:'Next page',exact:true}).click();
  await expect.poll(()=>state.requests.at(-1).page).toBe('2');
  // Save/apply must cancel a typed query's pending debounce rather than revive it later.
  await page.getByRole('textbox',{name:'Search orders',exact:true}).fill('unapplied draft');
  await open(page,'My shipped orders');
  await expect.poll(()=>state.requests.at(-1)).toMatchObject({search:'ORDER',status:'shipped',sortBy:'order',sortDir:'asc',page:'1',pageSize:'100'});
  await expect(page.getByRole('textbox',{name:'Search orders',exact:true})).toHaveValue('ORDER');
  await expect(page.getByRole('button',{name:'Export CSV',exact:true})).toBeEnabled();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export CSV',exact:true}).click();await download;
  expect(state.exports.at(-1)).toMatchObject({search:'ORDER',status:'shipped',sortBy:'order',sortDir:'asc'});
  expect(state.exports.at(-1).page).toBeUndefined();
  const requestCount=state.requests.length;
  await open(page,'My shipped orders');
  await expect.poll(()=>state.requests.length).toBeGreaterThan(requestCount);
  await expect.poll(()=>state.requests.at(-1).search).toBe('ORDER');
  await page.screenshot({path:test.info().outputPath('orders-saved-view.png')});
});

test('Inventory restores low-stock search, sorting and page size and keeps views separate from Orders',async({page})=>{
  const state=await fixture(page);await page.goto(base+'/inventory');
  await page.getByRole('textbox',{name:'Search inventory',exact:true}).fill('SKU');
  await page.getByText('Low/Out only',{exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'Low/Out only'})).toBeChecked();
  await page.getByRole('button',{name:'SKU',exact:true}).click();
  await page.getByRole('combobox',{name:'Rows per page'}).selectOption('200');
  await save(page,'Low stock');
  await page.goto(base+'/orders');
  await expect(page.getByRole('combobox',{name:'Open saved view'})).toBeDisabled();
  await page.goto(base+'/inventory');
  await page.getByRole('button',{name:'Next page',exact:true}).click();
  await expect.poll(()=>state.requests.at(-1).page).toBe('2');
  await open(page,'Low stock');
  await expect.poll(()=>state.requests.at(-1)).toMatchObject({name:'inventory',search:'SKU',lowStock:'1',sortBy:'sku',sortDir:'asc',page:'1',pageSize:'200'});
  await expect(page.getByRole('checkbox',{name:'Low/Out only'})).toBeChecked();
  await expect(page.getByRole('table').getByText('Current backend item',{exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.getByRole('button',{name:'Save view',exact:true}).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toHaveCSS('opacity','1');
  await page.screenshot({path:test.info().outputPath('inventory-save-mobile.png')});
  await page.keyboard.press('Escape');await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Save view',exact:true})).toBeFocused();
});

test('Saved views are separated by client and user without changing request scope',async({page})=>{
  await page.setViewportSize({width:1440,height:900});const state=await fixture(page);
  await page.addInitScript(k=>localStorage.setItem(k,JSON.stringify({version:1,views:[{id:'other',name:'Other user private view',
    filters:{page:'orders',search:'private',status:'all',sort:null,pageSize:50}}]})),key('orders','other-user'));
  await page.goto(base+'/orders');
  await expect(page.getByRole('combobox',{name:'Open saved view'})).toBeDisabled();
  await page.getByRole('button',{name:'All clients',exact:true}).click();await page.getByRole('button',{name:'Alpha',exact:true}).click();
  await save(page,'Alpha view');
  await page.getByRole('button',{name:'Alpha',exact:true}).first().click();await page.getByRole('button',{name:'Beta',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Open saved view'})).toBeDisabled();
  await page.getByRole('button',{name:'Beta',exact:true}).first().click();await page.getByRole('button',{name:'Alpha',exact:true}).click();
  await open(page,'Alpha view');
  await expect.poll(()=>state.requests.at(-1)?.clientId).toBe('1');
  await expect(page.getByText('Other user private view',{exact:true})).toHaveCount(0);
});

test('Duplicate names do not overwrite filters and deleting a view persists',async({page})=>{
  await fixture(page);await page.goto(base+'/orders');await save(page,'Daily');
  await page.getByRole('button',{name:'Save view',exact:true}).click();
  await dialog(page).getByRole('textbox',{name:'View name'}).fill(' daily ');
  await dialog(page).getByRole('button',{name:'Save',exact:true}).click();
  await expect(dialog(page).getByRole('alert')).toContainText('already exists');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Manage views',exact:true}).click();
  await page.getByRole('button',{name:'Delete saved view Daily'}).click();
  await expect(page.getByRole('dialog').getByText('No saved views.',{exact:true})).toBeVisible();
  await page.reload();await expect(page.getByRole('combobox',{name:'Open saved view'})).toBeDisabled();
});

test('Storage write failure never reports saved success and preserves the draft for retry',async({page})=>{
  await fixture(page);await page.goto(base+'/orders');
  await page.evaluate(()=>{
    window.originalSetItem=Storage.prototype.setItem;
    Storage.prototype.setItem=function(k,v){if(k.startsWith('portal-saved-views:'))throw new Error('quota');return window.originalSetItem.call(this,k,v);};
  });
  await page.getByRole('button',{name:'Save view',exact:true}).click();
  await dialog(page).getByRole('textbox',{name:'View name'}).fill('Retry this');
  await dialog(page).getByRole('button',{name:'Save',exact:true}).click();
  await expect(dialog(page).getByRole('alert')).toContainText('Changes were not saved');
  await expect(dialog(page).getByRole('textbox',{name:'View name'})).toHaveValue('Retry this');
  expect(await page.evaluate(k=>localStorage.getItem(k),key())).toBeNull();
  await page.evaluate(()=>{Storage.prototype.setItem=window.originalSetItem;});
  await dialog(page).getByRole('button',{name:'Save',exact:true}).click();await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole('status').filter({hasText:'Saved “Retry this”.'})).toBeVisible();
});

test('Malformed storage and injected scope fields cannot apply filters or overwrite saved data',async({page})=>{
  const state=await fixture(page);
  const invalid=JSON.stringify({version:1,views:[{id:'bad',name:'Injected',filters:{page:'orders',search:'secret',status:'all',sort:null,pageSize:50,clientId:999}}]});
  await page.addInitScript(({k,invalid})=>localStorage.setItem(k,invalid),{k:key(),invalid});
  await page.goto(base+'/orders');
  await expect(page.getByRole('alert')).toContainText('could not be read');
  await expect(page.getByRole('combobox',{name:'Open saved view'})).toBeDisabled();
  expect(state.requests.every(r=>r.clientId===undefined && r.search!=='secret')).toBe(true);
  await page.getByRole('button',{name:'Save view',exact:true}).click();
  await dialog(page).getByRole('textbox',{name:'View name'}).fill('Cannot overwrite');
  await dialog(page).getByRole('button',{name:'Save',exact:true}).click();
  await expect(dialog(page).getByRole('alert')).toContainText('not saved');
  expect(await page.evaluate(k=>localStorage.getItem(k),key())).toBe(invalid);
});

test('Views saved in another tab are preserved and updates are reflected',async({page,context})=>{
  const second=await context.newPage();
  try {
    await fixture(page);await fixture(second);await page.goto(base+'/orders');await second.goto(base+'/orders');
    await save(page,'First tab');
    await expect(second.getByRole('combobox',{name:'Open saved view'}).locator('option')).toHaveText(['Open saved view…','First tab']);
    await save(second,'Second tab');
    await expect(page.getByRole('combobox',{name:'Open saved view'}).locator('option')).toHaveText(['Open saved view…','First tab','Second tab']);
  } finally {await second.close();}
});

test('The saved-view limit is explicit and deleting a view frees a slot',async({page})=>{
  await fixture(page);
  await page.addInitScript(k=>localStorage.setItem(k,JSON.stringify({version:1,views:Array.from({length:20},(_,i)=>({
    id:`view-${i}`,name:`View ${i}`,filters:{page:'orders',search:'',status:'all',sort:null,pageSize:50},
  }))})),key());
  await page.goto(base+'/orders');
  await page.getByRole('button',{name:'Save view',exact:true}).click();
  await dialog(page).getByRole('textbox',{name:'View name'}).fill('View 21');
  await dialog(page).getByRole('button',{name:'Save',exact:true}).click();
  await expect(dialog(page).getByRole('alert')).toContainText('up to 20 views');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Manage views',exact:true}).click();
  await page.getByRole('button',{name:'Delete saved view View 0',exact:true}).click();
  await page.keyboard.press('Escape');
  await save(page,'View 21');
  expect(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)).views.length,key())).toBe(20);
});

for (const surface of ['shipments', 'returns']) {
  test(`${surface} saved views restore fresh list and CSV intent while preserving order scope`, async ({ page }) => {
    const state = await fixture(page);
    const status = surface === 'shipments' ? 'shipped' : 'requested';
    await page.goto(base + '/' + surface + (surface === 'returns' ? '?order=123' : ''));
    await page.getByRole('combobox', { name: 'Filter by status' }).selectOption(status);
    await page.getByRole('textbox', { name: `Search ${surface}`, exact: true }).fill('Daily');
    await page.getByRole('button', { name: 'Order', exact: true }).click();
    await page.getByRole('combobox', { name: 'Rows per page' }).selectOption('100');
    await save(page, 'Daily view');
    const stored = await page.evaluate(k => JSON.parse(localStorage.getItem(k)), key(surface));
    expect(stored.views[0].filters).toEqual({ page: surface, search: 'Daily', status,
      sort: { key: 'order', dir: 'asc' }, pageSize: 100 });
    await page.reload();
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect.poll(() => state.requests.filter(request => request.name === surface).at(-1).page).toBe('2');
    await page.getByRole('textbox', { name: `Search ${surface}`, exact: true }).fill('unapplied draft');
    await open(page, 'Daily view');
    const expected = { name: surface, search: 'Daily', status, sortBy: 'order', sortDir: 'asc', page: '1', pageSize: '100' };
    await expect.poll(() => state.requests.filter(request => request.name === surface).at(-1)).toMatchObject(expected);
    await expect(page.getByRole('textbox', { name: `Search ${surface}`, exact: true })).toHaveValue('Daily');
    await expect(page).toHaveURL(new RegExp('q=Daily'));
    await expect(page.getByRole('button', { name: 'Export CSV', exact: true })).toBeEnabled();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV', exact: true }).click(); await download;
    expect(state.exports.at(-1)).toMatchObject({ search: 'Daily', status, sortBy: 'order', sortDir: 'asc' });
    if (surface === 'returns') {
      expect(state.requests.filter(request => request.name === surface).at(-1).orderId).toBe('123'); expect(state.exports.at(-1).orderId).toBe('123');
      expect(new URL(page.url()).searchParams.get('order')).toBe('123');
    }
    const count = state.requests.filter(request => request.name === surface).length;
    await open(page, 'Daily view');
    await expect.poll(() => state.requests.filter(request => request.name === surface).length).toBeGreaterThan(count);
    await expect.poll(() => state.requests.filter(request => request.name === surface).at(-1)).toMatchObject(expected);
    await page.screenshot({ path: test.info().outputPath(`${surface}-saved-view-desktop.png`) });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.getByRole('button', { name: 'Save view', exact: true }).click();
    await expect(dialog(page)).toHaveCSS('opacity', '1');
    await expect(dialog(page)).toContainText('Your current client and any order filter stay unchanged.');
    await page.screenshot({ path: test.info().outputPath(`${surface}-saved-view-mobile.png`) });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Save view', exact: true })).toBeFocused();
  });

  test(`${surface} saved views follow effective client and isolate pages and users`, async ({ page }) => {
    const state = await fixture(page);
    await page.addInitScript(k => localStorage.setItem(k, JSON.stringify({version:1,views:[{id:'private',name:'Other user view',
      filters:{page:k.includes('shipments')?'shipments':'returns',search:'private',status:'',sort:null,pageSize:50}}]})), key(surface,'other-user',1));
    await page.goto(base + '/' + surface);
    await page.getByRole('combobox', { name: 'Filter by client' }).selectOption('1');
    await save(page, 'Alpha work');
    await page.getByRole('combobox', { name: 'Filter by client' }).selectOption('2');
    await expect(page.getByRole('combobox', { name: 'Open saved view' })).toBeDisabled();
    await page.getByRole('combobox', { name: 'Filter by client' }).selectOption('');
    await page.getByRole('button', { name: 'All clients', exact: true }).click();
    await page.getByRole('button', { name: 'Alpha', exact: true }).click();
    await open(page, 'Alpha work');
    await expect.poll(() => state.requests.filter(request => request.name === surface).at(-1).clientId).toBe('1');
    await expect(page.getByRole('option', { name: 'Other user view' })).toHaveCount(0);
    await page.goto(base + '/' + (surface === 'shipments' ? 'returns' : 'shipments'));
    await expect(page.getByRole('combobox', { name: 'Open saved view' })).toBeDisabled();
  });

  test(`${surface} rejects saved scope injection and invalid status`, async ({ page }) => {
    const state = await fixture(page); await page.goto(base + '/' + surface);
    for (const invalid of [{ clientId: 999 }, { orderId: 999 }, { status: 'invented' }, { sort: { key:'privateCost', dir:'asc' } }]) {
      await page.evaluate(({ k, surface, invalid }) => localStorage.setItem(k, JSON.stringify({version:1,views:[
        {id:'invalid',name:'Invalid view',filters:{page:surface,search:'injected',status:'',sort:null,pageSize:50,...invalid}}
      ]})), { k:key(surface), surface, invalid });
      await page.reload();
      await expect(page.getByRole('alert').filter({ hasText:'Saved views could not be read' })).toBeVisible();
      await expect(page.getByRole('combobox', { name:'Open saved view' })).toBeDisabled();
      expect(state.requests.some(r => r.clientId === '999' || r.orderId === '999' || r.search === 'injected')).toBe(false);
    }
  });
}
