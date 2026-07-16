import type { PortalItemIdentity } from './common';

export interface BillingSummaryRow {
  clientId?: number;
  clientName?: string;
  orderCount?: number;
  pickPackTotal?: number | string;
  pickpackTotal?: number | string;
  additionalTotal?: number | string;
  packageTotal?: number | string;
  shippingTotal?: number | string;
  storageTotal?: number | string;
  grandTotal?: number | string;
}

export interface PortalReportsBreakdownRow {
  key: string;
  label: string;
  amount: number;
}

export interface PortalReports {
  data: BillingSummaryRow[];
  clients?: BillingSummaryRow[];
  grandTotal?: number | string;
  billingVisible?: boolean;
  breakdown?: PortalReportsBreakdownRow[];
  billableOrders?: number;
  totalCharges?: number | string;
  avgChargePerOrder?: number | string;
}

export interface BillingInvoiceSummaryRow {
  clientId: number;
  clientName: string | null;
  orders: number;
  pickpackTotal: number | string;
  additionalTotal: number | string;
  packageTotal: number | string;
  shippingTotal: number | string;
  storageTotal: number | string;
  returnPostageTotal: number | string;
  returnProcessingTotal: number | string;
  rowTotal: number | string;
}

export interface BillingInvoicePeriodSummaryRow extends BillingInvoiceSummaryRow {
  periodStart: string;
  periodEnd: string;
}

export interface BillingInvoiceTotals {
  orders: number;
  pickpackTotal: number | string;
  additionalTotal: number | string;
  packageTotal: number | string;
  storageTotal: number | string;
  shippingTotal: number | string;
  returnPostageTotal: number | string;
  returnProcessingTotal: number | string;
  rowTotal: number | string;
}

export interface BillingInvoiceDetailRow {
  clientId?: number;
  clientName?: string | null;
  orderId?: number | null;
  orderNumber?: string | null;
  recipientName?: string | null;
  itemNames?: string | null;
  items?: PortalItemIdentity[];
  skus?: string | null;
  boxSize?: string | null;
  /** Actual completion/activity day retained for audit lineage. */
  shipDate?: string | null;
  actualActivityDate?: string | null;
  /** PrepShip-persisted invoice/range bucket; the portal never derives it. */
  billingEffectiveDate?: string | null;
  billingPolicyVersion?: string | null;
  rolledFromWeekend?: boolean;
  qty?: number | string | null;
  pickpackTotal?: number | string | null;
  additionalTotal?: number | string | null;
  packageTotal?: number | string | null;
  shippingTotal?: number | string | null;
  storageTotal?: number | string | null;
  returnPostageTotal?: number | string | null;
  returnProcessingTotal?: number | string | null;
  rowTotal?: number | string | null;
}

export interface BillingLastGenerated {
  at: string;
  dateFrom?: string;
  dateTo?: string;
  generated?: number;
  total?: number;
  by?: string | null;
}
