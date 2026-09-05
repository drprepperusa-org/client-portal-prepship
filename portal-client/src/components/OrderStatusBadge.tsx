import type { PortalOrder } from '@/lib/api';
import { cn } from '@/lib/cn';

// PS-486: presentation only. Table and drawer render the same backend-owned
// fulfillmentStatus; neither may fall back to the historical raw orderStatus.
const ORDER_STATUS_META: Record<PortalOrder['fulfillmentStatus'], { label: string; cls: string }> = {
  pending: { label: 'Awaiting shipment', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  in_transit: { label: 'In Transit', cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  delivered: { label: 'Delivered', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  cancelled: { label: 'Cancelled', cls: 'bg-rose-50 text-rose-700 ring-rose-200' },
  voided: { label: 'Voided', cls: 'bg-slate-100 text-slate-600 ring-slate-300' },
};

export function OrderStatusBadge({ status }: { status: PortalOrder['fulfillmentStatus'] }) {
  const meta = ORDER_STATUS_META[status] ?? ORDER_STATUS_META.pending;
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', meta.cls)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {meta.label}
    </span>
  );
}
