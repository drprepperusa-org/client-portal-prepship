import { expect, test } from '@playwright/test';
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

const services={pickPackFee:'2.50',includedUnits:3,additionalUnitFee:'0.75',storageFeePerCuFt:'0.1234',updatedAt:'2026-09-01T12:00:00Z'};
const sheets=[
  {clientId:1,clientName:'Alpha',configurationStatus:'configured',services,
    packages:[
      {packageId:11,name:'Small box',dimensions:'7 × 4 × 2 in',configuredPrice:'0.20',updatedAt:'2026-09-05T12:00:00Z'},
      {packageId:12,name:'Medium box',dimensions:'10 × 8 × 4 in',configuredPrice:'0.35',updatedAt:'2026-09-06T12:00:00Z'},
    ]},
  {clientId:2,clientName:'Beta',configurationStatus:'inactive',services:{...services,pickPackFee:'9.99'},packages:[]},
  {clientId:3,clientName:'Missing rates',configurationStatus:'not_configured',services:null,packages:[]},
  {clientId:4,clientName:'Zero rates',configurationStatus:'configured',services:{...services,pickPackFee:'0.00'},packages:[]},
];
function fixture(url){
 if(!url.pathname.endsWith('/rate-sheet'))return;
 const id=url.searchParams.get('clientId');return {data:sheets.filter(s=>!id||s.clientId===Number(id))};
}
test('Rate Sheet renders exact prices, precision, dates and missing/zero/inactive states on desktop and mobile',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});const requests=[];
 await setup(page,url=>{if(url.pathname.endsWith('/rate-sheet'))requests.push(url);return fixture(url);});
 await page.goto(base+'/rates');
 await expect(page.getByRole('button',{name:'Collapse rates for Alpha'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Expand rates for Beta'})).toBeVisible();
 await expect(page.getByText('$2.50',{exact:true})).toBeVisible();
 await expect(page.getByText('$0.1234',{exact:true}).first()).toBeVisible();
 await page.getByRole('button',{name:'Expand rates for Beta'}).click();
 await expect(page.getByText('Billing is inactive for this client.',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Expand rates for Missing rates'}).click();
 await expect(page.getByText('A missing rate does not mean the service is free.',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Expand rates for Zero rates'}).click();
 await expect(page.getByText('$0.00',{exact:true})).toBeVisible();
 await expect(page.getByText('Service rates updated Sep 1, 2026',{exact:true}).first()).toBeVisible();
 await expect(page.getByText('Configured box prices before billing adjustments.',{exact:false}).first()).toBeVisible();
 const packageSearch=page.getByRole('combobox',{name:'Find packaging for Alpha'});
 await expect(packageSearch).toHaveAttribute('list',/.+/);
 await packageSearch.fill('Medium');
 await expect(page.getByRole('cell',{name:'Medium box',exact:false})).toBeVisible();
 await expect(page.getByRole('cell',{name:'Small box',exact:false})).toHaveCount(0);
 await packageSearch.fill('mailer');
 await expect(page.getByText('No packaging matches “mailer”.',{exact:true})).toBeVisible();
 await packageSearch.fill('');
 await page.getByRole('button',{name:'Collapse rates for Alpha'}).click();
 await expect(page.getByText('$2.50',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Expand rates for Alpha'}).click();
 await page.getByRole('button',{name:'All clients',exact:true}).click();
 await page.getByRole('button',{name:'Alpha',exact:true}).click();
 await expect(page.getByText('$9.99',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Alpha',exact:true})).toBeVisible();
 expect(requests.at(-1).searchParams.get('clientId')).toBe('1');
 expect(requests.at(-1).searchParams.has('dateFrom')).toBe(false);
 await expect(page.getByRole('cell',{name:'$0.20',exact:true})).toBeVisible();
 await page.screenshot({path:test.info().outputPath('rate-sheet-desktop.png')});
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:test.info().outputPath('rate-sheet-mobile.png'),fullPage:true});
});
test('Rate Sheet does not request or render pricing without financial permission',async({page})=>{
 const requests=[];
 await setup(page,url=>{
   if(url.pathname.endsWith('/me'))return {id:'sort-test',isAdmin:false,canViewFinancials:false,clientIds:[1],storeIds:[]};
   if(url.pathname.endsWith('/rate-sheet'))requests.push(url);
   return fixture(url);
 });
 await page.goto(base+'/rates');
 await expect(page.getByText('Financial access required',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Refresh rates'})).toBeDisabled();
 expect(requests).toHaveLength(0);await expect(page.getByText('$2.50',{exact:true})).toHaveCount(0);
});
test('Rate Sheet retries errors, refreshes saved rates and rejects late client responses',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await setup(page,fixture);
 let fail=true,refreshed=false,slowAlpha=false;
 await page.route('**/api/client-portal/rate-sheet*',async route=>{
   if(fail){await route.fulfill({status:503,json:{error:'private_database_error'}});return;}
   const url=new URL(route.request().url());
   if(slowAlpha&&url.searchParams.get('clientId')==='1')await new Promise(r=>setTimeout(r,1500));
   const body=fixture(url);
   if(refreshed)body.data=body.data.map(r=>r.services?{...r,services:{...r.services,pickPackFee:'2.75'}}:r);
   await route.fulfill({json:body}).catch(()=>{});
 });
 await page.goto(base+'/rates');
 await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeVisible();
 await expect(page.getByText('private_database_error')).toHaveCount(0);fail=false;
 await page.getByRole('button',{name:'Retry',exact:true}).click();
 await expect(page.getByText('$2.50',{exact:true})).toBeVisible();
 refreshed=true;await page.getByRole('button',{name:'Refresh rates'}).click();
 await expect(page.getByText('$2.75',{exact:true}).first()).toBeVisible();
 slowAlpha=true;await page.getByRole('button',{name:'All clients',exact:true}).click();
 await Promise.all([
   page.waitForRequest(r=>r.url().includes('/rate-sheet?clientId=1')),
   page.getByRole('button',{name:'Alpha',exact:true}).click(),
 ]);
 await expect(page.getByRole('heading',{name:'Zero rates',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Alpha',exact:true}).first().click();
 await page.getByRole('button',{name:'Beta',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Beta',exact:true})).toBeVisible();
 await page.waitForTimeout(1600);
 await expect(page.getByRole('heading',{name:'Alpha',exact:true})).toHaveCount(0);
 await page.route('**/api/client-portal/rate-sheet*',route=>route.fulfill({json:{data:[]}}));
 await page.getByRole('button',{name:'Refresh rates'}).click();
 await expect(page.getByText('No rate sheets for this client selection',{exact:true})).toBeVisible();
});
