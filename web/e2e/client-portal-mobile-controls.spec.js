import { expect, test } from '@playwright/test';
const base = 'http://127.0.0.1:5177';
test.use({ contextOptions: { reducedMotion: 'reduce' } });
async function setup(page, custom) {
  const state = {requests:[],clientsFailed:false};
  const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const user={id:'sort-test',aud:'authenticated',role:'authenticated',email:'sort@portal-e2e.test',app_metadata:{role:'admin',permissions:['scope:global']},user_metadata:{}};
  const token=[encode({alg:'HS256',typ:'JWT'}),encode({...user,sub:user.id,exp:4102444800}),'fixture'].join('.');
  await page.addInitScript(session=>localStorage.setItem('sb-portal-e2e-auth-token',JSON.stringify(session)),{
    access_token:token,refresh_token:'fixture',expires_at:4102444800,expires_in:2147483647,token_type:'bearer',user,
  });
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.startsWith('/api/client-portal/')) {
      if (url.pathname.endsWith('/clients') && state.clientsFailed) { await route.fulfill({status:503,json:{error:'Unavailable'}}); return; }
      state.requests.push({name:url.pathname.split('/').at(-1),...Object.fromEntries(url.searchParams)});
      const extra=await custom?.(url);
      let body=extra??{data:[],pagination:{page:1,pageSize:50,total:0,totalPages:1}};
      if(extra===undefined && url.pathname.endsWith('/audit-log'))body={data:[],filters:{stores:[],users:[],clients:[]},pagination:{page:1,pageSize:100,hasMore:false}};
      if(extra===undefined && url.pathname.endsWith('/me'))body={...user,isAdmin:true,isGlobal:true,isRestricted:false,canViewFinancials:true,canViewAudit:true,clientIds:[],storeIds:[]};
      if(extra===undefined && url.pathname.endsWith('/clients'))body={data:[{id:1,name:'Alpha'},{id:2,name:'Beta'}]};
      if(extra===undefined && url.pathname.endsWith('/sync-status'))body={status:'ok',lastSyncAt:null};
      if(extra===undefined && url.pathname.endsWith('/awaiting-active-count'))body={count:102};
      await route.fulfill({json:body}); return;
    }
    if(url.origin===base){await route.continue();return;}
    await route.abort();
  });
  return state;
}
const picker = page => page.getByRole('dialog', {name:'Select client',exact:true});
const dates = page => page.getByRole('dialog', {name:'Date range',exact:true});

for (const width of [320,390,640,768,1024,1440]) {
  test(`Client controls work at ${width}px without header or dialog overflow`,async({page})=>{
    await page.setViewportSize({width,height:844}); const state=await setup(page);
    await page.goto(base+'/orders');
    const trigger=page.getByRole('banner').getByRole('button',{name:'All clients',exact:true});
    await expect(trigger).toBeVisible();
    await expect(page.getByRole('button',{name:'Date range filter'})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    const header=page.getByRole('banner');
    expect(await header.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await trigger.click(); await expect(picker(page)).toBeVisible();
    expect(await picker(page).evaluate(el=>el.getBoundingClientRect().left>=0 && el.getBoundingClientRect().right<=innerWidth)).toBe(true);
    await picker(page).getByRole('button',{name:'Beta',exact:true}).click();
    await expect(picker(page)).toHaveCount(0);
    await expect.poll(()=>state.requests.filter(r=>r.name==='orders').at(-1)?.clientId).toBe('2');
    await expect(page.getByRole('banner').getByRole('button',{name:'Beta',exact:true})).toBeFocused();
    await page.getByRole('banner').getByRole('button',{name:'Beta',exact:true}).click();
    await expect(picker(page).getByRole('button',{name:'Beta',exact:true})).toHaveAttribute('aria-pressed','true');
    await picker(page).getByRole('button',{name:'All clients',exact:true}).click();
    await expect(page.getByRole('banner').getByRole('button',{name:'All clients',exact:true})).toBeVisible();
    await expect(picker(page)).toHaveCount(0);
    if(width===390 || width===1440) await page.screenshot({path:test.info().outputPath(`mobile-controls-${width}.png`)});
  });
}

for (const width of [320,1440]) {
  test(`Date Apply and Cancel preserve explicit range intent at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:740});
    await page.clock.setFixedTime(new Date('2026-09-22T12:00:00Z'));
    const state=await setup(page); await page.goto(base+'/orders');
    const trigger=page.getByRole('button',{name:'Date range filter'});
    await trigger.click();
    await dates(page).getByRole('button',{name:'Last 7 days',exact:true}).click();
    await expect(dates(page).getByLabel('FROM',{exact:true})).toHaveValue('2026-09-16');
    await dates(page).getByRole('button',{name:'Cancel',exact:true}).click();
    await expect(trigger).toBeFocused(); await trigger.click();
    await expect(dates(page).getByLabel('FROM',{exact:true})).toHaveValue('2026-08-24');
    await dates(page).getByLabel('FROM',{exact:true}).fill('2026-09-01');
    await dates(page).getByLabel('TO',{exact:true}).fill('2026-09-10');
    await dates(page).getByRole('button',{name:'Apply',exact:true}).click();
    await expect(dates(page)).toHaveCount(0);
    await expect.poll(()=>state.requests.filter(r=>r.name==='dashboard').at(-1)).toMatchObject({
      dateFrom:'2026-09-01T00:00:00.000Z',dateTo:'2026-09-10T23:59:59.999Z'});
    await trigger.click();
    await expect(dates(page).getByLabel('FROM',{exact:true})).toHaveValue('2026-09-01');
    await dates(page).getByRole('button',{name:'Today',exact:true}).click();
    await page.keyboard.press('Escape'); await trigger.click();
    await expect(dates(page).getByLabel('TO',{exact:true})).toHaveValue('2026-09-10');
    expect(await dates(page).evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await expect(dates(page)).toHaveCSS('opacity','1');
    await page.screenshot({path:test.info().outputPath(`date-picker-${width}.png`)});
  });
}

test('Long client list scrolls, wraps names, traps focus, and restores page scrolling',async({page})=>{
  await page.setViewportSize({width:320,height:568});
  const longName='VeryLongClientNameWithoutSpaces'.repeat(5);
  await setup(page,url=>url.pathname.endsWith('/clients')?{data:Array.from({length:40},(_,i)=>({id:i+1,name:i===39?longName:`Client ${i+1}`}))}:undefined);
  await page.goto(base+'/search'); const trigger=page.getByRole('button',{name:'All clients',exact:true});
  await trigger.click(); await expect(picker(page)).toBeVisible();
  await expect(picker(page).getByRole('button',{name:'Close',exact:true})).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(picker(page).getByRole('button',{name:longName,exact:true})).toBeFocused();
  expect(await picker(page).evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  expect(await page.evaluate(()=>document.body.style.overflow)).toBe('hidden');
  await page.screenshot({path:test.info().outputPath('long-client-mobile.png')});
  await page.keyboard.press('Escape'); await expect(picker(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
});

test('Unavailable client list exposes retry instead of a working-looking selector',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const state=await setup(page);state.clientsFailed=true;
  await page.goto(base+'/search');
  const retry=page.getByRole('button',{name:'Client list unavailable. Retry.',exact:true});
  await expect(retry).toBeVisible();
  await expect(page.getByRole('button',{name:'All clients',exact:true})).toHaveCount(0);
  state.clientsFailed=false; await retry.click();
  await expect(page.getByRole('button',{name:'All clients',exact:true})).toBeVisible();
  await expect(retry).toHaveCount(0);
});

test('Search, Inbound and Audit keep their date exclusions; navigation remains usable',async({page})=>{
  await page.setViewportSize({width:390,height:844}); await setup(page);
  for (const path of ['/search','/inbound','/audit-log']) {
    await page.goto(base+path);
    await expect(page.getByRole('button',{name:'All clients',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Date range filter'})).toHaveCount(0);
    await page.getByRole('button',{name:'Open menu',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'Navigation',exact:true})).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog',{name:'Navigation',exact:true})).toHaveCount(0);
  }
});
