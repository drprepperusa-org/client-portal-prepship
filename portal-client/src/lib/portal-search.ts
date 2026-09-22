import { portalApi } from './api';
import type { RequestAuth } from './api/transport';
import type { ListOpts, Paginated } from '@client-portal-contracts/common';
import { fulfillmentStatusMeta, shipmentStatusMeta } from './status';

export type SearchPreview = { id: number; title: string; detail: string; clientName: string | null; status?: string };
export type SearchGroup = {
  key: string; title: string; path: string; hint: string;
  load: (token: RequestAuth, options: ListOpts) => Promise<Paginated<SearchPreview>>;
};
function project<T>(result: Paginated<T>, display: (row: T) => SearchPreview): Paginated<SearchPreview> {
  return { ...result, data: result.data.map(display) };
}
export function searchListLink(group: SearchGroup, search: string) {
  const params = new URLSearchParams({ q: search });
  if (group.key === 'orders') params.set('tab', 'all');
  return `${group.path}?${params}`;
}

// Presentation of existing redacted DTOs only. Backend selectors own matching,
// ordering, whole-set totals and scope; previews do not become a second search index.
export const PORTAL_SEARCH_GROUPS: SearchGroup[] = [
  { key: 'orders', title: 'Orders', path: '/orders', hint: 'Order number, customer, SKU or tracking',
    load: async (token, options) => project(await portalApi.orders(token, { ...options, status: 'all' }), row => ({
      id: row.id, title: row.orderNumber ?? `Order record ${row.id}`, clientName: row.clientName,
      detail: row.shipToName ?? 'Recipient not recorded', status: fulfillmentStatusMeta(row.fulfillmentStatus).label,
    })) },
  { key: 'shipments', title: 'Shipments', path: '/shipments', hint: 'Order number or tracking',
    load: async (token, options) => project(await portalApi.shipments(token, options), row => ({
      id: row.id, title: `Shipment ${row.id}`, clientName: row.clientName,
      detail: `Order: ${row.orderNumber ?? 'Not recorded'} · Tracking: ${row.displayTrackingNumber ?? 'Not recorded'}`,
      status: shipmentStatusMeta(row.shipmentStatus).label,
    })) },
  { key: 'inventory', title: 'Inventory', path: '/inventory', hint: 'SKU or item name',
    load: async (token, options) => project(await portalApi.inventory(token, options), row => ({
      id: row.id, title: row.sku ?? `Inventory record ${row.id}`, detail: row.name ?? 'Item name not recorded', clientName: row.clientName,
    })) },
  { key: 'returns', title: 'Returns', path: '/returns', hint: 'Return reference, order or tracking',
    load: async (token, options) => project(await portalApi.returns(token, options), row => ({
      id: row.id, title: row.returnReference, clientName: row.clientName,
      detail: `Order: ${row.orderNumber ?? 'Not recorded'}`, status: row.status.replace(/_/g, ' '),
    })) },
  { key: 'replacements', title: 'Replacements', path: '/replace', hint: 'Replacement reference or order number',
    load: async (token, options) => project(await portalApi.replacements(token, options), row => ({
      id: row.id, title: row.reference, clientName: row.clientName,
      detail: `Order: ${row.orderNumber ?? 'Not recorded'}`, status: row.status.replace(/_/g, ' '),
    })) },
];
