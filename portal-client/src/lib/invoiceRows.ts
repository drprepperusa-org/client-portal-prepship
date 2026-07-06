import type { BillingInvoiceDetailRow } from './api';

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
