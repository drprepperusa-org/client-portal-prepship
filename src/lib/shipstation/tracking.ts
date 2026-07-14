import { ssRequest } from './client';

export type ShipStationLabelMatch = {
  labelId: string;
  trackingStatus: string | null;
  createdAt: string | null;
};

export type ShipStationLabelTracking = {
  trackingNumber: string | null;
  statusCode: string | null;
  statusDescription: string | null;
  statusDetailCode: string | null;
  statusDetailDescription: string | null;
  actualDeliveryDate: string | null;
};

const TARGETED_TRACKING_TIMEOUT_MS = 15_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function textAt(record: Record<string, unknown> | null, keys: string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function normalizeTrackingNumber(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

/** Resolve a ShipStation label ID only when the shipment does not already store it. */
export async function ssFindLabelByTrackingNumber(
  trackingNumber: string,
  apiKey?: string,
): Promise<ShipStationLabelMatch | null> {
  const normalized = normalizeTrackingNumber(trackingNumber);
  if (!normalized) return null;
  const query = new URLSearchParams({ tracking_number: normalized, page_size: '1' });
  const payload = await ssRequest<{ labels?: unknown[] }>(`/v2/labels?${query.toString()}`, {
    apiKey,
    maxRetries: 2,
    timeoutMs: TARGETED_TRACKING_TIMEOUT_MS,
  });
  const label = (payload.labels ?? [])
    .map(asRecord)
    .find((row) => normalizeTrackingNumber(textAt(row, ['tracking_number']) ?? '') === normalized);
  const labelId = textAt(label ?? null, ['label_id']);
  if (!labelId) return null;
  return {
    labelId,
    trackingStatus: textAt(label ?? null, ['tracking_status']),
    createdAt: textAt(label ?? null, ['created_at']),
  };
}

/** Fast per-label tracking lookup. This replaces the former 2,500-label account scan. */
export async function ssGetLabelTracking(
  labelId: string,
  apiKey?: string,
): Promise<ShipStationLabelTracking> {
  const normalizedLabelId = labelId.trim();
  if (!normalizedLabelId) throw new Error('ShipStation label ID is required');
  const payload = asRecord(
    await ssRequest<unknown>(`/v2/labels/${encodeURIComponent(normalizedLabelId)}/track`, {
      apiKey,
      maxRetries: 2,
      timeoutMs: TARGETED_TRACKING_TIMEOUT_MS,
    }),
  );
  return {
    trackingNumber: textAt(payload, ['tracking_number']),
    statusCode: textAt(payload, ['status_code']),
    statusDescription: textAt(payload, ['status_description']),
    statusDetailCode: textAt(payload, ['status_detail_code']),
    statusDetailDescription: textAt(payload, ['status_detail_description']),
    actualDeliveryDate: textAt(payload, ['actual_delivery_date']),
  };
}
