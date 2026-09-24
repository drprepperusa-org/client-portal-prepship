import type { InboundImportInput, InboundImportPreview, InboundImportResult } from '@client-portal-contracts/inbound-import';
import type { RequestAuth } from '../transport';
import type { ListOpts, Paginated } from '@client-portal-contracts/common';
import type {
  NewInboundInput,
  InboundReceiveInput,
  PortalInbound,
  PortalInboundReceipt,
  PortalInventoryReceiveInput,
  PortalInventoryReceiveResult,
} from '@client-portal-contracts/inbound';
import { apiBlob, apiGet, apiPatch, apiPost } from '../transport';

export const inboundApi = {
  inbound: (token: RequestAuth, options: ListOpts = {}) =>
    apiGet<Paginated<PortalInbound>>(token, '/api/client-portal/inbound', {
      clientId: options.clientId, search: options.search || undefined, status: options.status || undefined,
      page: options.page ?? 1, pageSize: options.pageSize ?? 50,
    }),
  inboundReceipts: (
    token: RequestAuth,
    options: ListOpts,
  ) => apiGet<Paginated<PortalInboundReceipt>>(token, '/api/client-portal/inbound/receipts', {
    page: options.page ?? 1,
    pageSize: options.pageSize ?? 50,
    clientId: options.clientId,
    dateFrom: options.dateFrom, dateTo: options.dateTo,
    sortBy: options.sortBy, sortDir: options.sortDir,
  }),
  inboundReceiptsCsv: (token: RequestAuth, opts: ListOpts) => apiBlob(token, '/api/client-portal/inbound/receipts', {
    format: 'csv', clientId: opts.clientId, dateFrom: opts.dateFrom, dateTo: opts.dateTo,
    sortBy: opts.sortBy, sortDir: opts.sortDir,
  }, 'text/csv'),
  receiveInventory: (token: RequestAuth, body: PortalInventoryReceiveInput) =>
    apiPost<{ data: PortalInventoryReceiveResult }>(token, '/api/client-portal/inventory/receive', body),
  createInbound: (token: RequestAuth, body: NewInboundInput) =>
    apiPost<{ data: PortalInbound; replayed: boolean }>(token, '/api/client-portal/inbound', body),
  receiveInbound: (
    token: RequestAuth,
    id: number,
    body: InboundReceiveInput,
  ) =>
    apiPatch<{
      data: { id: number; status: string; bumps: Array<{ sku: string; qty: number; matched: boolean }> };
    }>(token, `/api/client-portal/inbound/${id}/receive`, body),
  previewInboundImport: (token: RequestAuth, csv: string) =>
    apiPost<{ data: InboundImportPreview }>(token, '/api/client-portal/inbound/import/preview', { csv }),
  importInbound: (token: RequestAuth, input: InboundImportInput) =>
    apiPost<{ data: InboundImportResult }>(token, '/api/client-portal/inbound/import', input, 120000),
};
