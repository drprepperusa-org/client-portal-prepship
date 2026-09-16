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

const summary=(inventoryCount=105,connectionCount=3)=>({inventoryCount,connectionCount,
  totalCount:inventoryCount+connectionCount,checkedAt:'2026-09-16T12:00:00Z'});
const panel=page=>page.getByRole('region',{name:'Needs attention',exact:true});

test('Attention shows complete counts, navigates to filtered lists, and fits mobile',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await setup(page,url=>url.pathname.endsWith('/attention')?summary():undefined);
  await page.goto(base+'/connections');
  await expect(page.getByLabel('108 items need attention')).toHaveText('99+');
  await page.getByRole('button',{name:'Notifications',exact:true}).click();
  await expect(panel(page).getByText('Low or out of stock (105)',{exact:true})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('attention-desktop.png')});
  await Promise.all([
    page.waitForRequest(r=>r.url().includes('/integrations')&&new URL(r.url()).searchParams.get('status')==='attention'),
    panel(page).getByRole('link',{name:'View details: Connections need attention'}).click(),
  ]);
  await expect(page.getByRole('combobox',{name:'Connection status',exact:true})).toHaveValue('attention');
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  await page.getByRole('button',{name:'Notifications',exact:true}).click();
  await panel(page).getByRole('link',{name:'View details: Connections need attention'}).click();
  await expect(page.getByRole('combobox',{name:'Connection status',exact:true})).toHaveValue('attention');
  await page.getByRole('button',{name:'Notifications',exact:true}).click();
  await Promise.all([
    page.waitForRequest(r=>r.url().includes('/inventory?')&&new URL(r.url()).searchParams.get('lowStock')==='1'),
    panel(page).getByRole('link',{name:'View details: Low or out of stock'}).click(),
  ]);
  await expect(page).toHaveURL(/inventory\?lowStock=1/);
  await page.getByRole('button',{name:'History',exact:true}).click();
  await page.getByRole('button',{name:'Notifications',exact:true}).click();
  await panel(page).getByRole('link',{name:'View details: Low or out of stock'}).click();
  await expect(page.getByRole('checkbox',{name:'Low/Out only'})).toBeChecked();
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Notifications',exact:true}).click();
  await expect(panel(page)).toBeVisible();
  const box=await panel(page).boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);
  await page.screenshot({path:test.info().outputPath('attention-mobile.png')});
  await page.keyboard.press('Escape');await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Notifications',exact:true})).toBeFocused();
});

test('Attention handles errors, fresh zero counts and retry without exposing server details',async({page})=>{
  await setup(page);let fail=true,empty=false;
  await page.route('**/api/client-portal/attention*',route=>route.fulfill(fail
    ?{status:503,json:{error:'private_database_details'}}:{json:empty?summary(0,0):summary()}));
  await page.goto(base+'/connections');await page.getByRole('button',{name:'Notifications',exact:true}).click();
  await expect(panel(page).getByText('Attention items are unavailable. Please retry.')).toBeVisible();
  await expect(page.getByText('No items need attention.')).toHaveCount(0);
  await expect(page.getByText('private_database_details')).toHaveCount(0);
  fail=false;await panel(page).getByRole('button',{name:'Retry notifications'}).click();
  await expect(page.getByLabel('108 items need attention')).toBeVisible();
  fail=true;await panel(page).getByRole('button',{name:'Refresh notifications'}).click();
  await expect(panel(page).getByRole('button',{name:'Retry notifications'})).toBeVisible();
  await expect(page.getByLabel('108 items need attention')).toHaveCount(0);
  fail=false;empty=true;await panel(page).getByRole('button',{name:'Retry notifications'}).click();
  await expect(panel(page).getByText('No items need attention.')).toBeVisible();
  await expect(panel(page).getByRole('link')).toHaveCount(0);
});

test('Attention isolates client changes and ignores a late previous-client response',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await setup(page);
  await page.route('**/api/client-portal/attention*',async route=>{
    const id=new URL(route.request().url()).searchParams.get('clientId');
    if(id==='1')await new Promise(r=>setTimeout(r,1200));
    await route.fulfill({json:id==='2'?summary(1,0):summary()}).catch(()=>{});
  });
  await page.goto(base+'/connections');await expect(page.getByLabel('108 items need attention')).toBeVisible();
  await page.getByRole('button',{name:'All clients',exact:true}).click();
  await Promise.all([page.waitForRequest(r=>r.url().includes('/attention?clientId=1')),
    page.getByRole('button',{name:'Alpha',exact:true}).click()]);
  await expect(page.getByLabel('108 items need attention')).toHaveCount(0);
  await page.getByRole('button',{name:'Alpha',exact:true}).first().click();
  await page.getByRole('button',{name:'Beta',exact:true}).click();
  await expect(page.getByLabel('1 items need attention')).toBeVisible();
  await page.waitForTimeout(1400);
  await page.getByRole('button',{name:'Notifications',exact:true}).click();
  await expect(panel(page).getByText('Low or out of stock (1)',{exact:true})).toBeVisible();
  await expect(panel(page).getByText('Connections need attention',{exact:false})).toHaveCount(0);
  await Promise.all([page.waitForRequest(r=>r.url().includes('/inventory?')&&new URL(r.url()).searchParams.get('clientId')==='2'),
    panel(page).getByRole('link',{name:'View details: Low or out of stock'}).click()]);
});
