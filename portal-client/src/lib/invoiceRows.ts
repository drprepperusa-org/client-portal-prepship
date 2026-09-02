import type { BillingInvoiceDetailRow } from './api';

/**
 * CP-059 — the React key for one billing line.
 *
 * A function, not an inline lambda, so a guard can EXECUTE it. The key was previously built from
 * orderId/rowType/returnId, which is `null-Outbound-none` for every ORDERLESS storage line, so
 * React treated several distinct billing events as one row and reused the wrong DOM node. There
 * is deliberately no fallback: the boundary rejects any row without a valid producer identity,
 * and a fallback would silently restore the collapsing key the moment the identity went missing
 * — which is exactly how that defect stayed invisible the first time.
 *
 * CP-068 removed the page-through export helper that used to live beside this: the Excel export
 * no longer reads rows at all — it downloads PrepShip's workbook.
 */
export const invoiceRowKey = (row: BillingInvoiceDetailRow): string => row.canonicalEventId;
