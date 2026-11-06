import { expect, test } from '@playwright/test';
const base = 'http://127.0.0.1:5177';
test.use({ contextOptions: { reducedMotion: 'reduce' } });
async function setup(page, custom, client = false) {
  const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const user={id:'sort-test',aud:'authenticated',role:'authenticated',email:'sort@portal-e2e.test',app_metadata:{role:client?'client_user':'admin',permissions:client?[]:['scope:global']},user_metadata:{}};
  const token=[encode({alg:'HS256',typ:'JWT'}),encode({...user,sub:user.id,exp:4102444800}),'fixture'].join('.');
  await page.addInitScript(session=>localStorage.setItem('sb-portal-e2e-auth-token',JSON.stringify(session)),{
    access_token:token,refresh_token:'fixture',expires_at:4102444800,expires_in:2147483647,token_type:'bearer',user,
  });
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.startsWith('/api/client-portal/')) {
      const extra=await custom?.(url);
      let body=extra??{data:[],pagination:{page:1,pageSize:50,total:0,totalPages:1}};
      if(extra===undefined && url.pathname.endsWith('/me'))body={...user,isAdmin:!client,isGlobal:!client,isRestricted:client,canViewFinancials:true,canViewAudit:!client,clientIds:client?[1]:[],storeIds:[]};
      if(extra===undefined && url.pathname.endsWith('/clients'))body={data:client?[{id:1,name:'Alpha'}]:[{id:1,name:'Alpha'},{id:2,name:'Beta'}]};
      if(extra===undefined && url.pathname.endsWith('/sync-status'))body={status:'ok',lastSyncAt:null};
      if(extra===undefined && url.pathname.endsWith('/awaiting-active-count'))body={count:102};
      await route.fulfill({json:body}); return;
    }
    if(url.origin===base){await route.continue();return;}
    await route.abort();
  });
}

const fileBytes = '\uFEFF"Receipt ID","SKU","Received quantity"\r\n"1","SKU-A","3"\r\n"505","SKU-B","9"\r\n';
async function receiptsFixture(page, client = false) {
  const state = { requests: [], exports: [], failure: 0, gate: null, empty: false };
  await setup(page, undefined, client);
  await page.route('**/api/client-portal/inbound/receipts?*',async route=>{
    const url=new URL(route.request().url());const params=Object.fromEntries(url.searchParams);
    expect(route.request().method()).toBe('GET');
    if(params.format==='csv' || params.format==='xlsx') {
      state.exports.push(params);
      if(state.gate)await state.gate;
      if(state.failure){await route.fulfill({status:state.failure,json:{error:'private_details'}});return;}
      if(params.format==='xlsx') {
        await route.fulfill({contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          headers:{'Content-Disposition':'attachment; filename="inbound-receipts.xlsx"'},body:Buffer.from('PK-fixture-backend-workbook')});return;
      }
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
  await expect(page.getByText('Scroll sideways to view all columns.',{exact:true})).toBeVisible();
  const worksheet=page.getByRole('region',{name:'Scrollable worksheet',exact:true});
  await worksheet.focus();await page.keyboard.press('End');
  expect(await worksheet.evaluate(element=>element.scrollWidth>element.clientWidth)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:test.info().outputPath('inbound-export-mobile.png')});
});

test('Inbound Excel downloads backend workbook bytes and keeps client scope, retries and mobile layout',async({page})=>{
  const state=await receiptsFixture(page);await page.goto(base+'/inbound');
  const excel=page.getByRole('button',{name:'Export Excel',exact:true});
  await expect(excel).toBeEnabled();
  await page.getByRole('button',{name:'All clients',exact:true}).click();
  await page.getByRole('button',{name:'Beta',exact:true}).click();
  await expect.poll(()=>state.requests.at(-1)?.clientId).toBe('2');
  state.failure=503;await excel.click();
  await expect(page.getByRole('alert').filter({hasText:'Could not export receiving history'})).toBeVisible();
  state.failure=0;
  const event=page.waitForEvent('download');await excel.click();const file=await event;
  expect(file.suggestedFilename()).toBe('inbound-receipts.xlsx');
  const chunks=[];for await(const chunk of await file.createReadStream())chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toBe('PK-fixture-backend-workbook');
  expect(state.exports.at(-1)).toMatchObject({format:'xlsx',clientId:'2'});
  expect(state.exports.at(-1).page).toBeUndefined();
  await expect(page.getByText('Excel downloaded with all matching receipts. Dates are in UTC.')).toBeVisible();
  await page.setViewportSize({width:390,height:844});await expect(excel).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  state.empty=true;await page.getByRole('combobox',{name:'Filter by client'}).selectOption('1');
  await expect(excel).toBeDisabled();
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

test('A full receipt page does not create blank document space below the table',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await setup(page,url=>{
    if(!url.pathname.endsWith('/inbound/receipts'))return;
    return {data:Array.from({length:50},(_,index)=>({id:index+1,inventoryId:index+1,clientId:1,clientName:'Alpha',
      sku:`BOOK-${index+1}`,name:`Long product description for received book ${index+1}`,
      receivedUnits:20,receivedAt:'2026-09-01T00:00:00Z',note:`Opening balance source note for receipt ${index+1}`})),
      pagination:{page:1,pageSize:50,total:50,totalPages:1}};
  });
  await page.goto(base+'/inbound');
  const receipts=page.getByRole('region',{name:'Received inventory',exact:true}).getByRole('table');
  await expect(receipts.getByText('#50',{exact:true})).toBeAttached();
  const checkPageBounds=async()=>{
    const size=await page.evaluate(()=>({height:document.documentElement.scrollHeight,
      contentEnd:document.querySelector('main').getBoundingClientRect().bottom+scrollY,viewport:innerHeight}));
    expect(size.height,'Hidden receipt labels must stay inside the table scroll area').toBeLessThanOrEqual(Math.max(size.viewport,size.contentEnd)+40);
  };
  await checkPageBounds();
  await expect(receipts.getByRole('columnheader',{name:/Product description/})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Receiving worksheet',exact:true})).toBeVisible();
  const note=receipts.locator('summary[aria-label="View note for receipt #1"]');
  await note.focus();await page.keyboard.press('Enter');
  await expect(receipts.getByText('Opening balance source note for receipt 1',{exact:true})).toBeVisible();
  await checkPageBounds();
  await note.press('Enter');
  await page.setViewportSize({width:2388,height:1138});
  await checkPageBounds();
  await page.screenshot({path:test.info().outputPath('inbound-scroll-bounds.png'),fullPage:true});
});

test('Client users can drag every worksheet column in both directions and keep their own layout',async({page})=>{
  await page.setViewportSize({width:1800,height:1000});
  const state=await receiptsFixture(page,true);
  await page.addInitScript(()=>localStorage.setItem('prepship.tbl.inbound-receipts:other-user.v1',JSON.stringify({order:['note','receipt','sku'],hidden:['sku']})));
  await page.goto(base+'/inbound');
  const region=page.getByRole('region',{name:'Received inventory',exact:true});
  const headers=region.getByRole('columnheader');
  const header=name=>region.getByRole('columnheader').filter({has:page.getByRole('separator',{name:`Resize ${name} column`,exact:true})});
  const names=['SKU','Product description','Received units','Received','Receipt','Note'];
  await expect(headers).toHaveCount(6);
  await expect(headers.first()).toContainText('SKU');
  for(const name of names)await expect(header(name)).toHaveAttribute('draggable','true');
  const requestsBefore=state.requests.length;
  for(const name of ['Receipt','Note','Received','Received units','Product description','SKU']) {
    await header(name).dragTo(headers.first());
    await expect(headers.first()).toContainText(name);
  }
  await header('SKU').dragTo(headers.last());
  await expect(headers.last()).toContainText('SKU');
  await expect(region.locator('tbody tr').first().getByRole('cell').last()).toHaveText('SKU-A');
  await header('Receipt').dragTo(headers.first());
  await expect(region.locator('tbody tr').first().getByRole('cell').first()).toHaveText('#1');
  expect(state.requests.length).toBe(requestsBefore);
  const expected=await headers.allTextContents();
  await page.reload();
  await expect(headers).toHaveText(expected);
  await region.getByRole('button',{name:'Reset',exact:true}).click();
  await expect(headers.first()).toContainText('SKU');
  await expect(headers.last()).toContainText('Note');
  await expect(region.getByRole('button',{name:'Reset',exact:true})).toHaveCount(0);
});

test('Client worksheet column controls support keyboard and touch movement',async({page})=>{
  await receiptsFixture(page,true);await page.setViewportSize({width:390,height:844});
  await page.goto(base+'/inbound');
  const region=page.getByRole('region',{name:'Received inventory',exact:true});
  await region.getByRole('button',{name:/^Columns/}).click();
  const left=region.getByRole('button',{name:'Move Receipt left',exact:true});
  await left.focus();await page.keyboard.press('Enter');
  await expect(region.getByRole('columnheader').nth(3)).toContainText('Receipt');
  await region.getByRole('button',{name:'Move Receipt right',exact:true}).click();
  await expect(region.getByRole('columnheader').nth(4)).toContainText('Receipt');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
