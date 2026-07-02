import { ssRequest, ShipStationError } from './client';

/**
 * ShipStation v2 tracking lookup (GET /v2/tracking?carrier_code&tracking_number).
 * Read-only against the carrier — no labels, postage, or notifications are
 * ever triggered from this path.
 */
export type SsTrackingInfo = {
  statusCode: string | null;
  statusDescription: string | null;
  carrierStatusDescription: string | null;
  estimatedDeliveryDate: string | null;
  actualDeliveryDate: string | null;
};

type TrackingResponse = {
  status_code?: unknown;
  status_description?: unknown;
  carrier_status_description?: unknown;
  estimated_delivery_date?: unknown;
  actual_delivery_date?: unknown;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

export async function ssGetTracking(args: {
  carrierCode: string;
  trackingNumber: string;
  apiKey?: string;
}): Promise<SsTrackingInfo | null> {
  const qs = new URLSearchParams({
    carrier_code: args.carrierCode,
    tracking_number: args.trackingNumber,
  });
  try {
    const res = await ssRequest<TrackingResponse>(`/v2/tracking?${qs.toString()}`, {
      apiKey: args.apiKey,
      dedupeKey: `tracking:${args.carrierCode}:${args.trackingNumber}`,
      maxRetries: 2,
      timeoutMs: 20_000,
    });
    return {
      statusCode: str(res.status_code),
      statusDescription: str(res.status_description),
      carrierStatusDescription: str(res.carrier_status_description),
      estimatedDeliveryDate: str(res.estimated_delivery_date),
      actualDeliveryDate: str(res.actual_delivery_date),
    };
  } catch (err) {
    // Unknown/invalid tracking numbers come back 400/404 — treat as "no data"
    // so one bad number never fails a whole refresh batch.
    if (err instanceof ShipStationError && (err.status === 400 || err.status === 404)) return null;
    throw err;
  }
}
