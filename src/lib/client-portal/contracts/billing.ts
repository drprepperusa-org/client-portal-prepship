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
  /**
   * CP-059 — producer-issued identity for this billing event, opaque and stable.
   *
   * The ONLY identity that works for every row shape. An outbound row can be keyed on orderId
   * and a Return on returnId, but a storage line has neither, so consumer-side keys collapsed
   * and two storage lines became the same row. Never derive this locally.
   */
  canonicalEventId?: string | null;
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

  // ── CP-059: canonical event-row facts, all issued by PrepShip ──────────────
  /**
   * Relational return identity. Null on an outbound row.
   *
   * This is the React key for a Return row and the navigation target. NEVER parse it out of
   * displayReference: the display string is a label, and treating a label as a key is how a
   * Return ends up opening the outbound shipment because the order id happened to match.
   */
  returnId?: number | string | null;
  /** 'Outbound' | 'Return'. Decided by PrepShip; the portal never classifies. */
  rowType?: 'Outbound' | 'Return' | null;
  /** e.g. 1234, 1234-RETURN, 1234-RETURN-2. Rendered verbatim, never minted locally. */
  displayReference?: string | null;
  /** 'Domestic' | 'International' | 'Needs Review'. No portal country/territory comparison. */
  destination?: 'Domestic' | 'International' | 'Needs Review' | null;
  /**
   * Fee PRESENCE, which is not the same fact as fee AMOUNT.
   *
   * A missing return-postage line renders blank/Pending; an explicit zero line renders 0.00.
   * The old read model coalesced absent money to 0 and erased that distinction entirely.
   */
  hasReturnPostageLine?: boolean | null;
  hasReturnProcessingLine?: boolean | null;
  /** The Return row's own total, owned upstream — not re-summed from its parts. */
  returnTotal?: number | string | null;
}

export interface BillingLastGenerated {
  at: string;
  dateFrom?: string;
  dateTo?: string;
  generated?: number;
  total?: number;
  by?: string | null;
}
