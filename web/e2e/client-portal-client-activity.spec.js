import { expect, test } from '@playwright/test';
const base = 'http://127.0.0.1:5177';
test.use({ reducedMotion: 'reduce' });
async function setup(page, custom, admin = true) {
  const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const user={id:'sort-test',aud:'authenticated',role:'authenticated',email:'sort@portal-e2e.test',app_metadata:{role:admin?'admin':'client_user',permissions:admin?['scope:global']:[],clientIds:admin?[]:[1]},user_metadata:{}};
  const token=[encode({alg:'HS256',typ:'JWT'}),encode({...user,sub:user.id,exp:4102444800}),'fixture'].join('.');
  await page.addInitScript(session=>localStorage.setItem('sb-portal-e2e-auth-token',JSON.stringify(session)),{
    access_token:token,refresh_token:'fixture',expires_at:4102444800,expires_in:2147483647,token_type:'bearer',user,
  });
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(!admin && url.pathname.endsWith('/dashboard')) { await route.fulfill({status:503,json:{error:'fixture dashboard unavailable'}}); return; }
    if(url.pathname.startsWith('/api/client-portal/')) {
      const extra=await custom?.(url);
      let body=extra??{data:[],pagination:{page:1,pageSize:50,total:0,totalPages:1}};
      if(extra===undefined && url.pathname.endsWith('/me'))body={...user,isAdmin:admin,isGlobal:admin,isRestricted:!admin,canViewFinancials:true,canViewAudit:admin,clientIds:[],storeIds:[]};
      if(extra===undefined && url.pathname.endsWith('/clients'))body={data:[{id:1,name:'Alpha'},{id:2,name:'Beta'}]};
      if(extra===undefined && url.pathname.endsWith('/sync-status'))body={status:'ok',lastSyncAt:null};
      if(extra===undefined && url.pathname.endsWith('/awaiting-active-count'))body={count:102};
      await route.fulfill({json:body}); return;
    }
    if(url.origin===base){await route.continue();return;}
    await route.abort();
  });
}


const window = {dateFrom:'2026-08-23T12:00:00.000Z',dateTo:'2026-09-22T12:00:00.000Z',days:30};
const action={id:99,actorEmail:'client-alpha@example.test',actorUserId:'client-alpha',createdAt:'2026-09-20T12:00:00Z',
  activity:{category:'Action',outcome:'Requested',label:'Replacement: requested',summary:'Requested replacement for order 4002.',
    note:'This records a request, not completion.',details:[]}};
const payload={data:[{clientId:7,clientName:'Alpha',active:true,latestEvent:action,recentActions:[action],failedCount:125,deniedCount:3},
  {clientId:8,clientName:'No history',active:false,latestEvent:null,recentActions:[],failedCount:0,deniedCount:0}],
  window,pagination:{page:1,pageSize:25,hasMore:true}};
async function fixture(page,admin=true) {
  const state={requests:[],audit:[],csv:[],fail:false,hold:false};
  await setup(page,url=>{
    if(url.pathname.endsWith('/audit-log')) {
      state.audit.push(Object.fromEntries(url.searchParams));
      return {data:[],filters:{stores:[],users:[],clients:[{id:7,name:'Alpha'},{id:8,name:'No history'}]},
        pagination:{page:1,pageSize:100,hasMore:false}};
    }
  },admin);
  await page.route('**/api/client-portal/audit-log/client-activity?*',async route=>{
    const params=Object.fromEntries(new URL(route.request().url()).searchParams);state.requests.push(params);
    if(state.hold) await new Promise(resolve=>state.release=resolve);
    if(state.fail){await route.fulfill({status:503,json:{error:'unavailable'}});return;}
    await route.fulfill({json:params.search==='missing'?{...payload,data:[]}:
      params.page==='2'?{...payload,data:[{...payload.data[1],clientName:'Page two'}],pagination:{...payload.pagination,page:2,hasMore:false}}:payload});
  });
  await page.route('**/api/client-portal/audit-log?*format=csv*',async route=>{
    state.csv.push(Object.fromEntries(new URL(route.request().url()).searchParams));
    await route.fulfill({contentType:'text/csv',headers:{'Content-Disposition':'attachment; filename="audit.csv"'},body:'backend audit CSV'});
  });
  return state;
}
const overview=page=>page.getByRole('region',{name:'Client activity overview'});

test('Client overview renders backend facts and opens exact client/date history and CSV',async({page})=>{
  const state=await fixture(page);await page.goto(base+'/audit-log');
  await expect(page.getByRole('button',{name:'View client activity',exact:true})).toBeVisible();
  expect(state.requests).toHaveLength(0);
  await page.getByRole('button',{name:'View client activity',exact:true}).click();
  const panel=overview(page);
  await expect(panel.getByText('Failed events: 125',{exact:true})).toBeVisible();
  await expect(panel.getByText('Denied events: 3',{exact:true})).toBeVisible();
  await expect(panel.getByText('No recorded activity in this period.',{exact:true})).toBeVisible();
  await expect(panel.getByText('Action · Requested',{exact:true})).toHaveCount(2);
  const link=panel.getByRole('link',{name:'Audit history for Alpha'});
  await expect(link).toHaveAttribute('href',/clientId=7/);
  await page.screenshot({path:test.info().outputPath('client-activity-desktop.png')});
  await link.click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('combobox',{name:'Filter audit log by client'})).toHaveValue('7');
  await expect.poll(()=>state.audit.at(-1)).toMatchObject({clientId:'7',dateFrom:window.dateFrom,dateTo:window.dateTo,hideBackground:'true'});
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export CSV',exact:true}).click();await download;
  expect(state.csv.at(-1)).toMatchObject({clientId:'7',dateFrom:window.dateFrom,dateTo:window.dateTo});
  await page.reload();
  await expect(page.getByRole('combobox',{name:'Filter audit log by client'})).toHaveValue('7');
  await page.getByRole('button',{name:'View client activity',exact:true}).click();
  await panel.getByRole('link',{name:'Failed events for Alpha'}).click();
  await expect.poll(()=>state.audit.at(-1)).toMatchObject({clientId:'7',activity:'failed',hideBackground:'true'});
  await page.getByRole('combobox',{name:'Filter audit log by client'}).selectOption('');
  await expect.poll(()=>state.audit.at(-1).clientId).toBeUndefined();
});

test('Client search, period and pagination are server requests and stay inside mobile width',async({page})=>{
  const state=await fixture(page);await page.goto(base+'/audit-log');
  await page.getByRole('button',{name:'View client activity',exact:true}).click();
  const panel=overview(page);
  await panel.getByRole('button',{name:'More clients',exact:true}).click();
  await expect(panel.getByRole('heading',{name:'Page two (Inactive)',exact:true})).toBeVisible();
  await expect.poll(()=>state.requests.at(-1).page).toBe('2');
  await panel.getByRole('combobox',{name:'Client activity period'}).selectOption('7');
  await expect.poll(()=>state.requests.at(-1)).toMatchObject({page:'1',days:'7'});
  await panel.getByRole('textbox',{name:'Search activity clients'}).fill('missing');
  await expect(panel.getByText('No clients match this search.')).toBeVisible();
  expect(state.requests.at(-1)).toMatchObject({page:'1',search:'missing'});
  await panel.getByRole('textbox',{name:'Search activity clients'}).fill('');
  await expect(panel.getByText('Failed events: 125',{exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:test.info().outputPath('client-activity-mobile.png')});
});

test('Loading and failed refresh never appear as confirmed zero activity and retry recovers',async({page})=>{
  const state=await fixture(page);state.hold=true;await page.goto(base+'/audit-log');
  await page.getByRole('button',{name:'View client activity',exact:true}).click();
  const panel=overview(page);
  await expect(panel.getByText('Loading client activity…')).toBeVisible();
  await expect(panel.getByText('Failed events: 0',{exact:true})).toHaveCount(0);
  state.hold=false;state.release();
  await expect(panel.getByText('Failed events: 125',{exact:true})).toBeVisible();
  state.fail=true;
  await panel.getByRole('button',{name:'Refresh client activity'}).click();
  await expect(panel.getByRole('alert')).toContainText('Client activity unavailable',{timeout:15000});
  await expect(panel.getByText('Failed events: 125',{exact:true})).toHaveCount(0);
  await expect(panel.getByText('No recorded activity in this period.')).toHaveCount(0);
  state.fail=false;await panel.getByRole('button',{name:'Retry client activity'}).click();
  await expect(panel.getByText('Failed events: 125',{exact:true})).toBeVisible();
});

test('Non-admin cannot open the overview or fetch its data',async({page})=>{
  const state=await fixture(page,false);await page.goto(base+'/audit-log');
  await expect(page.getByRole('button',{name:'View client activity',exact:true})).toHaveCount(0);
  await expect(page).toHaveURL(base+'/');
  await expect(page.getByRole('link',{name:'Audit log',exact:true})).toHaveCount(0);
  expect(state.requests).toHaveLength(0);
});
