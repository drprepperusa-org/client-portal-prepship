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

const sku = n => ({sku:`SKU-${String(n).padStart(3,'0')}`,name:`Item ${n}`,inv_sku_id:n,client_id:1,
  client_name:'Alpha',image_url:null,orders:1,pending:0,total_qty:1,total_revenue:'2',daily_qty:[1]});
function fixture(url) {
  if (url.pathname !== '/api/client-portal/analysis') return;
  const p = Number(url.searchParams.get('page') || 1), pageSize = Number(url.searchParams.get('pageSize') || 50);
  const search = url.searchParams.get('search') || '';
  let rows = Array.from({length:211},(_,i)=>sku(i+1));
  if (search) rows=rows.filter(r=>`${r.sku} ${r.name}`.toLowerCase().includes(search.toLowerCase()));
  if(url.searchParams.get('sortKey')==='sku'&&url.searchParams.get('sortDir')==='desc')rows.reverse();
  return {data:rows.slice((p-1)*pageSize,p*pageSize),topSkus:[sku(211)],dateBuckets:['2026-09-14'],
    totalSkus:211,totalOrders:420,totalUnits:420,totalRevenue:840,orderCombinations:[],
    pagination:{page:p,pageSize,total:rows.length,totalPages:Math.max(1,Math.ceil(rows.length/pageSize))}};
}
function drawerFixture(url) {
  if(url.pathname!=='/api/client-portal/analysis/sku-orders')return;
  const p=Number(url.searchParams.get('page')||1), pageSize=Number(url.searchParams.get('pageSize')||50);
  return {sku:'SKU-001',name:'Item 1',totalUnits:210,averageUnitsPerDay:7,avgShippingStandard:'2',avgShippingExpedited:'0',
    dailySales:[{day:'2026-09-14',units:210}],orders:Array.from({length:Math.min(pageSize,210-(p-1)*pageSize)},(_,i)=>({
      order_id:(p-1)*pageSize+i+1,order_number:`ORDER-${(p-1)*pageSize+i+1}`,order_date:'2026-09-14',order_status:'shipped',
      ship_to_name:'Fixture',qty:1,item_name:'Item',unit_price:'2',shippingTotal:'2',shippingReconciled:null,
      shippingStandard:'2',shippingExpedited:'0',shippingMoneyState:'attributed'})),
    pagination:{page:p,pageSize,total:210,totalPages:Math.ceil(210/pageSize)}};
}
test('Analysis searches all SKUs and resets pages while full-period cards and chart remain stable',async({page})=>{
  await page.setViewportSize({width:1440,height:900});const requests=[];
  await setup(page,url=>{if(url.pathname.endsWith('/analysis'))requests.push(url);return fixture(url);});
  await page.goto(base+'/analysis');
  await expect(page.getByText('1–50 of 211',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Next page',exact:true}).click();
  await expect(page.getByText('51–100 of 211',{exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:'Search Analysis SKUs'}).fill('SKU-210');
  await expect(page.getByRole('button',{name:'View SKU details for SKU-210'})).toBeVisible();
  await expect(page.getByText('1–1 of 1',{exact:true})).toBeVisible();
  expect(requests.at(-1).searchParams.get('page')).toBe('1');
  await expect(page.getByText('$840.00',{exact:true})).toBeVisible();
  await expect(page.getByText('211',{exact:true})).toBeVisible();
  // The chart legend retains the server's top SKU, independently of search.
  await expect(page.getByText('SKU-211',{exact:true}).first()).toBeVisible();
  await page.getByRole('textbox',{name:'Search Analysis SKUs'}).fill('missing');
  await expect(page.getByText('No matching SKUs',{exact:true})).toBeVisible();
  await expect(page.getByText('$840.00',{exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:'Search Analysis SKUs'}).fill('');
  const table=page.locator('table').filter({has:page.getByRole('button',{name:'SKU',exact:true})});
  await table.getByRole('button',{name:'SKU',exact:true}).click();
  await table.getByRole('button',{name:'SKU',exact:true}).click();
  await expect(table.locator('tbody tr').first()).toContainText('SKU-211');
  await page.getByRole('button',{name:'Next page',exact:true}).click();
  await expect(table.locator('tbody tr').first()).toContainText('SKU-161');
  await page.screenshot({path:test.info().outputPath('analysis-desktop.png')});
});
test('Analysis SKU orders use selected dates/client and reach later pages on desktop and mobile',async({page})=>{
  await page.setViewportSize({width:1440,height:900});const requests=[];
  await setup(page,url=>{requests.push(url);return fixture(url)??drawerFixture(url);});
  await page.goto(base+'/analysis');
  await page.getByRole('button',{name:'All clients',exact:true}).click();
  await page.getByRole('button',{name:'Alpha',exact:true}).click();
  await page.getByRole('button',{name:'Date range filter',exact:true}).click();
  await page.getByRole('button',{name:'Last 7 days',exact:true}).click();
  await page.getByRole('button',{name:'Apply',exact:true}).click();
  await page.getByRole('button',{name:'View SKU details for SKU-001'}).click();
  const drawer=page.getByRole('dialog',{name:'Item 1',exact:true});
  await expect(drawer.getByText('Orders in selected period (210)')).toBeVisible();
  const detail=requests.findLast(u=>u.pathname.endsWith('/sku-orders'));
  const list=requests.findLast(u=>u.pathname.endsWith('/analysis'));
  for(const key of ['dateFrom','dateTo','clientId'])expect(detail.searchParams.get(key)).toBe(list.searchParams.get(key));
  expect(detail.searchParams.get('dateTo')).toContain('T23:59:59.999Z');
  await expect(drawer.getByText('7-day units',{exact:true})).toBeVisible();
  for(let p=2;p<=5;p++)await drawer.getByRole('button',{name:'Next page',exact:true}).click();
  await expect(drawer.getByRole('button',{name:/ORDER-210 /})).toBeVisible();
  await expect(drawer.getByRole('button',{name:'Next page',exact:true})).toBeDisabled();
  await page.setViewportSize({width:390,height:844});
  await expect(drawer.getByRole('button',{name:'Previous page',exact:true})).toBeVisible();
  expect(await drawer.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({path:test.info().outputPath('analysis-mobile.png')});
  await drawer.getByRole('button',{name:'Close panel'}).click();
});
test('Analysis retry recovers and a late search response cannot replace the current search',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await setup(page,fixture);
  let fail=true;
  await page.route('**/api/client-portal/analysis?**',async route=>{
    if(fail){await route.fulfill({status:503,json:{error:'Fixture unavailable'}});return;}
    const url=new URL(route.request().url());
    if(url.searchParams.get('search')==='SKU-001')await new Promise(r=>setTimeout(r,1200));
    await route.fulfill({json:fixture(url)}).catch(()=>{});
  });
  await page.goto(base+'/analysis');
  await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeVisible();fail=false;
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.getByText('1–50 of 211',{exact:true})).toBeVisible();
  const search=page.getByRole('textbox',{name:'Search Analysis SKUs'});
  await search.fill('SKU-001');
  await page.waitForRequest(r=>new URL(r.url()).searchParams.get('search')==='SKU-001');
  await expect(page.getByRole('button',{name:'Next page',exact:true})).toBeDisabled();
  await search.fill('SKU-210');
  await expect(page.getByRole('button',{name:'View SKU details for SKU-210'})).toBeVisible();
  await page.waitForTimeout(1300);
  await expect(page.getByRole('button',{name:'View SKU details for SKU-001'})).toHaveCount(0);
});
