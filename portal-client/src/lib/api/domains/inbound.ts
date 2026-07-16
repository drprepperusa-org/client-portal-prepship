import type { Paginated, PortalDateRange } from '@client-portal-contracts/common';
import type {
  NewInboundInput,
  PortalInbound,
  PortalInboundReceipt,
  PortalInventoryReceiveInput,
  PortalInventoryReceiveResult,
} from '@client-portal-contracts/inbound';
import { apiGet, apiPatch, apiPost } from '../transport';

export const inboundApi = {
  inbound: (token: string, clientId?: number) =>
    apiGet<{ data: PortalInbound[] }>(token, '/api/client-portal/inbound', { clientId }),
  inboundReceipts: (
    token: string,
    options: { page?: number; pageSize?: number; clientId?: number; dateRange: PortalDateRange },
  ) => apiGet<Paginated<PortalInboundReceipt>>(token, '/api/client-portal/inbound/receipts', {
    page: options.page ?? 1,
    pageSize: options.pageSize ?? 50,
    clientId: options.clientId,
    dateFrom: `${options.dateRange.dateFrom}T00:00:00.000Z`,
    dateTo: `${options.dateRange.dateTo}T23:59:59.999Z`,
  }),
  receiveInventory: (token: string, body: PortalInventoryReceiveInput) =>
    apiPost<{ data: PortalInventoryReceiveResult }>(token, '/api/client-portal/inventory/receive', body),
  createInbound: (token: string, body: NewInboundInput) =>
    apiPost<{ data: { id: number } }>(token, '/api/client-portal/inbound', body),
  receiveInbound: (
    token: string,
    id: number,
    body: { addToInventory?: boolean; items?: Array<{ id: number; receivedQty: number }> },
  ) =>
    apiPatch<{
      data: { id: number; status: string; bumps: Array<{ sku: string; qty: number; matched: boolean }> };
    }>(token, `/api/client-portal/inbound/${id}/receive`, body),
  importInbound: (token: string, shipments: NewInboundInput[]) =>
    apiPost<{ data: { created: number; itemsCreated: number; skipped: number } }>(
      token,
      '/api/client-portal/inbound/import',
      { shipments },
    ),
};
