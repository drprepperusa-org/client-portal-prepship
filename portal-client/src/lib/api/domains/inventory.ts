import type { ListOpts, Paginated, PortalDateRange } from '@client-portal-contracts/common';
import type { InventoryMovement, PortalInventory } from '@client-portal-contracts/inventory';
import { defaultRange, scopedList } from '../scope';
import { apiGet } from '../transport';

function inventory(token: string, opts: ListOpts = {}) {
  return scopedList<PortalInventory>(token, '/api/client-portal/inventory', {
    page: opts.page ?? 1,
    pageSize: opts.pageSize ?? 100,
    search: opts.search,
    clientId: opts.clientId,
    lowStock: opts.lowStock ? 1 : undefined,
  });
}

export const inventoryApi = {
  inventory,
  backgroundInventory: inventory,
  inventoryHistory: (
    token: string,
    opts: {
      page?: number;
      pageSize?: number;
      sku?: string;
      type?: string;
      days?: number;
      dateRange?: PortalDateRange;
    } = {},
  ) => {
    const range = opts.dateRange
      ? { from: opts.dateRange.dateFrom, to: opts.dateRange.dateTo }
      : defaultRange(opts.days ?? 30);
    return apiGet<Paginated<InventoryMovement>>(
      token,
      '/api/client-portal/inventory-history',
      {
        page: opts.page ?? 1,
        pageSize: opts.pageSize ?? 50,
        sku: opts.sku,
        type: opts.type,
        from: `${range.from}T00:00:00.000Z`,
        to: `${range.to}T23:59:59.999Z`,
      },
    );
  },
};
