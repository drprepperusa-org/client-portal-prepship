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
 */
export const invoiceRowKey = (row: BillingInvoiceDetailRow): string => row.canonicalEventId;

export type InvoiceDetailsRangeFetcher = (
  token: string,
  dateFrom: string,
  dateTo: string,
  clientId?: number,
  opts?: { page?: number; pageSize?: number; sortBy?: string; sortDir?: 'asc' | 'desc' },
) => Promise<{
  data: BillingInvoiceDetailRow[];
  billingVisible?: boolean;
  pagination?: { page: number; pageSize: number; total: number; totalPages: number };
}>;

export const INVOICE_EXPORT_PAGE_SIZE = 200;
export const INVOICE_EXPORT_MAX_PAGES = 250;

// Fetch every invoice detail row through the paginated backend endpoint. The
// visible Billing table is intentionally paged; exports must walk the backend
// pagination metadata instead of falling back to the capped unpaginated route.
export async function fetchAllInvoiceRows(input: {
  fetcher: InvoiceDetailsRangeFetcher;
  token: string;
  clientId: number | undefined;
  rangeFrom: string;
  rangeTo: string;
}): Promise<{ rows: BillingInvoiceDetailRow[]; truncated: boolean }> {
  const rows: BillingInvoiceDetailRow[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await input.fetcher(input.token, input.rangeFrom, input.rangeTo, input.clientId, {
      page,
      pageSize: INVOICE_EXPORT_PAGE_SIZE,
    });
    rows.push(...(res.data ?? []));
    totalPages = res.pagination?.totalPages ?? 1;
    page += 1;
  } while (page <= totalPages && page <= INVOICE_EXPORT_MAX_PAGES);
  return { rows, truncated: totalPages > INVOICE_EXPORT_MAX_PAGES };
}
