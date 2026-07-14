import { env } from '../lib/env';

export type OfficialCarrier = 'usps' | 'ups' | 'fedex';

export type OfficialTrackingSnapshot = {
  carrier: OfficialCarrier;
  trackingStatus: string;
  trackingStatusDetail: string | null;
  deliveredAt: Date | null;
};

export type TrackingSignal = OfficialTrackingSnapshot & {
  source: 'carrier' | 'shipstation';
};

const USPS_TOKEN_SKEW_MS = 60_000;
const CARRIER_REQUEST_TIMEOUT_MS = 10_000;
let uspsTokenCache: { token: string; expiresAt: number } | null = null;

export function officialCarrierTrackingReadiness(): { uspsConfigured: boolean } {
  return {
    uspsConfigured: Boolean(env.USPS_TRACKING_CLIENT_ID && env.USPS_TRACKING_CLIENT_SECRET),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function textAt(obj: Record<string, unknown> | null, keys: string[]): string | null {
  if (!obj) return null;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function dateAt(obj: Record<string, unknown> | null, keys: string[]): Date | null {
  const raw = textAt(obj, keys);
  if (!raw) return null;
  const dt = new Date(raw);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function normalizeCarrier(carrierCode: string | null | undefined, trackingNumber: string): OfficialCarrier | null {
  const carrier = (carrierCode ?? '').toLowerCase();
  if (carrier.includes('usps') || carrier.includes('stamps')) return 'usps';
  if (carrier.includes('ups')) return 'ups';
  if (carrier.includes('fedex') || carrier.includes('fdx')) return 'fedex';
  const compact = trackingNumber.replace(/[\s-]/g, '');
  if (/^1z[0-9a-z]{16}$/i.test(compact)) return 'ups';
  if (/^(9\d{19,25}|\d{20,22})$/.test(compact)) return 'usps';
  if (/^\d{12,22}$/.test(compact)) return 'fedex';
  return null;
}

function statusFromText(text: string | null): string | null {
  const lower = (text ?? '').toLowerCase();
  if (!lower) return null;
  if (lower.includes('delivered')) return 'delivered';
  if (lower.includes('attempt')) return 'attempted';
  if (lower.includes('exception') || lower.includes('alert') || lower.includes('failure')) return 'exception';
  if (lower.includes('transit') || lower.includes('departed') || lower.includes('arrived') || lower.includes('moving')) {
    return 'in_transit';
  }
  return null;
}

function trackingEvents(payload: Record<string, unknown>): Record<string, unknown>[] {
  const direct = payload.trackingEvents;
  if (Array.isArray(direct)) return direct.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item));
  const embedded = asRecord(payload.trackingEventSummary)?.trackingEvents;
  if (Array.isArray(embedded)) return embedded.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item));
  return [];
}

export function normalizeOfficialTrackingSnapshot(
  carrier: OfficialCarrier,
  payload: unknown,
): OfficialTrackingSnapshot | null {
  const root = asRecord(payload);
  if (!root) return null;
  const detail =
    textAt(root, ['status', 'statusSummary', 'trackingStatus', 'eventSummary', 'mailPieceStatus']) ??
    textAt(asRecord(root.summary), ['status', 'statusSummary', 'eventSummary']);
  const category =
    textAt(root, ['statusCategory', 'statusCategoryCode', 'trackingStatusCategory']) ??
    textAt(asRecord(root.summary), ['statusCategory', 'statusCategoryCode']);

  const events = trackingEvents(root);
  const deliveredEvent = events.find((event) => {
    const eventText = textAt(event, ['eventType', 'event', 'status', 'eventDescription', 'activity']);
    return statusFromText(eventText) === 'delivered';
  });
  const latestEvent = events[0] ?? null;
  const eventStatus = statusFromText(
    textAt(latestEvent, ['eventType', 'event', 'status', 'eventDescription', 'activity']),
  );
  const trackingStatus = statusFromText(category) ?? statusFromText(detail) ?? eventStatus;
  if (!trackingStatus) return null;

  const deliveredAt =
    trackingStatus === 'delivered'
      ? dateAt(deliveredEvent ?? root, [
          'eventTimestamp',
          'eventDateTime',
          'dateTime',
          'timestamp',
          'actualDeliveryDate',
          'deliveryDate',
        ])
      : null;

  return {
    carrier,
    trackingStatus,
    trackingStatusDetail: detail ?? category ?? null,
    deliveredAt,
  };
}

export function chooseTrackingSignal(args: {
  official: OfficialTrackingSnapshot | null;
  shipStationStatus: string | null;
  shipStationStatusDetail?: string | null;
  shipStationDeliveredAt?: Date | null;
  previousStatus: string | null;
}): TrackingSignal | null {
  if (args.previousStatus === 'delivered') return null;
  if (args.official) {
    return { ...args.official, source: 'carrier' };
  }
  if (args.shipStationStatus) {
    return {
      carrier: 'usps',
      source: 'shipstation',
      trackingStatus: args.shipStationStatus,
      trackingStatusDetail: args.shipStationStatusDetail ?? null,
      deliveredAt: args.shipStationDeliveredAt ?? null,
    };
  }
  return null;
}

async function uspsAccessToken(): Promise<string | null> {
  const clientId = env.USPS_TRACKING_CLIENT_ID;
  const clientSecret = env.USPS_TRACKING_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const now = Date.now();
  if (uspsTokenCache && uspsTokenCache.expiresAt - USPS_TOKEN_SKEW_MS > now) return uspsTokenCache.token;

  const base = env.USPS_TRACKING_BASE_URL.replace(/\/+$/, '');
  const res = await fetch(`${base}/oauth2/v3/token`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(CARRIER_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`USPS OAuth failed (${res.status})`);
  }
  const payload = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new Error('USPS OAuth response missing access_token');
  uspsTokenCache = {
    token: payload.access_token,
    expiresAt: now + Math.max(60, Number(payload.expires_in ?? 3600)) * 1000,
  };
  return uspsTokenCache.token;
}

async function lookupUspsTracking(trackingNumber: string): Promise<OfficialTrackingSnapshot | null> {
  const token = await uspsAccessToken();
  if (!token) return null;
  const base = env.USPS_TRACKING_BASE_URL.replace(/\/+$/, '');
  const url = `${base}/tracking/v3/tracking/${encodeURIComponent(trackingNumber)}?expand=DETAIL`;
  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(CARRIER_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`USPS tracking failed (${res.status})`);
  return normalizeOfficialTrackingSnapshot('usps', await res.json());
}

export async function lookupOfficialCarrierTracking(args: {
  carrierCode?: string | null;
  trackingNumber: string;
}): Promise<OfficialTrackingSnapshot | null> {
  const trackingNumber = args.trackingNumber.replace(/[\s-]/g, '');
  if (!trackingNumber) return null;
  const carrier = normalizeCarrier(args.carrierCode, trackingNumber);
  if (carrier === 'usps') return lookupUspsTracking(trackingNumber);
  return null;
}
