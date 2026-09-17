import type { RequestAuth } from '../transport';
import type { ListOpts } from '@client-portal-contracts/common';
import type { PortalShipment } from '@client-portal-contracts/shipments';
import { scopedList } from '../scope';
import { apiGet, apiBlob } from '../transport';

export const shipmentsApi = {
  shipmentsCsv: (token: RequestAuth, opts: ListOpts) => apiBlob(token, '/api/client-portal/shipments', {
    format: 'csv', search: opts.search, clientId: opts.clientId, status: opts.status || undefined,
    dateFrom: opts.dateFrom, dateTo: opts.dateTo, sortBy: opts.sortBy, sortDir: opts.sortDir,
  }, 'text/csv'),
  shipments: (token: RequestAuth, opts: ListOpts = {}) =>
    scopedList<PortalShipment>(token, '/api/client-portal/shipments', {
      page: opts.page ?? 1,
      pageSize: opts.pageSize ?? 50,
      search: opts.search,
      dateFrom: opts.dateFrom, dateTo: opts.dateTo,
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
