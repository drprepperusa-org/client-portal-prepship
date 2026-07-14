export const CLIENT_PORTAL_CONTRACT_VERSION = '1' as const;

export interface PortalDateRange {
  dateFrom: string;
  dateTo: string;
  preset?: string;
}

export interface Paginated<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface PortalItemIdentity {
  sku: string | null;
  name: string | null;
  quantity: number | null;
  imageUrl: string | null;
  unitPrice?: number | string | null;
  lineTotal?: number | string | null;
}

export interface ListOpts {
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  clientId?: number;
  lowStock?: boolean;
}
