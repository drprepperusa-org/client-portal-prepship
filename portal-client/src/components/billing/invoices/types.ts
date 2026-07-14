export interface InvoiceSelection {
  clientId: number;
  clientName: string;
  from: string;
  to: string;
}

export type InvoiceSort = {
  key: string;
  dir: 'asc' | 'desc';
} | null;

export interface InvoicePagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
