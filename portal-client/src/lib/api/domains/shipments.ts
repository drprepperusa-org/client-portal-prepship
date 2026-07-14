import type { ListOpts } from '@client-portal-contracts/common';
import type { PortalShipment } from '@client-portal-contracts/shipments';
import { scopedList } from '../scope';
import { apiGet, apiPost } from '../transport';

export const shipmentsApi = {
  shipments: (token: string, opts: ListOpts = {}) =>
    scopedList<PortalShipment>(token, '/api/client-portal/shipments', {
      page: opts.page ?? 1,
      pageSize: opts.pageSize ?? 50,
      search: opts.search,
      clientId: opts.clientId,
      status: opts.status || undefined,
    }),
  orderShipments: (token: string, orderId: number) =>
    apiGet<{ data: PortalShipment[] }>(
      token,
      `/api/client-portal/orders/${orderId}/shipments`,
    ),
  refreshShipmentTracking: (token: string, shipmentIds: number[]) =>
    apiPost<{
      checked: number;
      failed: number;
      updated: Array<{ id: number; trackingStatus: string; deliveredAt: string | null }>;
    }>(token, '/api/client-portal/shipments/refresh-tracking', { shipmentIds }),
};
