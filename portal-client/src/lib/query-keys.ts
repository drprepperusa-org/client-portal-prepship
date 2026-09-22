import type { ListOpts } from './api';

/** Presentation cache identity only; backend scope checks remain authoritative. */
export function portalQueryKey(userId: string | null, key: readonly unknown[]) {
  return [...key, { userId }];
}

export const portalReadKeys = {
  shipments: (opts: ListOpts = {}) => ['shipments', opts.search ?? '', opts.page ?? 1, opts.pageSize ?? 50, opts.status ?? 'all',
    opts.clientId ?? 'scope', opts.sortBy, opts.sortDir, opts.dateFrom, opts.dateTo],
  returns: (opts: ListOpts & { orderId?: number } = {}) => ['returns', opts.status ?? 'all', opts.search ?? '', opts.page ?? 1, opts.pageSize ?? 50,
    opts.orderId ?? 0, opts.clientId ?? 'scope', opts.sortBy, opts.sortDir, opts.dateFrom, opts.dateTo],
  dashboard: (from: string, to: string, clientId?: number) => ['dashboard', from, to, clientId ?? 'scope'],
  orders: (clientId?: number, status = 'awaiting_shipment', search = '', page = 1, pageSize = 50, sortBy?: string, sortDir?: string, dateFrom?: string, dateTo?: string) =>
    ['orders', status, search, page, pageSize, clientId ?? 'scope', ...(sortBy ? [sortBy, sortDir] : []),
      ...(dateFrom || dateTo ? [dateFrom, dateTo] : [])],
  inventory: (clientId?: number, search = '', page = 1, pageSize = 100, lowStock = false, sortBy?: string, sortDir?: string) =>
    ['inventory', search, page, pageSize, lowStock ? 'low' : 'all', clientId ?? 'scope', ...(sortBy ? [sortBy, sortDir] : [])],
};
