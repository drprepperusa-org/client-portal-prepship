import type { NewInboundInput, PortalInbound } from '@client-portal-contracts/inbound';
import { apiGet, apiPatch, apiPost } from '../transport';

export const inboundApi = {
  inbound: (token: string, clientId?: number) =>
    apiGet<{ data: PortalInbound[] }>(token, '/api/client-portal/inbound', { clientId }),
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
