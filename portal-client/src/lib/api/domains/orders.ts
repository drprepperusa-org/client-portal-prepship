import type { RequestAuth } from '../transport';
import type { ListOpts } from '@client-portal-contracts/common';
import type { PortalOrder } from '@client-portal-contracts/orders';
import { scopedList } from '../scope';
import { apiBlob, apiGet } from '../transport';

function orders(token: RequestAuth, opts: ListOpts = {}) {
  return scopedList<PortalOrder>(token, '/api/client-portal/orders', {
    page: opts.page ?? 1,
    pageSize: opts.pageSize ?? 50,
    status: opts.status && opts.status !== 'all' ? opts.status : undefined,
    search: opts.search,
      sortBy: opts.sortBy, sortDir: opts.sortDir,
    clientId: opts.clientId,
    dateFrom: opts.dateFrom, dateTo: opts.dateTo,
  });
}

export const ordersApi = {
  orders,
  backgroundOrders: orders,
  ordersCsv: (token: RequestAuth, opts: ListOpts) => apiBlob(token, '/api/client-portal/orders', {
    format: 'csv', status: opts.status, search: opts.search, clientId: opts.clientId,
    dateFrom: opts.dateFrom, dateTo: opts.dateTo, sortBy: opts.sortBy, sortDir: opts.sortDir,
  }, 'text/csv'),
  order: (token: RequestAuth, id: number) =>
    apiGet<{ data: PortalOrder }>(token, `/api/client-portal/orders/${id}`),
  awaitingCount: (token: RequestAuth, clientId?: number) =>
    apiGet<{ count: number }>(token, '/api/client-portal/orders/awaiting-active-count', {
      clientId,
    }),
};
