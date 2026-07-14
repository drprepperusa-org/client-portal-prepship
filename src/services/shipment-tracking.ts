import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { shipments } from '../db/schema/shipments';
import { ShipStationError } from '../lib/shipstation/client';
import { loadClientCredentials } from '../lib/shipstation/credentials';
import {
  ssFindLabelByTrackingNumber,
  ssGetLabelTracking,
  type ShipStationLabelTracking,
} from '../lib/shipstation/tracking';
import {
  chooseTrackingSignal,
  lookupOfficialCarrierTracking,
  officialCarrierTrackingReadiness,
} from './carrier-tracking';
import { recordReturnTrackingActivities } from './return-activity';

/**
 * On-demand live tracking refresh. It reads official carrier tracking first,
 * then reads ShipStation's targeted per-label tracking endpoint as fallback.
 * Missing label IDs resolve once by tracking number and are persisted for
 * future checks. It never creates labels, buys postage, or notifies anyone.
 *
 * Delivered is terminal: once a shipment is marked delivered it is never
 * polled again. Non-terminal shipments are re-checked at most once per
 * REFRESH_STALE_MS so page reloads stay cheap.
 */

const REFRESH_STALE_MS = 30 * 60 * 1000;
const MAX_PER_REFRESH = 500;
const LOOKUP_CONCURRENCY = 10;

export type TrackingRefreshOptions = {
  forceRefresh?: boolean;
  logDiagnostics?: boolean;
};

export function normalizeTrackingNumber(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

function maskTrackingNumber(value: string): string {
  const normalized = normalizeTrackingNumber(value);
  return normalized.length <= 4
    ? '*'.repeat(normalized.length)
    : `${'*'.repeat(normalized.length - 4)}${normalized.slice(-4)}`;
}

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

// ── Targeted ShipStation tracking ────────────────────────────────────────────
/** ShipStation /track status_code -> portal tracking vocabulary. */
export function normalizeShipStationTrackingCode(statusCode: string | null): string | null {
  if (!statusCode) return null;
  const map: Record<string, string> = {
    AC: 'in_transit',
    IT: 'in_transit',
    DE: 'delivered',
    SP: 'delivered',
    EX: 'exception',
    AT: 'attempted',
  };
  return map[statusCode.toUpperCase()] ?? null;
}

type NormalizedShipStationTracking = {
  trackingStatus: string;
  trackingStatusDetail: string | null;
  deliveredAt: Date | null;
};

export function normalizeShipStationTrackingSnapshot(
  details: ShipStationLabelTracking,
): NormalizedShipStationTracking | null {
  const trackingStatus = normalizeShipStationTrackingCode(details.statusCode);
  if (!trackingStatus) return null;
  const parsedDeliveryDate = details.actualDeliveryDate ? new Date(details.actualDeliveryDate) : null;
  const deliveredAt =
    trackingStatus === 'delivered' && parsedDeliveryDate && !Number.isNaN(parsedDeliveryDate.getTime())
      ? parsedDeliveryDate
      : null;
  return {
    trackingStatus,
    trackingStatusDetail: details.statusDescription ?? details.statusDetailDescription ?? null,
    deliveredAt,
  };
}

async function forEachWithConcurrency<T>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      if (item !== undefined) await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

async function lookupShipStationTracking(args: {
  apiKey?: string;
  trackingNumber: string;
  shipstationLabelId: string | null;
  legacyShipmentId: number | null;
}): Promise<{ snapshot: NormalizedShipStationTracking | null; resolvedLabelId: string | null }> {
  const candidates = [
    args.shipstationLabelId,
    args.legacyShipmentId ? `se-${args.legacyShipmentId}` : null,
  ].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);

  for (const labelId of candidates) {
    try {
      const details = await ssGetLabelTracking(labelId, args.apiKey);
      return { snapshot: normalizeShipStationTrackingSnapshot(details), resolvedLabelId: labelId };
    } catch (error) {
      if (!(error instanceof ShipStationError) || error.status !== 404) throw error;
    }
  }

  const label = await ssFindLabelByTrackingNumber(args.trackingNumber, args.apiKey);
  if (!label) return { snapshot: null, resolvedLabelId: null };
  const details = await ssGetLabelTracking(label.labelId, args.apiKey);
  const listStatus = normalizeTrackingStatus(label.trackingStatus);
  return {
    snapshot:
      normalizeShipStationTrackingSnapshot(details) ??
      (listStatus
        ? { trackingStatus: listStatus, trackingStatusDetail: null, deliveredAt: null }
        : null),
    resolvedLabelId: label.labelId,
  };
}

export type TrackingRefreshResult = {
  checked: number;
  failed: number;
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

export async function refreshShipmentTracking(
  shipmentIds: number[],
  options: TrackingRefreshOptions = {},
): Promise<TrackingRefreshResult> {
  const ids = [...new Set(shipmentIds)].filter((id) => Number.isFinite(id) && id > 0).slice(0, MAX_PER_REFRESH);
  if (!ids.length) return { checked: 0, failed: 0, updated: [] };

  const staleBefore = new Date(Date.now() - REFRESH_STALE_MS);
  const freshnessPredicate = options.forceRefresh
    ? sql`true`
    : or(isNull(shipments.trackingCheckedAt), lt(shipments.trackingCheckedAt, staleBefore));
  const candidates = await db
    .select({
      id: shipments.id,
      clientId: shipments.clientId,
      trackingNumber: shipments.trackingNumber,
      labelTracking: shipments.labelTracking,
      carrierCode: shipments.carrierCode,
      labelCarrier: shipments.labelCarrier,
      labelShipmentId: shipments.labelShipmentId,
      shipstationLabelId: shipments.shipstationLabelId,
      source: shipments.source,
      trackingStatus: shipments.trackingStatus,
    })
    .from(shipments)
    .where(
      and(
        inArray(shipments.id, ids),
        eq(shipments.voided, false),
        sql`coalesce(${shipments.trackingStatus}, '') <> 'delivered'`,
        freshnessPredicate,
      ),
    );

  // Offline/test labels have fake tracking numbers — nothing to look up.
  const trackable = candidates.filter(
    (row) => (row.trackingNumber ?? row.labelTracking) && row.source !== 'test_offline',
  );
  if (!trackable.length) return { checked: 0, failed: 0, updated: [] };

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
  let checked = 0;
  let failed = 0;
  const now = new Date();
  await forEachWithConcurrency(trackable, LOOKUP_CONCURRENCY, async (row) => {
    const trackingNumber = (row.trackingNumber ?? row.labelTracking)!;
    let officialStatus = null;
    let officialError: unknown = null;
    let shipStationError: unknown = null;
    let shipStationSnapshot: NormalizedShipStationTracking | null = null;
    let resolvedLabelId: string | null = null;
    let lookupSucceeded = false;
    try {
      officialStatus = await lookupOfficialCarrierTracking({
        carrierCode: row.labelCarrier ?? row.carrierCode,
        trackingNumber,
      });
      lookupSucceeded = Boolean(officialStatus);
    } catch (err) {
      officialError = err;
      console.warn('[shipment-tracking] official carrier tracking fetch failed', {
        shipmentId: row.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    if (!officialStatus) {
      try {
        const creds = await credsFor(row.clientId);
        const result = await lookupShipStationTracking({
          apiKey: creds.apiKeyV2 ?? undefined,
          trackingNumber,
          shipstationLabelId: row.shipstationLabelId,
          legacyShipmentId: row.labelShipmentId,
        });
        shipStationSnapshot = result.snapshot;
        resolvedLabelId = result.resolvedLabelId;
        lookupSucceeded = true;
      } catch (err) {
        shipStationError = err;
        console.warn('[shipment-tracking] targeted ShipStation tracking fetch failed', {
          shipmentId: row.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (!lookupSucceeded) {
      failed += 1;
      const error = shipStationError ?? officialError;
      const message = (error instanceof Error ? error.message : 'Tracking lookup failed').slice(0, 500);
      await db
        .update(shipments)
        .set({ trackingFailedAt: now, trackingError: message, updatedAt: now })
        .where(eq(shipments.id, row.id));
      return;
    }

    checked += 1;
    const signal = chooseTrackingSignal({
      official: officialStatus,
      shipStationStatus: shipStationSnapshot?.trackingStatus ?? null,
      shipStationStatusDetail: shipStationSnapshot?.trackingStatusDetail ?? null,
      shipStationDeliveredAt: shipStationSnapshot?.deliveredAt ?? null,
      previousStatus: row.trackingStatus,
    });
    const status = signal?.trackingStatus ?? null;
    if (options.logDiagnostics) {
      console.info('[shipment-tracking] reconciliation', {
        shipmentId: row.id,
        clientId: row.clientId,
        tracking: maskTrackingNumber(trackingNumber),
        previousStatus: row.trackingStatus,
        shipStationStatus: shipStationSnapshot?.trackingStatus ?? null,
        officialStatus: officialStatus?.trackingStatus ?? null,
        chosenSource: signal?.source ?? null,
        chosenStatus: status,
        changed: Boolean(status && status !== row.trackingStatus),
      });
    }
    if (!status || status === row.trackingStatus) {
      // No signal, or unchanged — record the check so we back off.
      await db
        .update(shipments)
        .set({
          trackingCheckedAt: now,
          trackingFailedAt: null,
          trackingError: null,
          ...(resolvedLabelId ? { shipstationLabelId: resolvedLabelId } : {}),
          ...(signal?.trackingStatusDetail ? { trackingStatusDetail: signal.trackingStatusDetail } : {}),
        })
        .where(eq(shipments.id, row.id));
      return;
    }
    const deliveredAt = status === 'delivered' ? signal?.deliveredAt ?? now : null;
    await db
      .update(shipments)
      .set({
        trackingStatus: status,
        trackingStatusDetail: signal?.trackingStatusDetail ?? null,
        trackingCheckedAt: now,
        trackingFailedAt: null,
        trackingError: null,
        ...(resolvedLabelId ? { shipstationLabelId: resolvedLabelId } : {}),
        ...(deliveredAt ? { deliveredAt } : {}),
        updatedAt: now,
      })
      .where(eq(shipments.id, row.id));
    updated.push({ id: row.id, trackingStatus: status, deliveredAt: deliveredAt ? deliveredAt.toISOString() : null });
  });

  // CP-033: advance the canonical return lifecycle for any RETURN shipments in
  // this batch that just moved (label_created → in_transit). Received/inspected
  // stay warehouse-owned — see advanceReturnsFromTracking.
  await advanceReturnsFromTracking(updated.map((u) => u.id));
  await recordReturnTrackingActivities(
    updated.map((update) => ({
      shipmentId: update.id,
      status: update.trackingStatus,
      eventAt: now,
    })),
  );

  return { checked, failed, updated };
}

// ── Background sweep (worker) ─────────────────────────────────────────────────
// Walks undelivered shipments oldest-check-first so tracking state populates
// without anyone loading pages. Historical rows are checked once; recent rows
// keep refreshing. Targeted calls run with bounded concurrency and persist
// label IDs so later checks need one request each.

const SWEEP_INTERVAL_MS = 3 * 60 * 1000;
const SWEEP_RECHECK_MS = 60 * 60 * 1000;
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
        or(
          sql`${shipments.shipDate} > now() - interval '${sql.raw(String(SWEEP_WINDOW_DAYS))} days'`,
          isNull(shipments.trackingCheckedAt),
        ),
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
    if (result.checked > 0 || result.failed > 0) {
      console.info('[shipment-tracking] sweep', {
        checked: result.checked,
        failed: result.failed,
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
  const readiness = officialCarrierTrackingReadiness();
  console.log('[worker] starting shipment tracking sweep (every 3m, recheck 1h, batch 500)', {
    uspsOfficialTracking: readiness.uspsConfigured ? 'enabled' : 'not_configured_shipstation_fallback',
  });
  sweepTimer = setInterval(() => void runSweepOnce(), SWEEP_INTERVAL_MS);
  void runSweepOnce();
}

export function stopShipmentTrackingSweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
