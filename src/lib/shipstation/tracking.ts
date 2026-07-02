import { ssRequest } from './client';

/**
 * Label-based tracking state from ShipStation. The dedicated /v2/tracking
 * endpoint is gated behind a higher billing plan (returns 401 on this
 * account), but /v2/labels — which this account already uses for label-URL
 * recovery — carries a `tracking_status` per label ('delivered' /
 * 'in_transit' / 'error' / 'unknown') that ShipStation keeps updated. Paging
 * the recent labels gives us bulk tracking state in a handful of read-only
 * requests instead of one gated call per shipment.
 *
 * Note: the call shape deliberately matches the proven ssListRecentLabels
 * request (no created_at_start filter — that filter makes ShipStation time
 * out). We page newest-first and stop once labels fall outside the window.
 */
export type LabelTrackingEntry = {
  trackingNumber: string;
  trackingStatus: string | null;
  createdAt: string | null;
};

const PAGE_SIZE = 500;

export async function ssListLabelTracking(args: {
  apiKey?: string;
  /** Max pages to fetch (PAGE_SIZE labels each), newest first. */
  pages?: number;
  /** Stop paging once labels are older than this many days. */
  windowDays?: number;
} = {}): Promise<LabelTrackingEntry[]> {
  const maxPages = args.pages ?? 5;
  const cutoff = args.windowDays ? Date.now() - args.windowDays * 86_400_000 : null;
  const out: LabelTrackingEntry[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const qs = new URLSearchParams({
      page_size: String(PAGE_SIZE),
      sort_dir: 'desc',
      page: String(page),
    });
    const payload = await ssRequest<{ labels?: Array<Record<string, unknown>>; pages?: unknown }>(
      `/v2/labels?${qs.toString()}`,
      {
        apiKey: args.apiKey,
        dedupeKey: `labels:tracking:${args.apiKey ? 'client' : 'default'}:${page}`,
        maxRetries: 2,
      },
    );
    const labels = payload.labels ?? [];
    let pastWindow = false;
    for (const label of labels) {
      const trackingNumber = label.tracking_number ? String(label.tracking_number) : '';
      const createdAt = label.created_at ? String(label.created_at) : null;
      if (cutoff && createdAt) {
        const ts = Date.parse(createdAt);
        if (Number.isFinite(ts) && ts < cutoff) {
          pastWindow = true;
          continue;
        }
      }
      if (!trackingNumber) continue;
      out.push({
        trackingNumber,
        trackingStatus: label.tracking_status ? String(label.tracking_status) : null,
        createdAt,
      });
    }
    const totalPages = Number(payload.pages);
    if (pastWindow || labels.length < PAGE_SIZE || (Number.isFinite(totalPages) && page >= totalPages)) break;
  }
  return out;
}
