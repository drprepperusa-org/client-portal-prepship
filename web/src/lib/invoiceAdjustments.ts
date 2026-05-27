import type { BillingInvoiceDetailRow } from '../types/portal';

export type InvoiceRowAdjustment = {
  qty?: number | string | null;
  pickpackTotal?: number | string | null;
  packageTotal?: number | string | null;
  shippingTotal?: number | string | null;
  rowTotal?: number | string | null;
};

export type InvoiceTotals = {
  qtyTotal: number;
  pickpackTotal: number;
  additionalTotal: number;
  packageTotal: number;
  shippingTotal: number;
  storageTotal: number;
  grandTotal: number;
};

export function invoiceNumber(value: unknown) {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

export function roundInvoiceNumber(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function adjustedInvoiceRow(row: BillingInvoiceDetailRow, adjustment?: InvoiceRowAdjustment): BillingInvoiceDetailRow {
  if (!adjustment) return row;
  return {
    ...row,
    qty: adjustment.qty ?? row.qty,
    pickpackTotal: adjustment.pickpackTotal ?? row.pickpackTotal,
    packageTotal: adjustment.packageTotal ?? row.packageTotal,
    shippingTotal: adjustment.shippingTotal ?? row.shippingTotal,
    rowTotal: adjustment.rowTotal ?? row.rowTotal,
  };
}

export function invoiceTotalsForRows(rows: BillingInvoiceDetailRow[]): InvoiceTotals {
  return rows.reduce<InvoiceTotals>(
    (totals, row) => ({
      qtyTotal: totals.qtyTotal + invoiceNumber(row.qty),
      pickpackTotal: roundInvoiceNumber(totals.pickpackTotal + invoiceNumber(row.pickpackTotal)),
      additionalTotal: roundInvoiceNumber(totals.additionalTotal + invoiceNumber(row.additionalTotal)),
      packageTotal: roundInvoiceNumber(totals.packageTotal + invoiceNumber(row.packageTotal)),
      shippingTotal: roundInvoiceNumber(totals.shippingTotal + invoiceNumber(row.shippingTotal)),
      storageTotal: roundInvoiceNumber(totals.storageTotal + invoiceNumber(row.storageTotal)),
      grandTotal: roundInvoiceNumber(totals.grandTotal + invoiceNumber(row.rowTotal)),
    }),
    {
      qtyTotal: 0,
      pickpackTotal: 0,
      additionalTotal: 0,
      packageTotal: 0,
      shippingTotal: 0,
      storageTotal: 0,
      grandTotal: 0,
    },
  );
}

export function calculatedInvoiceRowTotal(row: BillingInvoiceDetailRow | InvoiceRowAdjustment) {
  return roundInvoiceNumber(
    invoiceNumber(row.pickpackTotal) +
      invoiceNumber((row as BillingInvoiceDetailRow).additionalTotal) +
      invoiceNumber(row.packageTotal) +
      invoiceNumber(row.shippingTotal) +
      invoiceNumber((row as BillingInvoiceDetailRow).storageTotal),
  );
}
