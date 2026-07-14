import { motion } from 'framer-motion';
import { Inbox } from 'lucide-react';
import { useOrders } from '@/lib/hooks';
import { shortDate } from '@/lib/status';
import { staggerContainer, staggerItem } from '@/lib/motion';
import { QueryState } from '@/components/ui/QueryState';

/* ───────────────────────── live open-orders list ───────────────────────── */

export function OpenOrdersPeek() {
  const q = useOrders({ status: 'awaiting_shipment', pageSize: 6 });
  const rows = (q.data?.data ?? []).slice(0, 6);
  if (q.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-glass-sm bg-slate-100/80" />
        ))}
      </div>
    );
  }
  if (q.isError) {
    return (
      <QueryState isLoading={false} isError onRetry={() => q.refetch()}>
        <></>
      </QueryState>
    );
  }
  if (!rows.length) {
    return (
      <div className="grid place-items-center gap-2 rounded-glass-sm bg-white/40 py-7 text-center ring-1 ring-slate-200/60">
        <Inbox size={22} className="text-ink-3" />
        <p className="text-sm text-ink-3">No orders awaiting shipment 🎉</p>
      </div>
    );
  }
  return (
    <motion.ul variants={staggerContainer} initial="initial" animate="enter" className="space-y-2">
      {rows.map((o) => (
        <motion.li
          key={o.id}
          variants={staggerItem}
          className="flex items-center gap-3 rounded-glass-sm bg-white/55 px-3 py-2.5 ring-1 ring-slate-200/70 transition-colors hover:bg-white/80"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-50 text-[11px] font-bold text-amber-600 ring-1 ring-amber-200">
            {o.orderedUnits}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-brand-700">{o.orderNumber ?? `#${o.id}`}</p>
            <p className="truncate text-xs text-ink-3">{o.clientName ?? '—'}</p>
          </div>
          <span className="shrink-0 text-xs text-ink-3 tnum">{shortDate(o.orderDate)}</span>
        </motion.li>
      ))}
    </motion.ul>
  );
}
