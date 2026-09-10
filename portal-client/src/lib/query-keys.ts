/** Presentation cache identity only; backend scope checks remain authoritative. */
export function portalQueryKey(userId: string | null, key: readonly unknown[]) {
  return [...key, { userId }];
}

export const portalReadKeys = {
  dashboard: (from: string, to: string, clientId?: number) => ['dashboard', from, to, clientId ?? 'scope'],
  orders: (clientId?: number, status = 'awaiting_shipment', search = '', page = 1, pageSize = 50, sortBy?: string, sortDir?: string) =>
    ['orders', status, search, page, pageSize, clientId ?? 'scope', ...(sortBy ? [sortBy, sortDir] : [])],
  inventory: (clientId?: number, search = '', page = 1, pageSize = 100, lowStock = false, sortBy?: string, sortDir?: string) =>
    ['inventory', search, page, pageSize, lowStock ? 'low' : 'all', clientId ?? 'scope', ...(sortBy ? [sortBy, sortDir] : [])],
};
