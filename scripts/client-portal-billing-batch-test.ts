import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { loadFixtureModule } from './lib/load-fixture-module';
import * as keys from '../src/lib/client-portal/billing-summary-canonical-keys';
import * as days from '../src/lib/client-portal/billing-day';

// No dotenv, database, credentials, or network: run actual transport and routes
// against substituted fetch/read boundaries. All monetary values are synthetic.
const env = { PREPSHIP_API_URL: 'https://offline.example.test/', PREPSHIP_INVOICE_TOTALS_BATCH_ENABLED: false };
const parser = loadFixtureModule('src/lib/client-portal/prepship-billing-details-proxy.ts', { '../env.js': { env } });
const batch = loadFixtureModule('src/lib/client-portal/prepship-invoice-totals-batch-proxy.ts', {
  '../env': { env }, './prepship-billing-details-proxy': parser,
});
const proxy = loadFixtureModule('src/lib/client-portal/prepship-invoice-totals-proxy.ts', {
  '../env': { env }, './prepship-billing-details-proxy': parser,
  './prepship-invoice-totals-batch-proxy': batch,
});
assert.equal(proxy.canonicalInvoiceTotalsBatchEnabled, false);
env.PREPSHIP_INVOICE_TOTALS_BATCH_ENABLED=true;
const enabledProxy=loadFixtureModule('src/lib/client-portal/prepship-invoice-totals-proxy.ts', {
  '../env': { env }, './prepship-billing-details-proxy': parser,
  './prepship-invoice-totals-batch-proxy': batch,
});
assert.equal(enabledProxy.canonicalInvoiceTotalsBatchEnabled,true);
env.PREPSHIP_INVOICE_TOTALS_BATCH_ENABLED=false;
const envSource=readFileSync('src/lib/env.ts','utf8');
for (const [flag,expected] of [[undefined,false],['false',false],['true',true]] as const) {
  const input={ DATABASE_URL:'postgres://offline:offline@127.0.0.1:1/offline',SUPABASE_URL:'https://example.test',
    SUPABASE_ANON_KEY:'offline',SUPABASE_SERVICE_ROLE_KEY:'offline',SUPABASE_JWT_SECRET:'offline',
    ...(flag===undefined?{}:{PREPSHIP_INVOICE_TOTALS_BATCH_ENABLED:flag}) };
  const isolated=envSource.replace('schema.safeParse(process.env)',`schema.safeParse(${JSON.stringify(input)})`);
  assert.equal(loadFixtureModule('src/lib/env.ts',{'dotenv/config':{}},isolated).env.PREPSHIP_INVOICE_TOTALS_BATCH_ENABLED,expected);
}
const totalsFor=(id:number,day:string)=>({ orderCount:id%10, pickPackTotal:1.25, additionalTotal:2.5,
  packageTotal:3.75,shippingTotal:4.25,storageTotal:5.5,adjustmentTotal:-1.25,replacePostageTotal:6.75,
  replacePickPackTotal:7,returnTotal:8,returnPostageTotal:3,returnProcessingTotal:5,
  customsDutiesTotal:2.75,grandTotal:id+Number(day.slice(8))/100, internalProvider:'must-not-escape' });
const makePeriods=(count=6,clients=[7,8])=>new Map(Array.from({length:count},(_,i)=>{
  const day=`2026-08-${String(i+1).padStart(2,'0')}`;
  return [`${day}|${day}`,{dateFrom:day,dateTo:day,clientIds:[...clients]}] as const;
}));
type Call={url:string;periods:any[];init:RequestInit};
const calls:Call[]=[];
let active=0,peak=0,status=200,throwFetch=false,brokenJson=false,failCall=0;
let change:(body:any)=>any=body=>body;
const originalFetch=globalThis.fetch;
globalThis.fetch=async (input,init={})=>{
  const url=new URL(String(input));
  const periods=url.pathname.endsWith('/batch') ? JSON.parse(url.searchParams.get('periods')!) : [{
    dateFrom:url.searchParams.get('dateFrom'),dateTo:url.searchParams.get('dateTo'),
    clientIds:url.searchParams.get('clientIds')!.split(',').map(Number),
  }];
  calls.push({url:String(input),periods,init}); active++; peak=Math.max(peak,active);
  try {
    await new Promise(resolve=>setTimeout(resolve,1));
    if(throwFetch) throw new Error('offline synthetic timeout');
    if(brokenJson) return new Response('{',{status:200});
    if(status!==200 || (failCall && calls.length===failCall))
      return new Response(JSON.stringify({error:'private upstream details'}),{status:status===200?500:status});
    const data=periods.map((p:any)=>({dateFrom:p.dateFrom,dateTo:p.dateTo,data:p.clientIds.map((id:number)=>({
      clientId:id,totals:totalsFor(id,p.dateFrom),internalSecret:'strip',
    }))}));
    return new Response(JSON.stringify(change(url.pathname.endsWith('/batch')?{data}:data[0])),{status:200});
  } finally { active--; }
};
const reset=()=>{calls.length=0;active=0;peak=0;status=200;throwFetch=false;brokenJson=false;failCall=0;change=body=>body;};
const fetchBatch=(periods=makePeriods())=>batch.fetchCanonicalInvoiceTotalsBatch('Bearer fixture',periods,'fixture-request');
try {
  let result=await fetchBatch(); assert.equal(result.ok,true); assert.equal(calls.length,1);
  for(const [key,p] of makePeriods()) for(const id of p.clientIds)
    assert.deepEqual(result.byPeriod.get(key).get(id),parser.parseCanonicalBillingTotals(totalsFor(id,p.dateFrom)));
  assert.ok(calls[0]!.init.signal instanceof AbortSignal);
  assert.equal((calls[0]!.init.headers as any).authorization,'Bearer fixture');
  assert.equal((calls[0]!.init.headers as any)['x-request-id'],'fixture-request');
  assert.equal(calls[0]!.init.method,'GET');
  assert.equal(JSON.stringify([...result.byPeriod.values()].map((m:any)=>[...m.values()])).includes('must-not-escape'),false);

  for (const input of [makePeriods(9),makePeriods(1,Array.from({length:405},(_,i)=>i+1)),
    makePeriods(8,Array.from({length:200},(_,i)=>2147483647-i))]) {
    reset(); result=await fetchBatch(input); assert.equal(result.ok,true); assert.ok(calls.length>1);
    assert.equal(peak,1,'one batch HTTP request at a time, never multiplying upstream concurrency');
    assert.equal(result.byPeriod.size,input.size);
    for(const [key,p] of input) for(const id of p.clientIds)
      assert.deepEqual(result.byPeriod.get(key).get(id),parser.parseCanonicalBillingTotals(totalsFor(id,p.dateFrom)));
    assert.ok(calls.every(c=>c.url.length<=7500 && c.periods.length<=8
      && new Set(c.periods.map(p=>`${p.dateFrom}|${p.dateTo}`)).size===c.periods.length
      && c.periods.every(p=>p.clientIds.length<=200)));
  }
  reset(); change=body=>({data:body.data.reverse().map((p:any)=>({...p,data:p.data.reverse()}))});
  assert.equal((await fetchBatch()).ok,true,'response order does not determine money assignment');
  reset(); change=body=>{for(const p of body.data) for(const row of p.data)
    for(const key of Object.keys(row.totals)) if(key!=='internalProvider') row.totals[key]=key==='customsDutiesTotal'?0:'0';return body;};
  result=await fetchBatch();assert.equal(result.ok,true);
  assert.equal(result.byPeriod.get('2026-08-01|2026-08-01').get(7).grandTotal,0,'explicit numeric zero is legitimate');
  reset();result=await batch.fetchCanonicalInvoiceTotalsBatch('Bearer different-user',makePeriods(),'fresh-request');
  assert.notEqual(result.byPeriod.get('2026-08-01|2026-08-01').get(7).grandTotal,0,'no previous response cache');
  assert.equal((calls[0]!.init.headers as any).authorization,'Bearer different-user');
  assert.equal((calls[0]!.init.headers as any)['x-request-id'],'fresh-request');
  const corruptions: Array<(body:any)=>any>=[
    ()=>null,()=>({}),body=>({data:body.data.slice(1)}),body=>({data:[body.data[0],...body.data.slice(0,-1)]}),
    body=>{body.data[0].dateFrom='2026-09-01';return body;},
    body=>{body.data[0].data.pop();return body;},body=>{body.data[0].data[1]=body.data[0].data[0];return body;},
    body=>{body.data[0].data[0].clientId=999;return body;},
    body=>{body.data[0].data[0].clientId='7';return body;},
    body=>{body.data[0].data[0].totals={};return body;},
    body=>{delete body.data[0].data[0].totals.grandTotal;return body;},
    body=>{delete body.data[0].data[0].totals.customsDutiesTotal;return body;},
    body=>{body.data[0].data[0].totals.customsDutiesTotal=null;return body;},
    ...[null,true,[],{},{valueOf:null,toString:null},'', 'garbage'].map(value=>(body:any)=>{body.data[0].data[0].totals.grandTotal=value;return body;}),
    body=>{body.data[0].data[0].totals.orderCount=1.5;return body;},
  ];
  for(const corrupt of corruptions) {
    reset(); change=corrupt;
    result=await fetchBatch(makePeriods(9));
    assert.equal(result.ok,false); assert.equal(result.code,'prep_ship_billing_contract_mismatch');
    assert.equal(calls.length,1,'contract failure starts no later chunk'); assert.equal('byPeriod' in result,false);
  }
  for(const code of [401,403,404,414,500]) {
    reset();status=code;result=await fetchBatch(makePeriods(9));
    assert.equal(result.status,[401,403].includes(code)?code:502);assert.equal(calls.length,1);
    assert.equal(JSON.stringify(result).includes('private upstream details'),false);
  }
  reset();throwFetch=true;assert.equal((await fetchBatch()).status,502);
  reset();brokenJson=true;assert.equal((await fetchBatch()).code,'prep_ship_billing_contract_mismatch');
  reset();failCall=2;result=await fetchBatch(makePeriods(20));
  assert.equal(result.ok,false);assert.equal(calls.length,2);assert.equal('byPeriod' in result,false);
  reset();env.PREPSHIP_API_URL='';assert.equal((await fetchBatch()).status,503);assert.equal(calls.length,0);
  assert.equal((await fetchBatch(new Map())).ok,true);env.PREPSHIP_API_URL='https://offline.example.test/';
  for(const p of [{dateFrom:'2026-02-30',dateTo:'2026-02-30',clientIds:[7]},
    {dateFrom:'2026-08-01',dateTo:'2026-08-01',clientIds:[7,7]},
    {dateFrom:'2026-08-01',dateTo:'2026-08-01',clientIds:[0]},
    {dateFrom:'2026-08-01',dateTo:'2026-08-01',clientIds:[]}]) {
    reset();assert.equal((await fetchBatch(new Map([[`${p.dateFrom}|${p.dateTo}`,p]]))).ok,false);assert.equal(calls.length,0);
  }

  // Execute the actual portal route in BOTH modes, with the real proxies and
  // the same identity rows. Only unrelated I/O and other invoice surfaces stubbed.
  const scope={canViewFinancials:true};
  const rows=Array.from({length:9},(_,i)=>({clientId:7,clientName:'Fixture',
    periodStart:`2026-08-${String(i+1).padStart(2,'0')}`,periodEnd:`2026-08-${String(i+1).padStart(2,'0')}`}));
  let inputRows=rows;
  const audits:string[]=[];
  const mount=(enabled:boolean)=>new Hono().route('/',loadFixtureModule('src/routes/client-portal/invoices.ts',{
    '../../db/client':{db:{}},'../../db/schema/clients':{clients:{}},
    '../../lib/client-portal/audit':{recordPortalAudit:async(event:string)=>{audits.push(event);}},
    '../../lib/client-portal/billing-day':days,'../../lib/client-portal/scope':{isClientPortalScope:(s:unknown)=>s===scope},
    '../../lib/client-portal/predicates':{},'../../lib/client-portal/invoice-html':{},
    '../../lib/client-portal/billing-summary-canonical-keys':keys,
    '../../lib/client-portal/read-models/invoice-details':{portalInvoicePeriodSummary:async()=>inputRows,portalInvoiceSummary:async()=>inputRows},
    '../../lib/client-portal/read-models/canonical-invoice-events':{},
    '../../lib/client-portal/query-params':{scopeOrResponse:()=>scope,requestedClientId:()=>7},
    '../../lib/client-portal/prepship-invoice-totals-proxy':enabled?enabledProxy:proxy,
  }).default);
  const legacy=mount(false),batched=mount(true);
  const request=(app:Hono,auth=true)=>app.request('/invoice-summary?dateFrom=2026-08-01&dateTo=2026-08-09&groupBy=period',
    {headers:auth?{authorization:'Bearer fixture','x-request-id':'fixture-request'}:{}});
  reset();const before=await request(legacy);assert.equal(before.status,200);const oldBody=await before.json();
  assert.equal(calls.length,9);assert.ok(calls.every(c=>!c.url.includes('/batch?')));assert.equal(peak,2);
  reset();const after=await request(batched);assert.equal(after.status,200);assert.deepEqual(await after.json(),oldBody);
  assert.equal(calls.length,2);assert.equal(peak,1);
  reset();change=corruptions[5]!;audits.length=0;
  const denied=await request(batched);assert.equal(denied.status,502);assert.equal(calls.length,1);
  assert.deepEqual(audits,['portal.invoice_summary.failed']);
  assert.equal('data' in await denied.json(),false);
  reset();inputRows=[];assert.equal((await request(batched)).status,200);assert.equal(calls.length,0);
  inputRows=rows;scope.canViewFinancials=false;
  assert.deepEqual(await (await request(batched)).json(),{data:[],totals:null,billingVisible:false});assert.equal(calls.length,0);
  scope.canViewFinancials=true;assert.equal((await request(batched,false)).status,401);assert.equal(calls.length,0);
  console.log('PASS disabled default, exact route parity, bounded period/client/URL chunks, strict completeness/redaction, permissions and fail-closed transport');
} finally { globalThis.fetch=originalFetch; }
