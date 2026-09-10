import type { PortalOrder } from '@/lib/api';
import { type Accent } from '@/lib/accents';
import { cn } from '@/lib/cn';
import { fulfillmentStatusMeta } from '@/lib/status';

// PS-486: presentation only. Table and drawer render the same backend-owned
// fulfillmentStatus; neither may fall back to the historical raw orderStatus.
// CP-069: the label + accent come from the ONE shared map in lib/status.ts
// (fulfillmentStatusMeta — Awaiting shipment / Shipped / Cancelled / Voided, PrepShip's own
// vocabulary, never carrier progress); this component only picks the pill colours.
const BADGE_ACCENT_CLS: Record<Accent, string> = {
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  sky: 'bg-sky-50 text-sky-700 ring-sky-200',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200',
  indigo: 'bg-slate-100 text-slate-600 ring-slate-300',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  teal: 'bg-teal-50 text-teal-700 ring-teal-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
};

export function OrderStatusBadge({ status }: { status: PortalOrder['fulfillmentStatus'] }) {
  const meta = fulfillmentStatusMeta(status);
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', BADGE_ACCENT_CLS[meta.accent])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {meta.label}
    </span>
  );
}
