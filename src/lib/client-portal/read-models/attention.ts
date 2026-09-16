import type { PortalAttention } from '../contracts/attention';
import type { ClientPortalScope } from '../scope';
import { filterPortalIntegrations } from '../integration-filters';
import { listPortalStoreIntegrations } from './integrations';
import { countPortalInventoryAttention } from './inventory';
import { readNotificationPreferences } from '../notification-preferences';

/** Compose canonical, scoped read owners. No independent stock/status policy. */
export async function getPortalAttention(scope: ClientPortalScope, clientId?: number): Promise<PortalAttention> {
  const preferences = await readNotificationPreferences(scope.userId);
  const [inventoryCount, stores] = await Promise.all([
    preferences.lowStock ? countPortalInventoryAttention(scope, clientId) : Promise.resolve(0),
    preferences.connectionIssues ? listPortalStoreIntegrations(scope) : Promise.resolve([]),
  ]);
  const connectionCount = filterPortalIntegrations(stores, { clientId, status: 'attention' }).length;
  return { inventoryCount, connectionCount, totalCount: inventoryCount + connectionCount, checkedAt: new Date().toISOString(), preferences };
}
