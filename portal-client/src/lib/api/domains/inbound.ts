import type { RequestAuth } from '../transport';
import type { Paginated } from '@client-portal-contracts/common';
import type {
  NewInboundInput,
  PortalInbound,
  PortalInboundReceipt,
  PortalInventoryReceiveInput,
  PortalInventoryReceiveResult,
} from '@client-portal-contracts/inbound';
import { apiGet, apiPatch, apiPost } from '../transport';

export const inboundApi = {
  inbound: (token: RequestAuth, clientId?: number) =>
    apiGet<{ data: PortalInbound[] }>(token, '/api/client-portal/inbound', { clientId }),
  inboundReceipts: (
    token: RequestAuth,
    options: { sortBy?: string; sortDir?: 'asc' | 'desc'; page?: number; pageSize?: number; clientId?: number },
  ) => apiGet<Paginated<PortalInboundReceipt>>(token, '/api/client-portal/inbound/receipts', {
    page: options.page ?? 1,
    pageSize: options.pageSize ?? 50,
    clientId: options.clientId,
    sortBy: options.sortBy, sortDir: options.sortDir,
  }),
  receiveInventory: (token: RequestAuth, body: PortalInventoryReceiveInput) =>
    apiPost<{ data: PortalInventoryReceiveResult }>(token, '/api/client-portal/inventory/receive', body),
  createInbound: (token: RequestAuth, body: NewInboundInput) =>
    apiPost<{ data: { id: number } }>(token, '/api/client-portal/inbound', body),
  receiveInbound: (
    token: RequestAuth,
    id: number,
    body: { addToInventory?: boolean; items?: Array<{ id: number; receivedQty: number }> },
  ) =>
    apiPatch<{
      data: { id: number; status: string; bumps: Array<{ sku: string; qty: number; matched: boolean }> };
    }>(token, `/api/client-portal/inbound/${id}/receive`, body),
  importInbound: (token: RequestAuth, shipments: NewInboundInput[]) =>
    apiPost<{ data: { created: number; itemsCreated: number; skipped: number } }>(
      token,
      '/api/client-portal/inbound/import',
      { shipments },
    ),
};
