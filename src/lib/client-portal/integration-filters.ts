import {
  PORTAL_CONNECTION_STATUSES,
  type PortalIntegration,
  type PortalIntegrationListOptions,
} from './contracts/connections';

/** Only filter already scoped, redacted DTOs. Status policy stays in the DTO owner. */
export function filterPortalIntegrations(rows: PortalIntegration[], filters: PortalIntegrationListOptions) {
  const search = filters.search?.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.clientId != null && row.clientId !== filters.clientId
      && !(row.type === 'carrier' && row.assignedClientIds.includes(filters.clientId))) return false;
    if (filters.provider && row.provider?.toLowerCase() !== filters.provider.toLowerCase()) return false;
    if (filters.status === 'attention') {
      if (!['pending', 'reconnect', 'degraded'].includes(row.connectionStatus)) return false;
    } else if (filters.status && row.connectionStatus !== filters.status) return false;
    return !search || [row.label, row.storeName].some((name) => name?.toLowerCase().includes(search));
  });
}

export function parseIntegrationFilters(query: Record<string, string>): PortalIntegrationListOptions | null {
  const { clientId, status } = query;
  if (clientId && (!/^\d+$/.test(clientId) || !Number.isSafeInteger(Number(clientId)) || Number(clientId) < 1)) return null;
  if (status && status !== 'attention' && !PORTAL_CONNECTION_STATUSES.some((value) => value === status)) return null;
  return {
    clientId: clientId ? Number(clientId) : undefined,
    search: query.search?.trim().slice(0, 120) || undefined,
    provider: query.provider?.trim().toLowerCase().slice(0, 80) || undefined,
    status: status as PortalIntegrationListOptions['status'] || undefined,
  };
}
