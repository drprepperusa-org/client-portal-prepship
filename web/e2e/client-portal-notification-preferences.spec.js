import { expect, test } from '@playwright/test';
const base = 'http://127.0.0.1:5177';
test.use({ reducedMotion: 'reduce' });
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

function state() { return { saved:{connectionIssues:true,lowStock:true}, failRead:false,failSave:false,writes:[] }; }
async function install(page, shared) {
  await setup(page,url=>url.pathname.endsWith('/me')?{id:'sort-test',isAdmin:false,isGlobal:false,
    canManageUsers:false,canManageAdmins:false,canViewAudit:false,clientIds:[1],storeIds:[]}:undefined);
  await page.route('**/api/client-portal/notification-preferences',async route=>{
    if(route.request().method()==='PUT') {
      shared.writes.push(route.request().postDataJSON());
      if(shared.failSave){await route.fulfill({status:503,json:{error:'private_save_error'}});return;}
      shared.saved=route.request().postDataJSON();
    } else if(shared.failRead){await route.fulfill({status:503,json:{error:'private_read_error'}});return;}
    await route.fulfill({json:shared.saved});
  });
  await page.route('**/api/client-portal/attention*',route=>{
    const inventoryCount=shared.saved.lowStock?5:0,connectionCount=shared.saved.connectionIssues?2:0;
    return route.fulfill({json:{inventoryCount,connectionCount,totalCount:inventoryCount+connectionCount,
      checkedAt:'2026-09-16T12:00:00Z',preferences:shared.saved}});
  });
}

test('Personal settings save to the account, control the bell and persist in a second browser context',async({page,browser})=>{
  const shared=state();await install(page,shared);await page.goto(base+'/settings/notifications');
  await expect(page).toHaveURL(/settings\/notifications/);
  await expect(page.getByRole('switch')).toHaveCount(2);
  await expect(page.getByRole('switch',{name:'Low-stock alerts',exact:true})).toHaveAttribute('aria-checked','true');
  await expect(page.getByRole('button',{name:'Save preferences'})).toBeDisabled();
  await expect(page.getByText('Weekly performance digest')).toHaveCount(0);
  await page.getByRole('switch',{name:'Low-stock alerts',exact:true}).click();
  await page.getByRole('button',{name:'Save preferences'}).click();
  await expect(page.getByText('Preferences saved',{exact:true})).toBeVisible();
  expect(shared.writes).toEqual([{connectionIssues:true,lowStock:false}]);
  await expect(page.getByLabel('2 items need attention')).toBeVisible();
  await page.getByRole('button',{name:'Notifications',exact:true}).click();
  const bell=page.getByRole('region',{name:'Needs attention',exact:true});
  await expect(bell.getByRole('link',{name:'View details: Low or out of stock'})).toHaveCount(0);
  await page.keyboard.press('Escape');
  const context=await browser.newContext();const second=await context.newPage();
  try {
    await install(second,shared);await second.goto(base+'/settings/notifications');
    await expect(second.getByRole('switch',{name:'Low-stock alerts'})).toHaveAttribute('aria-checked','false');
    await second.getByRole('switch',{name:'Connection issues'}).click();
    await second.getByRole('button',{name:'Save preferences'}).click();
    await expect(second.getByText('Preferences saved',{exact:true})).toBeVisible();
    await page.reload();
    await expect(page.getByRole('switch',{name:'Connection issues'})).toHaveAttribute('aria-checked','false');
    await page.getByRole('button',{name:'Notifications',exact:true}).click();
    await expect(bell.getByText('No notifications.',{exact:true})).toBeVisible();
    await expect(page.getByLabel('2 items need attention')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.setViewportSize({width:390,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.screenshot({path:test.info().outputPath('notification-settings-mobile.png')});
  } finally {await context.close();}
});

test('Settings never show a false save success, retain drafts after failure and retry failed reads',async({page})=>{
  const shared=state();shared.failRead=true;await install(page,shared);await page.goto(base+'/settings/notifications');
  await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeVisible();
  await expect(page.getByRole('switch')).toHaveCount(0);
  shared.failRead=false;await page.getByRole('button',{name:'Retry',exact:true}).click();
  await page.getByRole('switch',{name:'Connection issues'}).click();shared.failSave=true;
  await page.getByRole('button',{name:'Save preferences'}).click();
  await expect(page.getByRole('alert').filter({hasText:'Could not save your preferences'})).toBeVisible();
  await expect(page.getByText('Preferences saved',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('switch',{name:'Connection issues'})).toHaveAttribute('aria-checked','false');
  expect(shared.saved.connectionIssues).toBe(true);
  await expect(page.getByText('private_save_error')).toHaveCount(0);
  shared.failSave=false;await page.getByRole('button',{name:'Save preferences'}).click();
  await expect(page.getByText('Preferences saved',{exact:true})).toBeVisible();
  await expect(page.getByLabel('5 items need attention')).toBeVisible();
});
