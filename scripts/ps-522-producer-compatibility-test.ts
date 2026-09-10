/** PS-522 offline cross-repository contract: execute the supplied PrepShip producer. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const producerRoot = process.argv[2];
assert.ok(producerRoot && path.isAbsolute(producerRoot), 'Pass the absolute reviewed PrepShip checkout path.');
process.env.PREPSHIP_API_URL = 'http://canonical.test';
process.env.DATABASE_URL = 'postgres://fixture:fixture@127.0.0.1:1/unused';
process.env.SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_ANON_KEY = 'offline-fixture';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'offline-fixture';
process.env.SUPABASE_JWT_SECRET = 'offline-fixture-secret-that-is-not-live';
process.env.BILLING_NON_SHIPPING_DESTINATION_NA = 'true';
const producerPath = path.join(producerRoot, 'src/services/billing-detail-row-sot.ts');
const { toBillingDetailOrderRows } = await import(pathToFileURL(producerPath).href);
const { toCanonicalBillingEventRow } = await import('../src/lib/client-portal/prepship-billing-details-proxy.js');
const { toPortalDetailRow } = await import('../src/lib/client-portal/read-models/canonical-invoice-events.js');
const { renderPortalInvoiceHtml } = await import('../src/lib/client-portal/invoice-html.js');
const rows = toBillingDetailOrderRows([
  { id:1,clientId:4,orderId:null,shipmentId:null,lineType:'storage',description:'Storage',totalCost:'12.34',shipDate:'2026-08-01',destinationCountry:null },
  { id:2,clientId:4,orderId:100,shipmentId:1000,orderNumber:'100',lineType:'shipping',totalCost:'5.00',shipDate:'2026-08-01',destinationCountry:null },
  { id:3,clientId:4,orderId:101,shipmentId:1001,orderNumber:'101',lineType:'package_cost',totalCost:'0.00',shipDate:'2026-08-01',destinationCountry:'US' },
]);
assert.deepEqual(rows.map((r: {destination: string})=>r.destination), ['N/A','Needs Review','Domestic']);
const accepted = rows.map((row: Record<string, unknown>) => {
  const value = toCanonicalBillingEventRow(row);
  assert.ok(value,'actual producer row must pass the strict consumer');
  assert.equal(value.canonicalEventId,row.canonicalEventId);
  assert.equal(value.destination,row.destination);
  assert.equal(value.grandTotal,row.grandTotal);
  return value;
});
const projected = accepted.map(row => toPortalDetailRow(row));
assert.deepEqual(projected.map(row=>row.destination),['N/A','Needs Review','Domestic']);
assert.deepEqual(projected.map(row=>row.rowTotal),[12.34,5,0]);
assert.equal(toCanonicalBillingEventRow({...rows[0],destination:'UnknownNewValue'}),null,'unknown enum still fails closed');
const html=renderPortalInvoiceHtml({clientName:'Fixture',dateFrom:'2026-08-01',dateTo:'2026-08-01',details:projected,truncated:false,
  invoiceTotals:{orderCount:2,qty:0,pickPackTotal:0,additionalTotal:0,packageTotal:0,shippingTotal:5,storageTotal:12.34,grandTotal:17.34}});
assert.match(html,/>N\/A<\/td>/);
assert.match(html,/>Needs Review<\/td>/);
assert.match(html,/12\.34/);
assert.match(html,/17\.34/);
console.log('PASS PS-522 actual producer -> strict CP mapper -> served DTO -> printable HTML: applicability, identity and money preserved.');
console.log(JSON.stringify({
  producerFiles: Object.fromEntries([
    'src/services/billing-detail-row-sot.ts',
    'src/services/billing-destination-international.ts',
  ].map(file => [file, createHash('sha256').update(readFileSync(path.join(producerRoot, file))).digest('hex')])),
}));
