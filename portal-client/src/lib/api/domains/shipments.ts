import type { RequestAuth } from '../transport';
import type { ListOpts } from '@client-portal-contracts/common';
import type { PortalShipment } from '@client-portal-contracts/shipments';
import { scopedList } from '../scope';
import { apiGet } from '../transport';

export const shipmentsApi = {
  shipments: (token: RequestAuth, opts: ListOpts = {}) =>
    scopedList<PortalShipment>(token, '/api/client-portal/shipments', {
      page: opts.page ?? 1,
      pageSize: opts.pageSize ?? 50,
      search: opts.search,
      sortBy: opts.sortBy, sortDir: opts.sortDir,
      clientId: opts.clientId,
      status: opts.status || undefined,
    }),
  orderShipments: (token: RequestAuth, orderId: number) =>
    apiGet<{ data: PortalShipment[] }>(
      token,
      `/api/client-portal/orders/${orderId}/shipments`,
    ),
  // CP-069: no carrier-tracking refresh from the outbound surface — the outbound status is
  // PrepShip's fulfillment truth. Return labels refresh through returnsApi.refreshReturnTracking.
};
