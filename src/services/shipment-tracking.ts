import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { shipments } from '../db/schema/shipments';
import { loadClientCredentials } from '../lib/shipstation/credentials';
import { ssListLabelTracking } from '../lib/shipstation/tracking';
import { chooseTrackingSignal, lookupOfficialCarrierTracking } from './carrier-tracking';

/**
 * On-demand live tracking refresh. Read-only against ShipStation — bulk-reads
 * label tracking_status from /v2/labels (the per-shipment /v2/tracking
 * endpoint is plan-gated on this account) and persists the snapshot on
 * shipments (tracking_status / tracking_status_detail / tracking_checked_at /
 * delivered_at). Never creates labels, buys postage, or notifies anyone.
 *
 * Delivered is terminal: once a shipment is marked delivered it is never
 * polled again. Non-terminal shipments are re-checked at most once per
 * REFRESH_STALE_MS so page reloads stay cheap.
 */

const REFRESH_STALE_MS = 30 * 60 * 1000;
const MAX_PER_REFRESH = 500;

/** ShipStation label tracking_status → our normalized vocabulary. */
export function normalizeTrackingStatus(status: string | null): string | null {
  if (!status) return null;
  const map: Record<string, string> = {
    delivered: 'delivered',
    in_transit: 'in_transit',
    error: 'exception',
  };
  // 'unknown' (and anything unrecognized) carries no signal — skip it so the
  // portal keeps its derived In Transit / Label Created label.
  return map[status.toLowerCase()] ?? null;
}

// ── Label tracking map (per API key, TTL-cached) ─────────────────────────────
// One /v2/labels page sweep covers ~2,000 recent labels per account; cache it
// briefly so a burst of refresh calls (page loads + worker sweep) shares one
// fetch instead of re-paging ShipStation.

const TRACKING_MAP_TTL_MS = 5 * 60 * 1000;
const TRACKING_WINDOW_DAYS = 60;
const trackingMapCache = new Map<string, { at: number; map: Promise<Map<string, string>> }>();

function labelTrackingMap(apiKey: string | undefined): Promise<Map<string, string>> {
  const cacheKey = apiKey ?? 'default';
  const now = Date.now();
  const cached = trackingMapCache.get(cacheKey);
  if (cached && now - cached.at < TRACKING_MAP_TTL_MS) return cached.map;
  const map = ssListLabelTracking({ apiKey, pages: 5, windowDays: TRACKING_WINDOW_DAYS })
    .then((entries) => {
      const byTracking = new Map<string, string>();
      for (const entry of entries) {
        const status = normalizeTrackingStatus(entry.trackingStatus);
        if (status) byTracking.set(entry.trackingNumber, status);
      }
      return byTracking;
    })
    .catch((err) => {
      trackingMapCache.delete(cacheKey);
      throw err;
    });
  trackingMapCache.set(cacheKey, { at: now, map });
  return map;
}

export type TrackingRefreshResult = {
  checked: number;
  updated: Array<{ id: number; trackingStatus: string; deliveredAt: string | null }>;
};

/**
 * CP-033 — advance the canonical RETURN lifecycle from return-shipment tracking.
 *
 * When a RETURN shipment (shipments.isReturn) shows carrier MOVEMENT
 * ('in_transit' or 'delivered'), advance its linked return label_created →
 * in_transit. Backend-owned (returns.status is the SOT); never frontend-inferred.
 *
 * SAFE RULE (documented per the card): carrier 'delivered' advances a return AT
 * MOST to 'in_transit' — it NEVER auto-marks 'received'. Warehouse receiving
 * (POST /returns/:id/inspection) is the SOLE authority for received / inspected.
 * A closed / cancelled / received / inspected return is NEVER regressed (the
 * update only ever touches rows still at 'label_created').
 */
async function advanceReturnsFromTracking(shipmentIds: number[]): Promise<void> {
  const ids = shipmentIds.filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) return;
  try {
    await db.execute(sql`
      update returns r
      set status = 'in_transit', updated_at = now()
      from shipments s
      where r.return_shipment_id = s.id
        and s.id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
        and s.is_return = true
        and coalesce(s.tracking_status, '') in ('in_transit', 'delivered')
        and r.status = 'label_created'
    `);
  } catch (err) {
    console.warn(
      '[shipment-tracking] CP-033 return lifecycle advance failed:',
      err instanceof Error ? err.message : err,
    );
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
      trackingNumber: shipments.trackingNumber,
      labelTracking: shipments.labelTracking,
      carrierCode: shipments.carrierCode,
      labelCarrier: shipments.labelCarrier,
      source: shipments.source,
      trackingStatus: shipments.trackingStatus,
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

  // Offline/test labels have fake tracking numbers — nothing to look up.
  const trackable = candidates.filter(
    (row) => (row.trackingNumber ?? row.labelTracking) && row.source !== 'test_offline',
  );
  if (!trackable.length) return { checked: 0, updated: [] };

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
  const now = new Date();
  for (const row of trackable) {
    const trackingNumber = (row.trackingNumber ?? row.labelTracking)!;
    let shipStationStatus: string | null = null;
    let officialStatus = null;
    try {
      const creds = await credsFor(row.clientId);
      const map = await labelTrackingMap(creds.apiKeyV2 ?? undefined);
      shipStationStatus = map.get(trackingNumber) ?? null;
    } catch (err) {
      console.warn('[shipment-tracking] label map fetch failed', {
        shipmentId: row.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    try {
      officialStatus = await lookupOfficialCarrierTracking({
        carrierCode: row.labelCarrier ?? row.carrierCode,
        trackingNumber,
      });
    } catch (err) {
      console.warn('[shipment-tracking] official carrier tracking fetch failed', {
        shipmentId: row.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    const signal = chooseTrackingSignal({
      official: officialStatus,
      shipStationStatus,
      previousStatus: row.trackingStatus,
    });
    const status = signal?.trackingStatus ?? null;
    if (!status || status === row.trackingStatus) {
      // No signal, or unchanged — record the check so we back off.
      await db.update(shipments).set({ trackingCheckedAt: now }).where(eq(shipments.id, row.id));
      continue;
    }
    const deliveredAt = status === 'delivered' ? signal?.deliveredAt ?? now : null;
    await db
      .update(shipments)
      .set({
        trackingStatus: status,
        trackingStatusDetail: signal?.trackingStatusDetail ?? null,
        trackingCheckedAt: now,
        ...(deliveredAt ? { deliveredAt } : {}),
        updatedAt: now,
      })
      .where(eq(shipments.id, row.id));
    updated.push({ id: row.id, trackingStatus: status, deliveredAt: deliveredAt ? deliveredAt.toISOString() : null });
  }

  // CP-033: advance the canonical return lifecycle for any RETURN shipments in
  // this batch that just moved (label_created → in_transit). Received/inspected
  // stay warehouse-owned — see advanceReturnsFromTracking.
  await advanceReturnsFromTracking(updated.map((u) => u.id));

  return { checked: trackable.length, updated };
}

// ── Background sweep (worker) ─────────────────────────────────────────────────
// Walks recent undelivered shipments oldest-check-first so tracking state
// populates without anyone loading pages. Lookups are bulk map hits, so a
// batch of 500 costs a handful of ShipStation list calls (TTL-cached).

const SWEEP_INTERVAL_MS = 3 * 60 * 1000;
const SWEEP_RECHECK_MS = 6 * 60 * 60 * 1000;
const SWEEP_WINDOW_DAYS = 60;
const SWEEP_BATCH = 500;

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
  console.log('[worker] starting shipment tracking sweep (every 3m, batch 500)');
  sweepTimer = setInterval(() => void runSweepOnce(), SWEEP_INTERVAL_MS);
  void runSweepOnce();
}

export function stopShipmentTrackingSweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
