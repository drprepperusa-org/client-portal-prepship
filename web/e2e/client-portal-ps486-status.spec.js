import { expect, test } from '@playwright/test';
import { resolveOrderFulfillmentStatus } from '../../src/lib/client-portal/order-status';
import { resolveReturnEligibility } from '../../src/services/return-eligibility';

const baseUrl = 'http://127.0.0.1:5177';
const encode = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
const user = { id:'ps486-browser', email:'ps486@example.test', aud:'authenticated', role:'authenticated',
  app_metadata:{role:'admin',permissions:['scope:global']}, user_metadata:{} };
const session = {access_token:[encode({alg:'HS256',typ:'JWT'}),encode({sub:user.id,email:user.email,exp:4102444800,aud:'authenticated',role:'authenticated',app_metadata:user.app_metadata}),'fixture'].join('.'),
  refresh_token:'fixture',expires_in:2147483647,expires_at:4102444800,token_type:'bearer',user};

for (const scenario of [
  {name:'voided-only #1298', signals:{orderStatus:'shipped',hasVoidedShipment:true,hasActiveShipment:false},label:'Voided',allowed:false},
  {name:'active replacement', signals:{orderStatus:'shipped',hasVoidedShipment:true,hasActiveShipment:true},label:'In Transit',allowed:true},
  {name:'cancelled', signals:{orderStatus:'cancelled',hasVoidedShipment:true,hasActiveShipment:false},label:'Cancelled',allowed:false},
  {name:'delivered', signals:{orderStatus:'shipped',hasVoidedShipment:false,hasActiveShipment:true,activeTrackingStatus:'delivered'},label:'Delivered',allowed:true},
]) {
  test(scenario.name+' has identical table/drawer status and backend return eligibility',async({page},testInfo)=>{
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({width:1440,height:900});
    const signals={activeTrackingStatus:null,...scenario.signals};
    const order={id:1298,clientId:4,clientName:'HUGRAB fixture',storeId:378060,orderNumber:'1298',orderDate:'2026-06-05T17:33:25Z',
      orderStatus:signals.orderStatus,fulfillmentStatus:resolveOrderFulfillmentStatus(signals),returnEligibility:resolveReturnEligibility(signals),
      orderedUnits:3,items:[],orderTotal:133.83,customerShippingRate:null,chargeSummary:[],hasActiveReplacement:false};
    const errors=[];const mutations=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(s=>localStorage.setItem('sb-portal-e2e-auth-token',JSON.stringify(s)),session);
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.pathname.startsWith('/api/client-portal/')) {
        if(route.request().method()!=='GET')mutations.push(url.pathname);
        let body={data:[]};
        if(url.pathname==='/api/client-portal/orders')body={data:[order],pagination:{page:1,pageSize:50,total:1,totalPages:1}};
        if(url.pathname==='/api/client-portal/orders/1298')body={data:order};
        if(url.pathname==='/api/client-portal/clients')body={data:[{id:4,name:'HUGRAB fixture'}]};
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});return;
      }
      if(url.hostname==='portal-e2e.supabase.co') {await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(user)});return;}
      if(url.origin===baseUrl){await route.continue();return;}
      await route.abort();
    });
    await page.goto(baseUrl+'/orders?tab=all');
    const row=page.getByRole('row').filter({hasText:'1298'});
    await expect(row.getByText(scenario.label,{exact:true})).toBeVisible();
    await row.click();
    const drawer=page.getByRole('dialog');
    await expect(drawer.getByText(scenario.label,{exact:true})).toBeVisible();
    const start=drawer.getByRole('button',{name:'Start a return'});
    if(scenario.allowed) await expect(start).toBeEnabled();
    else {
      await expect(start).toBeDisabled();
      await expect(drawer.getByText(order.returnEligibility.reason,{exact:true})).toBeVisible();
    }
    await page.screenshot({path:testInfo.outputPath('status-and-return.png')});
    expect(errors).toEqual([]);expect(mutations).toEqual([]);
  });
}
