import { useEffect, useRef, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth';
import { useAttention } from '@/lib/hooks';
import { usePortalFilters } from '@/lib/portalContext';

export function AttentionBell() {
  const { clientId } = usePortalFilters();
  const { userId } = useAuth();
  const scopeKey = `${userId ?? 'anonymous'}:${clientId ?? 'scope'}`;
  return <ScopedAttentionBell key={scopeKey} scopeKey={scopeKey} />;
}

interface ClearedCounts {
  connectionCount: number;
  inventoryCount: number;
}

function ScopedAttentionBell({ scopeKey }: { scopeKey: string }) {
  const storageKey = `portal-attention-cleared:${scopeKey}`;
  const [open, setOpen] = useState(false);
  const [clearedCounts, setClearedCounts] = useState<ClearedCounts | null>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (!saved) return null;
      const parsed = JSON.parse(saved) as Partial<ClearedCounts>;
      return Number.isFinite(parsed.connectionCount) && Number.isFinite(parsed.inventoryCount)
        ? { connectionCount: parsed.connectionCount!, inventoryCount: parsed.inventoryCount! }
        : null;
    } catch {
      return null;
    }
  });
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
  useEffect(() => {
    if (!data || !clearedCounts || isCleared) return;
    setClearedCounts(null);
    localStorage.removeItem(storageKey);
  }, [clearedCounts, data, isCleared, storageKey]);

  function clearAll() {
    if (!data) return;
    const snapshot = { connectionCount: data.connectionCount, inventoryCount: data.inventoryCount };
    setClearedCounts(snapshot);
    localStorage.setItem(storageKey, JSON.stringify(snapshot));
  }
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
                  onClick={clearAll}>
                  Clear all
                </button>
              )}
              <button type="button" aria-label="Close notifications" className="focus-ring rounded p-1 text-ink-3"
                onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={16} /></button>
            </div>
          </div>
          <div className="mt-3 space-y-2" aria-live="polite">
            {query.isPending && <p className="text-sm text-ink-3">Checking for issues…</p>}
            {query.isError && <div>
              <p className="text-sm text-ink-2">Notifications are unavailable.</p>
              <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}
                className="focus-ring mt-2 rounded-md text-xs font-semibold text-brand-700 disabled:opacity-50">
                {query.isFetching ? 'Checking…' : 'Retry'}
              </button>
            </div>}
            {data && (isCleared || data.totalCount === 0) && <p className="text-sm text-ink-2">No notifications.</p>}
            {data && !isCleared && data.connectionCount > 0 && <AttentionItem count={data.connectionCount} title="Connections need attention"
              to="/connections?status=attention" />}
            {data && !isCleared && data.inventoryCount > 0 && <AttentionItem count={data.inventoryCount} title="Low or out of stock"
              to="/inventory?lowStock=1" />}
          </div>
        </section>
      )}
    </div>
  );
}

function AttentionItem({ count, title, to }: { count: number; title: string; to: string }) {
  return <div className="rounded-glass-sm bg-slate-50 p-3">
    <p className="text-sm font-semibold text-ink">{title} <span className="tnum">({count})</span></p>
    <Link to={to} state={{ attention: true }} className="focus-ring mt-1 inline-block rounded text-sm font-semibold text-brand-700"
      aria-label={`View details: ${title}`}>View details →</Link>
  </div>;
}
