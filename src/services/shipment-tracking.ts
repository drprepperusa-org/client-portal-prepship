import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { shipments } from '../db/schema/shipments';
import { loadClientCredentials } from '../lib/shipstation/credentials';
import { ssGetTracking } from '../lib/shipstation/tracking';

/**
 * On-demand live tracking refresh. Read-only against ShipStation — looks up
 * tracking state for existing labels and persists the snapshot on shipments
 * (tracking_status / tracking_status_detail / tracking_checked_at /
 * delivered_at). Never creates labels, buys postage, or notifies anyone.
 *
 * Delivered is terminal: once a shipment is marked delivered it is never
 * polled again. Non-terminal shipments are re-polled at most once per
 * REFRESH_STALE_MS so a page reload doesn't hammer the carrier API.
 */

const REFRESH_STALE_MS = 30 * 60 * 1000;
const MAX_PER_REFRESH = 60;
const CONCURRENCY = 4;

/** ShipStation v2 status codes → our normalized vocabulary. */
export function normalizeTrackingStatus(code: string | null): string | null {
  if (!code) return null;
  const map: Record<string, string> = {
    DE: 'delivered',
    IT: 'in_transit',
    AC: 'accepted',
    AT: 'attempted',
    EX: 'exception',
    NY: 'not_yet_in_system',
    UN: 'unknown',
  };
  return map[code.toUpperCase()] ?? 'unknown';
}

async function withConcurrency<T>(items: T[], fn: (item: T) => Promise<void>, maxConcurrent: number): Promise<void> {
  const queue = [...items];
  const running = new Set<Promise<void>>();
  while (queue.length > 0 || running.size > 0) {
    while (running.size < maxConcurrent && queue.length > 0) {
      const item = queue.shift();
      if (item !== undefined) {
        const task = fn(item).finally(() => running.delete(task));
        running.add(task);
      }
    }
    if (running.size > 0) await Promise.race(running);
  }
}

export type TrackingRefreshResult = {
  checked: number;
  updated: Array<{ id: number; trackingStatus: string; deliveredAt: string | null }>;
};

// ── Background sweep (worker) ─────────────────────────────────────────────────
// Walks recent undelivered shipments oldest-check-first so tracking state
// populates without anyone loading pages. 60 lookups per run every 3 minutes
// clears a multi-thousand backlog in a few hours; steady-state re-polls each
// active shipment roughly every 6 hours.

const SWEEP_INTERVAL_MS = 3 * 60 * 1000;
const SWEEP_RECHECK_MS = 6 * 60 * 60 * 1000;
const SWEEP_WINDOW_DAYS = 60;
const SWEEP_BATCH = 60;

export async function sweepShipmentTracking(): Promise<TrackingRefreshResult> {
  const recheckBefore = new Date(Date.now() - SWEEP_RECHECK_MS);
  const candidates = await db
    .select({ id: shipments.id })
    .from(shipments)
    .where(
      and(
        eq(shipments.voided, false),
        sql`coalesce(${shipments.source}, '') <> 'test_offline'`,
        sql`coalesce(${shipments.trackingStatus}, '') <> 'delivered'`,
        or(sql`${shipments.trackingNumber} is not null`, sql`${shipments.labelTracking} is not null`),
        sql`${shipments.carrierCode} is not null`,
        sql`${shipments.shipDate} > now() - interval '${sql.raw(String(SWEEP_WINDOW_DAYS))} days'`,
        or(isNull(shipments.trackingCheckedAt), lt(shipments.trackingCheckedAt, recheckBefore)),
      ),
    )
    .orderBy(sql`${shipments.trackingCheckedAt} asc nulls first`, sql`${shipments.shipDate} desc`)
    .limit(SWEEP_BATCH);
  return refreshShipmentTracking(candidates.map((row) => row.id));
}

let sweepTimer: NodeJS.Timeout | null = null;
let sweepRunning = false;

async function runSweepOnce(): Promise<void> {
  if (sweepRunning) return;
  sweepRunning = true;
  try {
    const result = await sweepShipmentTracking();
    if (result.checked > 0) {
      console.info('[shipment-tracking] sweep', {
        checked: result.checked,
        updated: result.updated.length,
        delivered: result.updated.filter((u) => u.trackingStatus === 'delivered').length,
      });
    }
  } catch (err) {
    console.warn('[shipment-tracking] sweep failed:', err instanceof Error ? err.message : err);
  } finally {
    sweepRunning = false;
  }
}

export function startShipmentTrackingSweep(): void {
  if (sweepTimer) return;
  console.log('[worker] starting shipment tracking sweep (every 3m, batch 60)');
  sweepTimer = setInterval(() => void runSweepOnce(), SWEEP_INTERVAL_MS);
  void runSweepOnce();
}

export function stopShipmentTrackingSweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

export async function refreshShipmentTracking(shipmentIds: number[]): Promise<TrackingRefreshResult> {
  const ids = [...new Set(shipmentIds)].filter((id) => Number.isFinite(id) && id > 0).slice(0, MAX_PER_REFRESH);
  if (!ids.length) return { checked: 0, updated: [] };

  const staleBefore = new Date(Date.now() - REFRESH_STALE_MS);
  const candidates = await db
    .select({
      id: shipments.id,
      clientId: shipments.clientId,
      carrierCode: shipments.carrierCode,
      trackingNumber: shipments.trackingNumber,
      labelTracking: shipments.labelTracking,
      source: shipments.source,
    })
    .from(shipments)
    .where(
      and(
        inArray(shipments.id, ids),
        eq(shipments.voided, false),
        sql`coalesce(${shipments.trackingStatus}, '') <> 'delivered'`,
        or(isNull(shipments.trackingCheckedAt), lt(shipments.trackingCheckedAt, staleBefore)),
      ),
    );

  // Offline/test labels have fake tracking numbers — never send those to SS.
  const trackable = candidates.filter(
    (row) => row.carrierCode && (row.trackingNumber ?? row.labelTracking) && row.source !== 'test_offline',
  );

  const credsCache = new Map<number | null, Promise<{ apiKeyV2: string | null }>>();
  const credsFor = (clientId: number | null) => {
    let p = credsCache.get(clientId);
    if (!p) {
      p = loadClientCredentials(clientId);
      credsCache.set(clientId, p);
    }
    return p;
  };

  const updated: TrackingRefreshResult['updated'] = [];
  await withConcurrency(
    trackable,
    async (row) => {
      const trackingNumber = (row.trackingNumber ?? row.labelTracking)!;
      const now = new Date();
      let info;
      try {
        const creds = await credsFor(row.clientId);
        info = await ssGetTracking({
          carrierCode: row.carrierCode!,
          trackingNumber,
          apiKey: creds.apiKeyV2 ?? undefined,
        });
      } catch (err) {
        console.warn('[shipment-tracking] lookup failed', {
          shipmentId: row.id,
          message: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      if (!info) {
        // No data for this number — record the check so we back off.
        await db.update(shipments).set({ trackingCheckedAt: now }).where(eq(shipments.id, row.id));
        return;
      }
      const status = normalizeTrackingStatus(info.statusCode);
      if (!status) {
        await db.update(shipments).set({ trackingCheckedAt: now }).where(eq(shipments.id, row.id));
        return;
      }
      const parsedDelivered = info.actualDeliveryDate ? new Date(info.actualDeliveryDate) : null;
      const deliveredAt =
        parsedDelivered && !Number.isNaN(parsedDelivered.getTime())
          ? parsedDelivered
          : status === 'delivered'
            ? now
            : null;
      await db
        .update(shipments)
        .set({
          trackingStatus: status,
          trackingStatusDetail: info.carrierStatusDescription ?? info.statusDescription,
          trackingCheckedAt: now,
          ...(deliveredAt ? { deliveredAt } : {}),
          updatedAt: now,
        })
        .where(eq(shipments.id, row.id));
      updated.push({ id: row.id, trackingStatus: status, deliveredAt: deliveredAt ? deliveredAt.toISOString() : null });
    },
    CONCURRENCY,
  );

  return { checked: trackable.length, updated };
}
