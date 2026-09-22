import { useEffect, useState } from 'react';
import type { PortalAttention } from '@client-portal-contracts/attention';

type Dismissals = { inventory: string[]; connections: string[] };
const empty = (): Dismissals => ({ inventory: [], connections: [] });

function read(storageKey: string): Dismissals {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (saved?.version !== 1 || !Array.isArray(saved.inventory) || !Array.isArray(saved.connections)
      || ![...saved.inventory, ...saved.connections].every((id) => typeof id === 'string')) return empty();
    return { inventory: saved.inventory, connections: saved.connections };
  } catch { return empty(); }
}

/** Personal presentation state only. Dismissal never resolves a backend condition. */
export function useAttentionDismissals(scopeKey: string, data: PortalAttention | undefined, fetching: boolean) {
  const storageKey = `portal-attention-dismissed:v1:${scopeKey}`;
  const [dismissed, setDismissed] = useState(() => read(storageKey));
  const [storageFailed, setStorageFailed] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ version: 1, ...dismissed }));
      setStorageFailed(false);
    } catch { setStorageFailed(true); }
  }, [storageKey, dismissed]);

  useEffect(() => {
    if (!data || fetching) return;
    const currentInventory = new Set(data.inventoryIssueIds);
    const currentConnections = new Set(data.connectionIssueIds);
    // Only a successful complete read can retire an absent issue. Muting a category
    // does not mean its conditions resolved. Errors/loading cannot retire anything.
    setDismissed((previous) => {
      const inventory = data.preferences.lowStock
        ? previous.inventory.filter((id) => currentInventory.has(id)) : previous.inventory;
      const connections = data.preferences.connectionIssues
        ? previous.connections.filter((id) => currentConnections.has(id)) : previous.connections;
      return inventory.length === previous.inventory.length && connections.length === previous.connections.length
        ? previous : { inventory, connections };
    });
  }, [data, fetching]);

  const hiddenInventory = new Set(dismissed.inventory);
  const hiddenConnections = new Set(dismissed.connections);
  const inventoryCount = data?.inventoryIssueIds.filter((id) => !hiddenInventory.has(id)).length ?? 0;
  const connectionCount = data?.connectionIssueIds.filter((id) => !hiddenConnections.has(id)).length ?? 0;
  function dismissAll() {
    if (!data || fetching) return;
    setDismissed((previous) => ({
      inventory: data.preferences.lowStock ? data.inventoryIssueIds : previous.inventory,
      connections: data.preferences.connectionIssues ? data.connectionIssueIds : previous.connections,
    }));
  }
  return { inventoryCount, connectionCount, dismissAll, storageFailed };
}
