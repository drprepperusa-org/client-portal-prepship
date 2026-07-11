import { Camera, CheckCircle2, CircleDot, PackageCheck, Truck } from 'lucide-react';
import type { PortalReturnDetail } from '@/lib/api';

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const ACTIVITY_LABELS: Record<string, string> = {
  return_requested: 'Return requested', label_created: 'Return label created',
  label_failed: 'Return label needs attention', label_delivered: 'Return label delivered',
  tracking_status_changed: 'Tracking updated', return_closed: 'Return closed', return_cancelled: 'Return cancelled',
  original_order_placed: 'Original order placed', original_shipment_created: 'Original shipment created',
  original_order_shipped: 'Original order shipped', original_order_delivered: 'Original order delivered',
};

type TimelineItem = { id: string; title: string; detail: string | null; actor: string; at: string; kind: 'return' | 'tracking' | 'inspection' | 'media' };

function timelineItems(detail: PortalReturnDetail): TimelineItem[] {
  const items: TimelineItem[] = [...detail.activity, ...detail.orderActivity].map((event) => ({
    id: `activity-${event.id}`,
    title: ACTIVITY_LABELS[event.eventType] ?? event.eventType.replace(/_/g, ' '),
    detail: event.detail ?? event.status?.replace(/_/g, ' ') ?? null,
    actor: event.actorLabel,
    at: event.eventAt,
    kind: event.eventType === 'tracking_status_changed' ? 'tracking' : 'return',
  }));
  if (!detail.activity.some((event) => event.eventType === 'return_requested') && detail.requestedAt) {
    items.push({ id: 'requested-fallback', title: 'Return requested', detail: null, actor: detail.initiatedBy === 'client' ? 'Client' : 'PrepShip', at: detail.requestedAt, kind: 'return' });
  }
  for (const inspection of detail.inspections) {
    const at = inspection.receivedAt ?? inspection.createdAt;
    if (at) items.push({ id: `inspection-${inspection.id}`, title: 'Inspection recorded', detail: inspection.condition?.replace(/_/g, ' ') ?? inspection.status, actor: inspection.actorLabel, at, kind: 'inspection' });
    for (const media of inspection.media) {
      const mediaAt = media.uploadedAt ?? media.capturedAt;
      if (mediaAt) items.push({ id: `media-${media.id}`, title: 'Attachment saved', detail: media.fileName, actor: inspection.actorLabel, at: mediaAt, kind: 'media' });
    }
  }
  return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

function TimelineIcon({ kind }: { kind: TimelineItem['kind'] }) {
  if (kind === 'tracking') return <Truck size={16} />;
  if (kind === 'inspection') return <PackageCheck size={16} />;
  if (kind === 'media') return <Camera size={16} />;
  return <CheckCircle2 size={16} />;
}

export function ReturnHistoryTimeline({ detail }: { detail: PortalReturnDetail }) {
  const items = timelineItems(detail);
  if (!items.length) return <p className="text-sm text-ink-3">No history recorded yet.</p>;
  return (
    <ol className="relative ml-3 border-l border-slate-200 pl-6" aria-label="Return history">
      {items.map((item) => {
        const parsed = new Date(item.at);
        return (
          <li key={item.id} className="relative pb-6 last:pb-0">
            <span className="absolute -left-[2.15rem] grid h-7 w-7 place-items-center rounded-full bg-brand-50 text-brand-600 ring-4 ring-white" aria-hidden>
              <TimelineIcon kind={item.kind} />
            </span>
            <p className="text-sm font-semibold text-ink">{item.title}</p>
            {item.detail && <p className="mt-0.5 text-xs capitalize text-ink-2">{item.detail}</p>}
            <p className="mt-1 flex items-center gap-1 text-xs text-ink-3">
              <CircleDot size={10} aria-hidden /> {item.actor} · {Number.isNaN(parsed.getTime()) ? item.at : dateTime.format(parsed)}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
