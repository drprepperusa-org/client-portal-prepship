/**
 * Read-only CP-042 tracking diagnostic.
 *
 * Usage:
 *   npm run diagnose:shipment-tracking -- --tracking=9400...
 *   npm run diagnose:shipment-tracking -- --shipment-id=123
 *   npm run diagnose:shipment-tracking -- --order-id=456
 *
 * This script never writes shipment state and never prints carrier credentials.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '../src/db/client';
import { shipments } from '../src/db/schema/shipments';
import { loadClientCredentials } from '../src/lib/shipstation/credentials';
import {
  ssFindLabelByTrackingNumber,
  ssGetLabelTracking,
} from '../src/lib/shipstation/tracking';
import {
  chooseTrackingSignal,
  lookupOfficialCarrierTracking,
  officialCarrierTrackingReadiness,
} from '../src/services/carrier-tracking';
import {
  normalizeTrackingNumber,
  normalizeShipStationTrackingSnapshot,
} from '../src/services/shipment-tracking';

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim() || null;
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1]?.trim() || null : null;
}

function positiveInteger(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function maskTrackingNumber(value: string): string {
  const normalized = normalizeTrackingNumber(value);
  return normalized.length <= 4
    ? '*'.repeat(normalized.length)
    : `${'*'.repeat(normalized.length - 4)}${normalized.slice(-4)}`;
}

async function main(): Promise<void> {
  const tracking = argValue('tracking');
  const shipmentId = positiveInteger(argValue('shipment-id'));
  const orderId = positiveInteger(argValue('order-id'));
  const orderNumber = argValue('order-number');

  if (!tracking && !shipmentId && !orderId && !orderNumber) {
    throw new Error(
      'Provide --tracking, --shipment-id, --order-id, or --order-number. This command is read-only.',
    );
  }

  const normalizedTracking = tracking ? normalizeTrackingNumber(tracking) : null;
  const selector = shipmentId
    ? eq(shipments.id, shipmentId)
    : orderId
      ? eq(shipments.orderId, orderId)
      : orderNumber
        ? eq(shipments.orderNumber, orderNumber)
        : sql`replace(replace(coalesce(${shipments.trackingNumber}, ${shipments.labelTracking}, ''), ' ', ''), '-', '') = ${normalizedTracking}`;

  const rows = await db
    .select({
      id: shipments.id,
      orderId: shipments.orderId,
      orderNumber: shipments.orderNumber,
      clientId: shipments.clientId,
      trackingNumber: shipments.trackingNumber,
      labelTracking: shipments.labelTracking,
      carrierCode: shipments.carrierCode,
      labelCarrier: shipments.labelCarrier,
      trackingStatus: shipments.trackingStatus,
      trackingStatusDetail: shipments.trackingStatusDetail,
      trackingCheckedAt: shipments.trackingCheckedAt,
      deliveredAt: shipments.deliveredAt,
      voided: shipments.voided,
      source: shipments.source,
    })
    .from(shipments)
    .where(selector)
    .limit(25);

  if (!rows.length) {
    console.log(JSON.stringify({ found: false, readOnly: true }, null, 2));
    return;
  }

  const diagnostics = [];
  for (const row of rows) {
    const rowTracking = row.trackingNumber ?? row.labelTracking;
    if (!rowTracking) {
      diagnostics.push({
        shipmentId: row.id,
        orderId: row.orderId,
        orderNumber: row.orderNumber,
        tracking: null,
        localStatus: row.trackingStatus,
        result: 'not_trackable',
      });
      continue;
    }

    const creds = await loadClientCredentials(row.clientId);
    let shipStationStatus: string | null = null;
    let shipStationDetail: string | null = null;
    let shipStationDeliveredAt: Date | null = null;
    let shipStationLookup: 'ok' | 'failed' = 'ok';
    try {
      const label = await ssFindLabelByTrackingNumber(rowTracking, creds.apiKeyV2 ?? undefined);
      if (label) {
        const snapshot = normalizeShipStationTrackingSnapshot(
          await ssGetLabelTracking(label.labelId, creds.apiKeyV2 ?? undefined),
        );
        shipStationStatus = snapshot?.trackingStatus ?? null;
        shipStationDetail = snapshot?.trackingStatusDetail ?? null;
        shipStationDeliveredAt = snapshot?.deliveredAt ?? null;
      }
    } catch {
      shipStationLookup = 'failed';
    }

    let official = null;
    let officialLookup: 'ok' | 'failed' = 'ok';
    try {
      official = await lookupOfficialCarrierTracking({
        carrierCode: row.labelCarrier ?? row.carrierCode,
        trackingNumber: rowTracking,
      });
    } catch {
      officialLookup = 'failed';
    }

    const chosen = chooseTrackingSignal({
      official,
      shipStationStatus,
      shipStationStatusDetail: shipStationDetail,
      shipStationDeliveredAt,
      previousStatus: row.trackingStatus,
    });
    diagnostics.push({
      shipmentId: row.id,
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      clientId: row.clientId,
      credentialSourceClientId: creds.sourceClientId,
      tracking: maskTrackingNumber(rowTracking),
      carrierCode: row.labelCarrier ?? row.carrierCode,
      local: {
        status: row.trackingStatus,
        detail: row.trackingStatusDetail,
        checkedAt: row.trackingCheckedAt?.toISOString() ?? null,
        deliveredAt: row.deliveredAt?.toISOString() ?? null,
        voided: row.voided,
        source: row.source,
      },
      external: {
        shipStationLookup,
        shipStationStatus,
        shipStationDetail,
        shipStationDeliveredAt: shipStationDeliveredAt?.toISOString() ?? null,
        officialLookup,
        officialStatus: official?.trackingStatus ?? null,
        officialDetail: official?.trackingStatusDetail ?? null,
        officialDeliveredAt: official?.deliveredAt?.toISOString() ?? null,
      },
      reconciliation: {
        chosenSource: chosen?.source ?? null,
        chosenStatus: chosen?.trackingStatus ?? null,
        wouldUpdate: Boolean(chosen && chosen.trackingStatus !== row.trackingStatus),
      },
    });
  }

  console.log(
    JSON.stringify(
      {
        found: true,
        readOnly: true,
        officialTracking: officialCarrierTrackingReadiness(),
        diagnostics,
      },
      null,
      2,
    ),
  );
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
