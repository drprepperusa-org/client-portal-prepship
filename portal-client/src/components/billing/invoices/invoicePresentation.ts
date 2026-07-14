import type {
  BillingInvoicePeriodSummaryRow,
  BillingInvoiceTotals,
} from '@/lib/api';
import {
  EMPTY_BILLING_TOTALS,
  numberValue,
  type BillingTotals,
  type PeriodSummary,
} from '../invoiceColumns';

/** Maps the backend-owned period DTO without deriving new billing truth. */
export function toPeriodSummaries(rows: BillingInvoicePeriodSummaryRow[]): PeriodSummary[] {
  return rows.map((row) => ({
    clientId: row.clientId,
    clientName: row.clientName ?? `Client ${row.clientId}`,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    orders: row.orders,
    pickpack: numberValue(row.pickpackTotal),
    additional: numberValue(row.additionalTotal),
    box: numberValue(row.packageTotal),
    storage: numberValue(row.storageTotal),
    shipping: numberValue(row.shippingTotal),
    returnPostage: numberValue(row.returnPostageTotal),
    returnProcessing: numberValue(row.returnProcessingTotal),
    fee: numberValue(row.rowTotal),
  }));
}

/** Maps the backend `totals` DTO; React never reduces visible period rows. */
export function toBillingTotals(value?: BillingInvoiceTotals): BillingTotals {
  return value
    ? {
        orders: numberValue(value.orders),
        pickpack: numberValue(value.pickpackTotal),
        additional: numberValue(value.additionalTotal),
        box: numberValue(value.packageTotal),
        storage: numberValue(value.storageTotal),
        shipping: numberValue(value.shippingTotal),
        returnPostage: numberValue(value.returnPostageTotal),
        returnProcessing: numberValue(value.returnProcessingTotal),
        fee: numberValue(value.rowTotal),
      }
    : EMPTY_BILLING_TOTALS;
}
