import { adjustedInvoiceRow, invoiceTotalsForRows } from '../web/src/lib/invoiceAdjustments';

const baseRow = {
  clientId: 3,
  orderNumber: 'SP6441',
  qty: '1.000',
  pickpackTotal: '2.50',
  additionalTotal: '0.00',
  packageTotal: '0.00',
  shippingTotal: '5.97',
  storageTotal: '63.34',
  rowTotal: '71.81',
};

const adjusted = adjustedInvoiceRow(baseRow, {
  qty: '4',
  pickpackTotal: '7.50',
  packageTotal: '1.10',
  shippingTotal: '8.25',
  rowTotal: '80.19',
});

if (adjusted.qty !== '4') throw new Error('qty adjustment was not applied');
if (adjusted.pickpackTotal !== '7.50') throw new Error('pick/pack adjustment was not applied');
if (adjusted.packageTotal !== '1.10') throw new Error('box fee adjustment was not applied');
if (adjusted.shippingTotal !== '8.25') throw new Error('shipping adjustment was not applied');
if (adjusted.rowTotal !== '80.19') throw new Error('row total adjustment was not applied');

const totals = invoiceTotalsForRows([adjusted]);

if (totals.qtyTotal !== 4) throw new Error(`expected qty total 4, got ${totals.qtyTotal}`);
if (totals.pickpackTotal !== 7.5) throw new Error(`expected pick/pack total 7.5, got ${totals.pickpackTotal}`);
if (totals.packageTotal !== 1.1) throw new Error(`expected box fee total 1.1, got ${totals.packageTotal}`);
if (totals.shippingTotal !== 8.25) throw new Error(`expected shipping total 8.25, got ${totals.shippingTotal}`);
if (totals.storageTotal !== 63.34) throw new Error(`expected storage total 63.34, got ${totals.storageTotal}`);
if (totals.grandTotal !== 80.19) throw new Error(`expected grand total 80.19, got ${totals.grandTotal}`);

console.log('PASS invoice adjustment guard');
