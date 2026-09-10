import { useEffect, useRef } from 'react';
import { useAuth } from '@/auth';
import { portalApi, type PortalReturnRow } from '@/lib/api';

/**
 * CP-069: live carrier tracking for the return labels on screen.
 *
 * This is the ONE browser-driven tracking refresh in the portal. It lives on the Returns
 * surface because that surface's display DOES depend on carrier telemetry (CP-033
 * label_created -> in_transit advance, CP-062 "Delivered — ready to receive"); the outbound
 * Orders / Shipments surfaces show PrepShip's fulfillment truth and never refresh tracking.
 *
 * The client names returns, never shipments; the backend resolves the return shipment ids under
 * the caller's scope and answers with counts only. Targeted per-label lookups keep the forced
 * refresh cheap; a change triggers one refetch of the CP-062 contract.
 */
export function useReturnTrackingRefresh(rows: PortalReturnRow[], refetch: () => Promise<unknown>): void {
  const { accessToken } = useAuth();
  const lastTrackingKey = useRef('');
  useEffect(() => {
    if (!accessToken || !rows.length) return;
    const ids = rows
      .filter((r) => r.trackingNumber && (r.status === 'label_created' || r.status === 'in_transit'))
      .map((r) => r.id);
    if (!ids.length) return;
    const key = ids.join(',');
    if (lastTrackingKey.current === key) return;
    lastTrackingKey.current = key;
    const refreshPageTracking = async () => {
      let changed = false;
      for (let index = 0; index < ids.length; index += 100) {
        const result = await portalApi.refreshReturnTracking(accessToken, ids.slice(index, index + 100));
        changed ||= result.updated > 0;
      }
      if (changed) await refetch();
    };
    void refreshPageTracking().catch(() => {
      // Non-fatal: the table still shows the last persisted status.
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, accessToken]);
}
