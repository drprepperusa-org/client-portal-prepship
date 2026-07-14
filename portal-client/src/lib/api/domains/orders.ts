import type { ListOpts } from '@client-portal-contracts/common';
import type { PortalOrder } from '@client-portal-contracts/orders';
import { scopedList } from '../scope';
import { apiGet } from '../transport';

function orders(token: string, opts: ListOpts = {}) {
  return scopedList<PortalOrder>(token, '/api/client-portal/orders', {
    page: opts.page ?? 1,
    pageSize: opts.pageSize ?? 50,
    status: opts.status && opts.status !== 'all' ? opts.status : undefined,
    search: opts.search,
    clientId: opts.clientId,
  });
}

export const ordersApi = {
  orders,
  backgroundOrders: orders,
  order: (token: string, id: number) =>
    apiGet<{ data: PortalOrder }>(token, `/api/client-portal/orders/${id}`),
  awaitingCount: (token: string, clientId?: number) =>
    apiGet<{ count: number }>(token, '/api/client-portal/orders/awaiting-active-count', {
      clientId,
    }),
};
