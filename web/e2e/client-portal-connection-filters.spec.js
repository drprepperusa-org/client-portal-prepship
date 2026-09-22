import { expect, test } from '@playwright/test';
// Continuous card float is decorative; use the supported accessibility setting for stable clicks.
test.use({ contextOptions: { reducedMotion: 'reduce' } });
const base = 'http://127.0.0.1:5177';
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

const stores = [
  {id:1,clientId:1,label:'Alpha Main',provider:'shopify',connectionStatus:'active'},
  {id:2,clientId:1,label:'Alpha Pending',provider:'ebay',connectionStatus:'pending'},
  {id:3,clientId:1,label:'Alpha Reconnect',provider:'shopify',connectionStatus:'reconnect'},
  {id:4,clientId:2,label:'Beta Delayed',provider:'walmart',connectionStatus:'degraded'},
].map(row=>({...row,type:'store',assignedClientIds:[],storeIds:[],displayAccountIdentifier:'masked',
  createdAt:'2026-09-01',lastSyncedAt:null,updatedAt:null,reconnectReasonCode:null,clientName:null,storeName:null}));
function fixture(url) {
  if(!url.pathname.endsWith('/integrations'))return;
  const p=url.searchParams;
  return {data:stores.filter(r=>(!p.get('clientId')||r.clientId===Number(p.get('clientId')))
    &&(!p.get('search')||r.label.toLowerCase().includes(p.get('search').toLowerCase()))
    &&(!p.get('provider')||r.provider===p.get('provider'))
    &&(!p.get('status')||(p.get('status')==='attention'
      ? ['pending','reconnect','degraded'].includes(r.connectionStatus):r.connectionStatus===p.get('status'))))};
}
test('Connections combine store search, platform and attention filters with clear and empty states',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await setup(page,fixture);
  await page.goto(base+'/connections');
  await expect(page.getByRole('status').filter({hasText:'4 connections'})).toBeVisible();
  await page.getByLabel('Connection status',{exact:true}).selectOption('attention');
  await expect(page.getByRole('status').filter({hasText:'3 connections'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Rename Alpha Main',exact:true})).toHaveCount(0);
  await page.getByLabel('Platform',{exact:true}).selectOption('shopify');
  await expect(page.getByRole('status').filter({hasText:'1 connection'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Rename Alpha Reconnect',exact:true})).toBeVisible();
  await page.getByLabel('Search stores',{exact:true}).fill('missing');
  await expect(page.getByText('No matching connections',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'4 connections'})).toBeVisible();
  // Let the existing staggered card entrance finish before capturing visual evidence.
  await page.waitForTimeout(1000);
  await page.screenshot({path:test.info().outputPath('connections-desktop.png')});
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByLabel('Search stores',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Connection status',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:test.info().outputPath('connections-mobile.png')});
});
test('Changing client requests fresh scoped rows and closes the previous client editor',async({page})=>{
  await page.setViewportSize({width:1440,height:900});const requests=[];
  await setup(page,url=>{if(url.pathname.endsWith('/integrations'))requests.push(url);return fixture(url);});
  await page.goto(base+'/connections');
  await page.getByRole('button',{name:'All clients',exact:true}).click();
  await page.getByRole('button',{name:'Alpha',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'3 connections'})).toBeVisible();
  expect(requests.at(-1).searchParams.get('clientId')).toBe('1');
  await expect(page.getByRole('button',{name:'Rename Beta Delayed',exact:true})).toHaveCount(0);
  await expect(page.getByRole('dialog',{name:'Select client',exact:true})).toHaveCount(0);
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  await page.getByRole('button',{name:'Rename Alpha Main',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Rename store connection'})).toBeVisible();
  // The topbar remains mounted; simulate a global client change while a dialog is open.
  await page.getByRole('button',{name:'Alpha',exact:true}).first().dispatchEvent('click');
  await page.getByRole('button',{name:'Beta',exact:true}).dispatchEvent('click');
  await expect(page.getByRole('dialog',{name:'Rename store connection'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Rename Beta Delayed',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Rename Alpha Main',exact:true})).toHaveCount(0);
  expect(requests.at(-1).searchParams.get('clientId')).toBe('2');
});
test('Connections recover from read failure and discard a late search response',async({page})=>{
  await setup(page,fixture);let fail=true;
  await page.route('**/api/client-portal/integrations*',async route=>{
    if(fail){await route.fulfill({status:503,json:{error:'connections_unavailable'}});return;}
    const url=new URL(route.request().url());
    if(url.searchParams.get('search')==='Alpha')await new Promise(r=>setTimeout(r,1200));
    await route.fulfill({json:fixture(url)}).catch(()=>{});
  });
  await page.goto(base+'/connections');
  await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeVisible();fail=false;
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'4 connections'})).toBeVisible();
  const search=page.getByLabel('Search stores',{exact:true});await search.fill('Alpha');
  await page.waitForRequest(r=>new URL(r.url()).searchParams.get('search')==='Alpha');
  await search.fill('Beta');
  await expect(page.getByRole('button',{name:'Rename Beta Delayed',exact:true})).toBeVisible();
  await page.waitForTimeout(1300);
  await expect(page.getByRole('button',{name:'Rename Alpha Main',exact:true})).toHaveCount(0);
});
