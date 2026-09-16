import type { PortalAttention } from '../contracts/attention';
import type { ClientPortalScope } from '../scope';
import { filterPortalIntegrations } from '../integration-filters';
import { listPortalStoreIntegrations } from './integrations';
import { countPortalInventoryAttention } from './inventory';

/** Compose canonical, scoped read owners. No independent stock/status policy. */
export async function getPortalAttention(scope: ClientPortalScope, clientId?: number): Promise<PortalAttention> {
  const [inventoryCount, stores] = await Promise.all([
    countPortalInventoryAttention(scope, clientId),
    listPortalStoreIntegrations(scope),
  ]);
  const connectionCount = filterPortalIntegrations(stores, { clientId, status: 'attention' }).length;
  return { inventoryCount, connectionCount, totalCount: inventoryCount + connectionCount, checkedAt: new Date().toISOString() };
}
