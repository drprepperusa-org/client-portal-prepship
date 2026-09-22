import type { PortalAttention } from '../contracts/attention';
import type { ClientPortalScope } from '../scope';
import { filterPortalIntegrations } from '../integration-filters';
import { listPortalStoreIntegrations } from './integrations';
import { listPortalInventoryAttentionIds } from './inventory';
import { readNotificationPreferences } from '../notification-preferences';

/** Compose canonical, scoped read owners. No independent stock/status policy. */
export async function getPortalAttention(scope: ClientPortalScope, clientId?: number): Promise<PortalAttention> {
  const preferences = await readNotificationPreferences(scope.userId);
  const [inventoryIds, stores] = await Promise.all([
    preferences.lowStock ? listPortalInventoryAttentionIds(scope, clientId) : Promise.resolve([]),
    preferences.connectionIssues ? listPortalStoreIntegrations(scope) : Promise.resolve([]),
  ]);
  const inventoryIssueIds = inventoryIds.map((id) => `inventory:${id}`);
  const connectionIssueIds = filterPortalIntegrations(stores, { clientId, status: 'attention' }).map((store) => {
    if (!Number.isSafeInteger(store.id)) throw new Error('Attention connection identity missing');
    // Only canonical public status/reason codes; never raw sync errors or credentials.
    return `connection:${store.id}:${store.connectionStatus}:${store.reconnectReasonCode ?? 'none'}`;
  }).sort();
  const inventoryCount = inventoryIssueIds.length;
  const connectionCount = connectionIssueIds.length;
  return { inventoryCount, connectionCount, inventoryIssueIds, connectionIssueIds,
    totalCount: inventoryCount + connectionCount, checkedAt: new Date().toISOString(), preferences };
}
