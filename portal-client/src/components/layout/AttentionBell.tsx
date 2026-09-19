import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bell, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useAttention } from '@/lib/hooks';
import { usePortalFilters } from '@/lib/portalContext';

export function AttentionBell({ children }: { children: ReactNode }) {
  const { clientId } = usePortalFilters();
  return <ScopedAttentionBell key={clientId ?? 'scope'}>{children}</ScopedAttentionBell>;
}

function ScopedAttentionBell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [clearedCounts, setClearedCounts] = useState<{ connectionCount: number; inventoryCount: number } | null>(null);
  const query = useAttention();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  useEffect(() => setOpen(false), [location]);
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  // Never show cached counts as current after a failed refresh.
  const data = query.isError ? undefined : query.data;
  const isCleared = Boolean(data && clearedCounts
    && data.connectionCount === clearedCounts.connectionCount
    && data.inventoryCount === clearedCounts.inventoryCount);
  return (
    <div ref={root} className="static sm:relative">
      <button ref={trigger} type="button" aria-label="Notifications" aria-expanded={open}
        aria-controls="portal-attention" className="focus-ring relative grid h-10 w-10 place-items-center rounded-glass-sm text-ink-2 hover:bg-slate-100"
        onClick={() => { setOpen(!open); if (!open) void query.refetch(); }}>
        <Bell size={19} />
        {data && !isCleared && data.totalCount > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-rose-600 px-1.5 text-xs font-semibold text-white"
          aria-label={`${data.totalCount} items need attention`}>{data.totalCount > 99 ? '99+' : data.totalCount}</span>}
      </button>
      {open && (
        <section id="portal-attention" aria-label="Needs attention"
          className="glass-strong absolute right-3 z-40 mt-2 max-h-[70vh] w-[min(calc(100vw-3rem),360px)] overflow-y-auto rounded-glass p-4 shadow-glass-lg sm:right-0">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">Needs attention</h2>
            <div className="flex items-center gap-1">
              {data && !isCleared && data.totalCount > 0 && (
                <button type="button" aria-label="Clear all notifications"
                  className="focus-ring rounded-md px-2 py-1 text-xs font-semibold text-brand-700"
                  onClick={() => setClearedCounts({
                    connectionCount: data.connectionCount,
                    inventoryCount: data.inventoryCount,
                  })}>
                  Clear all
                </button>
              )}
              <button type="button" aria-label="Close notifications" className="focus-ring rounded p-1 text-ink-3"
                onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={16} /></button>
            </div>
          </div>
          <p className="mt-1 text-xs text-ink-3">Current issues for your selected client. Date filters do not apply.</p>
          <div className="my-3 space-y-3" aria-live="polite">
            {query.isPending && <p className="text-sm text-ink-3">Checking for issues…</p>}
            {query.isError && <p className="text-sm text-ink-2">Attention items are unavailable. Please retry.</p>}
            {data && isCleared && <p className="text-sm text-ink-2">
              Notifications cleared. Refresh to show current issues again.
            </p>}
            {data && !isCleared && data.totalCount === 0 && <p className="text-sm text-ink-2">
              {data.preferences?.connectionIssues === false && data.preferences.lowStock === false
                ? 'All notification categories are turned off.'
                : data.preferences?.connectionIssues === false || data.preferences?.lowStock === false
                  ? 'No items need attention in your enabled categories.' : 'No items need attention.'}
            </p>}
            {data && !isCleared && data.connectionCount > 0 && <AttentionItem count={data.connectionCount} title="Connections need attention"
              description="Pending approval, reconnect needed, or sync delayed." to="/connections?status=attention" />}
            {data && !isCleared && data.inventoryCount > 0 && <AttentionItem count={data.inventoryCount} title="Low or out of stock"
              description="Products at or below their reorder level, including unavailable stock." to="/inventory?lowStock=1" />}
          </div>
          <button type="button" disabled={query.isFetching} onClick={() => {
            setClearedCounts(null);
            void query.refetch();
          }}
            className="focus-ring rounded-md px-2 py-1 text-xs font-semibold text-brand-700 disabled:opacity-50">
            {query.isFetching ? 'Checking…' : query.isError ? 'Retry notifications' : 'Refresh notifications'}
          </button>
          {data && <p className="mt-1 text-xs text-ink-3">Checked {new Date(data.checkedAt).toLocaleTimeString()}</p>}
          <Link to="/settings/notifications" className="focus-ring mt-3 inline-block rounded text-sm font-semibold text-brand-700">
            Notification settings
          </Link>
          <div className="mt-3 border-t border-slate-200 pt-3">{children}</div>
        </section>
      )}
    </div>
  );
}

function AttentionItem({ count, title, description, to }: { count: number; title: string; description: string; to: string }) {
  return <div className="rounded-glass-sm bg-slate-50 p-3">
    <p className="text-sm font-semibold text-ink">{title} <span className="tnum">({count})</span></p>
    <p className="mt-1 text-xs text-ink-3">{description}</p>
    <Link to={to} state={{ attention: true }} className="focus-ring mt-2 inline-block rounded text-sm font-semibold text-brand-700"
      aria-label={`View details: ${title}`}>View details →</Link>
  </div>;
}
