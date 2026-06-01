import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Search, RefreshCw, Check, Zap, AlertCircle } from 'lucide-react';
import { HoverZoomImage } from '@/components/ui/HoverZoomImage';
import { GlassPanel } from '@/components/ui/Glass';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Chip } from '@/components/ui/Display';
import { Drawer } from '@/components/ui/Drawer';
import { QueryState } from '@/components/ui/QueryState';
import { Pagination } from '@/components/ui/Pagination';
import { CarrierBadge } from '@/components/store/CarrierBadge';
import { OrderDetailPanel, fmtWeight } from '@/components/OrderDetailPanel';
import { useOrders, useSyncStatus } from '@/lib/hooks';
import { useDebounced } from '@/lib/useDebounced';
import { usePortalFilters } from '@/lib/portalContext';
import { useAuth } from '@/auth';
import { portalApi } from '@/lib/api';
import { itemCount, money, shortDate } from '@/lib/status';
import type { PortalOrder, BackfillJob } from '@/lib/api';
import { type Accent } from '@/lib/accents';
import { cn } from '@/lib/cn';

const TABS = [
  { id: 'awaiting_shipment', label: 'Awaiting shipment' },
  { id: 'shipped', label: 'Shipped' },
  { id: 'cancelled', label: 'Cancelled' },
] as const;
type Tab = (typeof TABS)[number]['id'];

const CLIENT_ACCENTS: Accent[] = ['emerald', 'rose', 'indigo', 'amber', 'teal', 'violet', 'sky'];
function clientAccent(name: string | null): Accent {
  const s = name ?? '';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i)) % CLIENT_ACCENTS.length;
  return CLIENT_ACCENTS[h];
}
function fmtDateTime(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: '—', time: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '—', time: '' };
  return {
    date: d.toLocaleDateString('en-US', { year: '2-digit', month: '2-digit', day: '2-digit' }),
    time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
  };
}

function selectedRateService(o: PortalOrder): string | null {
  return o.selectedRate?.serviceName ?? o.selectedRate?.serviceCode ?? null;
}

function selectedRateAmount(o: PortalOrder): number | null {
  const amount = Number(o.selectedRate?.amount);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export default function Orders() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>('awaiting_shipment');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<PortalOrder | null>(null);
  const debouncedQ = useDebounced(q, 350);

  useEffect(() => setPage(1), [debouncedQ, tab]);

  const query = useOrders({ status: tab, search: debouncedQ, page });
  const rows = query.data?.data ?? [];
  const pg = query.data?.pagination;

  // ── Sync: re-pull the latest order data across ALL pages of the active tab ──
  // The portal's /backfill endpoint is intentionally disabled server-side
  // (rate/carrier computation is operator-gated), so this refreshes whatever the
  // backend has already synced — it cannot fabricate "pending" rates client-side.
  const qc = useQueryClient();
  const { accessToken } = useAuth();
  const { clientId } = usePortalFilters();
  const syncStatus = useSyncStatus();
  const lastSync = (syncStatus.data?.lastSyncAt as string | null | undefined) ?? null;
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);

  async function handleSync() {
    if (!accessToken || syncing) return;
    setSyncing(true);
    setSyncedAt(null);
    try {
      // Refresh sync status + the awaiting badge, and invalidate every cached
      // orders query (all tabs/pages already in cache refetch immediately).
      await Promise.all([
        syncStatus.refetch(),
        qc.invalidateQueries({ queryKey: ['awaiting-count'] }),
        qc.invalidateQueries({ queryKey: ['orders'] }),
      ]);
      // Backfill ALL pages of the CURRENT tab into cache so paging is fresh +
      // instant. Key shape must match useTokenQuery (trailing `true` = has token).
      const totalPages = Math.max(1, pg?.totalPages ?? 1);
      for (let p = 1; p <= totalPages; p++) {
        await qc.prefetchQuery({
          queryKey: ['orders', tab, debouncedQ, p, clientId ?? 'scope', true],
          queryFn: () => portalApi.orders(accessToken, { status: tab, search: debouncedQ, page: p, clientId }),
        });
      }
      setSyncedAt(`${totalPages} page${totalPages > 1 ? 's' : ''}`);
    } finally {
      setSyncing(false);
    }
  }

  // ── Fill rates: trigger the server-side best-rate backfill, poll progress, ──
  // then refresh so awaiting orders can use the latest server-side rate data.
  // This fetches live ShipStation rate QUOTES (no postage/labels) and writes
  // additively to orderOverrides — see /api/client-portal/backfill.
  const [backfill, setBackfill] = useState<{ running: boolean; job: BackfillJob | null; error: string | null }>({
    running: false,
    job: null,
    error: null,
  });
  const backfillActive = useRef(false);
  useEffect(() => () => { backfillActive.current = false; }, []);

  async function handleFillRates() {
    if (!accessToken || backfill.running) return;
    setBackfill({ running: true, job: null, error: null });
    backfillActive.current = true;
    try {
      // Scope to the active client filter when one is selected; "All clients"
      // (admin) backfills every awaiting order in scope.
      const start = await portalApi.backfillRates(accessToken, clientId ? { clientId } : {});
      setBackfill((s) => ({ ...s, job: start.job }));
      while (backfillActive.current) {
        await new Promise((r) => setTimeout(r, 1500));
        if (!backfillActive.current) break;
        const { job } = await portalApi.backfillStatus(accessToken);
        setBackfill((s) => ({ ...s, job }));
        if (!job || job.status === 'done' || job.status === 'error') break;
      }
      // Surface the newly-filled rates.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['orders'] }),
        qc.invalidateQueries({ queryKey: ['awaiting-count'] }),
      ]);
    } catch (err) {
      setBackfill((s) => ({ ...s, error: err instanceof Error ? err.message : 'Backfill failed' }));
    } finally {
      backfillActive.current = false;
      setBackfill((s) => ({ ...s, running: false }));
    }
  }

  const bf = backfill.job;
  const bfProgress = backfill.running
    ? bf && bf.total > 0
      ? `Filling rates… ${bf.updated} filled · ${bf.processed}/${bf.total}`
      : 'Starting rate backfill…'
    : bf && bf.status === 'done'
      ? `Filled ${bf.updated} of ${bf.total} order${bf.total === 1 ? '' : 's'}`
      : null;

  const columns: Column<PortalOrder>[] = [
    {
      key: 'date',
      header: 'Order Date',
      defaultWidth: 130,
      render: (o) => {
        const d = fmtDateTime(o.orderDate);
        return (
          <div className="leading-tight">
            <p className="tnum text-ink-2">{d.date}</p>
            <p className="text-xs text-ink-3">{d.time}</p>
          </div>
        );
      },
      sortAccessor: (o) => o.orderDate ?? '',
    },
    { key: 'client', header: 'Client', defaultWidth: 130, render: (o) => <Chip accent={clientAccent(o.clientName)} dot={false}>{o.clientName ?? '—'}</Chip>, sortAccessor: (o) => o.clientName ?? '' },
    { key: 'order', header: 'Order #', defaultWidth: 130, render: (o) => <span className="font-semibold text-brand-700">{o.orderNumber ?? `#${o.id}`}</span>, sortAccessor: (o) => o.orderNumber ?? '' },
    {
      key: 'items',
      header: 'Item Name',
      defaultWidth: 260,
      minWidth: 180,
      render: (o) => (
        <div className="space-y-1">
          {(o.items.length ? o.items.slice(0, 4) : [{ name: '—', sku: null, quantity: null, imageUrl: null }]).map((it, i) => (
            <div key={i} className="flex min-w-0 items-center gap-2">
              <HoverZoomImage src={it.imageUrl} alt={it.name ?? ''} size={28} zoom={240} />
              <span className="min-w-0 flex-1 truncate text-ink-2" title={it.name ?? ''}>{it.name ?? '—'}</span>
              {Number(it.quantity) > 1 && <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] font-semibold text-ink-3">×{it.quantity}</span>}
            </div>
          ))}
          {o.items.length > 4 && <p className="text-[11px] text-ink-3">+{o.items.length - 4} more</p>}
        </div>
      ),
      sortAccessor: (o) => o.items[0]?.name ?? '',
    },
    {
      key: 'sku',
      header: 'SKU',
      defaultWidth: 150,
      render: (o) => (
        <div className="space-y-1">
          {(o.items.length ? o.items.slice(0, 4) : [{ sku: '—', quantity: null }]).map((it, i) => (
            <div key={i} className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate font-mono text-[12px] text-ink-3" title={it.sku ?? ''}>{it.sku ?? '—'}</span>
              {Number(it.quantity) > 1 && <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] font-semibold text-ink-3">x{it.quantity}</span>}
            </div>
          ))}
          {o.items.length > 4 && <p className="text-[11px] text-ink-3">+{o.items.length - 4} more</p>}
        </div>
      ),
      sortAccessor: (o) => o.items[0]?.sku ?? '',
    },
    { key: 'qty', header: 'Qty', defaultWidth: 80, className: 'text-center', render: (o) => <span className="inline-flex min-w-[24px] items-center justify-center rounded-md bg-rose-50 px-1.5 py-0.5 text-xs font-bold text-rose-600 tnum ring-1 ring-rose-200">{itemCount(o.items)}</span>, sortAccessor: (o) => itemCount(o.items) },
    { key: 'total', header: 'Order Total', defaultWidth: 120, className: 'text-right', render: (o) => <span className="font-semibold text-ink tnum">{o.orderTotal != null ? money(o.orderTotal) : '—'}</span>, sortAccessor: (o) => Number(o.orderTotal) || 0 },
    { key: 'weight', header: 'Weight', defaultWidth: 110, render: (o) => <span className="tnum text-ink-2">{fmtWeight(o.weightOz)}</span>, sortAccessor: (o) => o.weightOz ?? 0 },
    {
      key: 'selectedRate',
      header: 'Selected Rate',
      defaultWidth: 190,
      render: (o) => {
        const service = selectedRateService(o);
        const amount = selectedRateAmount(o);
        const carrier = o.selectedRate?.carrierCode ?? (o.orderStatus === 'awaiting_shipment' ? null : o.carrierCode);
        if (!carrier && !service && amount == null) return <span className="text-xs text-ink-3">Not selected</span>;
        return (
          <div className="min-w-0 leading-tight">
            <div className="flex min-w-0 items-center gap-2">
              {carrier ? <CarrierBadge code={carrier} /> : null}
              {amount != null && <span className="shrink-0 font-semibold text-brand-700 tnum">{money(amount)}</span>}
            </div>
            {service && <p className="mt-1 truncate text-xs text-ink-3" title={service}>{service}</p>}
          </div>
        );
      },
      sortAccessor: (o) => selectedRateAmount(o) ?? -1,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Status tabs */}
      <GlassPanel className="flex items-center gap-1 overflow-x-auto p-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'focus-ring relative flex-1 cursor-pointer whitespace-nowrap rounded-glass-sm px-3 py-2 text-sm font-semibold transition-colors sm:flex-none sm:px-4',
              tab === t.id ? 'bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-glass' : 'text-ink-2 hover:bg-slate-100',
            )}
          >
            {t.label}
          </button>
        ))}
      </GlassPanel>

      <GlassPanel className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative flex flex-1 items-center sm:max-w-md">
          <Search size={16} className="absolute left-3 text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by order #, customer, SKU…" aria-label="Search orders" className="focus-ring h-11 w-full rounded-glass-sm border border-white/80 bg-white/60 pl-9 pr-3 text-sm text-ink ring-1 ring-slate-200/70 placeholder:text-slate-400 focus:bg-white/90" />
        </label>

        <div className="flex items-center gap-3 sm:shrink-0">
          <span className="hidden max-w-[22rem] truncate text-xs sm:inline" aria-live="polite">
            {backfill.error
              ? <span className="inline-flex items-center gap-1 text-rose-600"><AlertCircle size={13} /> {backfill.error}</span>
              : bfProgress
                ? <span className={cn('inline-flex items-center gap-1', backfill.running ? 'text-brand-600' : 'text-emerald-600')}>{!backfill.running && <Check size={13} />}{bfProgress}</span>
                : syncing
                  ? <span className="text-ink-3">Syncing all pages…</span>
                  : syncedAt
                    ? <span className="inline-flex items-center gap-1 text-emerald-600"><Check size={13} /> Synced {syncedAt}</span>
                    : lastSync
                      ? <span className="text-ink-3">Last synced {shortDate(lastSync)}</span>
                      : ''}
          </span>

          {tab === 'awaiting_shipment' && (
            <button
              onClick={handleFillRates}
              disabled={backfill.running || syncing}
              title="Fetch live carrier rate quotes for awaiting orders (no labels are purchased)"
              className="focus-ring inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-glass-sm bg-white/70 px-4 text-sm font-semibold text-brand-700 ring-1 ring-brand-200 transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Zap size={15} className={cn(backfill.running && 'animate-pulse')} />
              {backfill.running ? 'Filling' : 'Fill rates'}
            </button>
          )}

          <button
            onClick={handleSync}
            disabled={syncing || backfill.running}
            title="Re-pull the latest order data across every page of this tab"
            className="focus-ring inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-glass-sm bg-gradient-to-br from-brand-400 to-brand-600 px-4 text-sm font-semibold text-white shadow-glass transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw size={15} className={cn(syncing && 'animate-spin')} />
            {syncing ? 'Syncing' : 'Sync'}
          </button>
        </div>
      </GlassPanel>

      <GlassPanel className="p-2 sm:p-3">
        <QueryState
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          isEmpty={rows.length === 0}
          onRetry={() => query.refetch()}
          emptyTitle="No orders"
          emptyMessage="No orders match this tab and search."
        >
          <DataTable tableId="orders" columns={columns} rows={rows} rowKey={(o) => String(o.id)} onRowClick={setSelected} />
          {pg && <Pagination page={pg.page} totalPages={pg.totalPages} total={pg.total} pageSize={pg.pageSize} onPage={setPage} />}
        </QueryState>
      </GlassPanel>

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected ? `Order ${selected.orderNumber ?? `#${selected.id}`}` : ''}>
        {selected && <OrderDetailPanel o={selected} />}
      </Drawer>
    </div>
  );
}
