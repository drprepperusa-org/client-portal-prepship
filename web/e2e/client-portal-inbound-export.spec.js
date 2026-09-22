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

const fileBytes = '\uFEFF"Receipt ID","SKU","Received quantity"\r\n"1","SKU-A","3"\r\n"505","SKU-B","9"\r\n';
async function receiptsFixture(page) {
  const state = { requests: [], exports: [], failure: 0, gate: null, empty: false };
  await setup(page);
  await page.route('**/api/client-portal/inbound/receipts?*',async route=>{
    const url=new URL(route.request().url());const params=Object.fromEntries(url.searchParams);
    expect(route.request().method()).toBe('GET');
    if(params.format==='csv') {
      state.exports.push(params);
      if(state.gate)await state.gate;
      if(state.failure){await route.fulfill({status:state.failure,json:{error:'private_details'}});return;}
      await route.fulfill({contentType:'text/csv; charset=utf-8',headers:{'Content-Disposition':'attachment; filename="inbound-receipts-fixture.csv"'},body:fileBytes});return;
    }
    state.requests.push(params);
    const p=Number(params.page||1),size=Number(params.pageSize||50);
    const total=state.empty?0:505;
    await route.fulfill({json:{data:total?[{id:p,inventoryId:1,clientId:1,clientName:'Alpha',sku:'SKU-A',name:'Widget',
      receivedUnits:3,receivedAt:'2026-09-01T00:00:00Z',note:null}]:[],
      pagination:{page:p,pageSize:size,total,totalPages:Math.max(1,Math.ceil(total/size))}}});
  });
  return state;
}
async function download(page) {
  const event=page.waitForEvent('download');await page.getByRole('button',{name:'Export CSV',exact:true}).click();
  return event;
}
test('Inbound CSV preserves backend bytes and matches client and sort across all receipt history',async({page})=>{
  const state=await receiptsFixture(page);await page.goto(base+'/inbound');
  await expect(page.getByRole('button',{name:'Export CSV',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Date range filter',exact:true})).toHaveCount(0);
  const first=await download(page);
  expect(first.suggestedFilename()).toBe('inbound-receipts-fixture.csv');
  const chunks=[];for await(const chunk of await first.createReadStream())chunks.push(chunk);
  expect(Buffer.concat(chunks).toString('utf8')).toBe(fileBytes);
  expect(state.exports[0].dateFrom).toBeUndefined();expect(state.exports[0].dateTo).toBeUndefined();
  expect(state.exports[0].page).toBeUndefined();
  await page.getByRole('button',{name:'All clients',exact:true}).click();
  await page.getByRole('button',{name:'Alpha',exact:true}).click();
  await page.getByRole('combobox',{name:'Filter by client'}).selectOption('2');
  await page.getByRole('button',{name:'SKU',exact:true}).click();
  await expect(page.getByRole('button',{name:'Export CSV',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Next page',exact:true}).click();
  await expect.poll(()=>state.requests.at(-1)?.page).toBe('2');
  await expect(page.getByRole('button',{name:'Export CSV',exact:true})).toBeEnabled();
  await download(page);
  const exported=state.exports.at(-1),listed=state.requests.at(-1);
  for(const key of ['clientId','sortBy','sortDir'])expect(exported[key]).toBe(listed[key]);
  expect(exported).toMatchObject({clientId:'2',sortBy:'sku',sortDir:'asc'});
  expect(exported.dateFrom).toBeUndefined();expect(exported.dateTo).toBeUndefined();
  expect(exported.page).toBeUndefined();expect(exported.pageSize).toBeUndefined();
  await expect(page.getByText('CSV downloaded with all matching receipts. Dates are in UTC.')).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('button',{name:'Export CSV',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:test.info().outputPath('inbound-export-mobile.png')});
});
test('Inbound export reports progress and safe errors, permits retry and disables empty exports',async({page})=>{
  const state=await receiptsFixture(page);await page.goto(base+'/inbound');
  await expect(page.getByRole('button',{name:'Export CSV',exact:true})).toBeEnabled();
  let release;state.gate=new Promise(resolve=>release=resolve);state.failure=503;
  await page.getByRole('button',{name:'Export CSV',exact:true}).click();
  await expect(page.getByText('Preparing your CSV…')).toBeVisible();
  await expect(page.getByRole('button',{name:'Exporting…',exact:true})).toBeDisabled();
  release();state.gate=null;
  await expect(page.getByRole('alert').filter({hasText:'Could not export receiving history'})).toBeVisible();
  await expect(page.getByText('private_details')).toHaveCount(0);
  state.failure=413;await page.getByRole('button',{name:'Export CSV',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'Export is too large'})).toBeVisible();
  state.failure=403;await page.getByRole('button',{name:'Export CSV',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'Your access could not be verified'})).toBeVisible();
  state.failure=0;await download(page);state.empty=true;
  await page.getByRole('combobox',{name:'Filter by client'}).selectOption('2');
  await expect(page.getByText('No received inventory',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Export CSV',exact:true})).toBeDisabled();
});
test('Changing client cancels pending receiving-history export without downloading another client file',async({page})=>{
  const state=await receiptsFixture(page);const downloads=[];page.on('download',file=>downloads.push(file));
  await page.goto(base+'/inbound');await expect(page.getByRole('button',{name:'Export CSV',exact:true})).toBeEnabled();
  let release;state.gate=new Promise(resolve=>release=resolve);
  await page.getByRole('button',{name:'Export CSV',exact:true}).click();
  await expect.poll(()=>state.exports.length).toBe(1);
  await page.getByRole('button',{name:'All clients',exact:true}).click();
  await page.getByRole('button',{name:'Beta',exact:true}).click();
  await expect.poll(()=>state.requests.at(-1)?.clientId).toBe('2');
  release();state.gate=null;
  await expect(page.getByRole('button',{name:'Export CSV',exact:true})).toBeEnabled();
  await expect(page.getByText('CSV downloaded with all matching receipts. Dates are in UTC.')).toHaveCount(0);
  await download(page);expect(downloads).toHaveLength(1);expect(state.exports.at(-1).clientId).toBe('2');
});
test('Changing receipt sorting cancels the old export and exports the current ordering',async({page})=>{
  const state=await receiptsFixture(page);const downloads=[];page.on('download',file=>downloads.push(file));
  await page.goto(base+'/inbound');await expect(page.getByRole('button',{name:'Export CSV',exact:true})).toBeEnabled();
  let release;state.gate=new Promise(resolve=>release=resolve);
  await page.getByRole('button',{name:'Export CSV',exact:true}).click();
  await expect.poll(()=>state.exports.length).toBe(1);
  await page.getByRole('button',{name:'SKU',exact:true}).click();
  await expect.poll(()=>state.requests.at(-1)?.sortBy).toBe('sku');
  await expect(page.getByRole('button',{name:'Export CSV',exact:true})).toBeEnabled();
  release();state.gate=null;
  await download(page);expect(downloads).toHaveLength(1);expect(state.exports.at(-1).sortBy).toBe('sku');
});
