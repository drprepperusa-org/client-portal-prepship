import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Check, Zap, AlertCircle } from 'lucide-react';
import { ItemNameLines, SkuLines } from '@/components/ItemIdentityLines';
import { SearchInput } from '@/components/ui/SearchInput';
import { GlassPanel } from '@/components/ui/Glass';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Chip } from '@/components/ui/Display';
import { Drawer } from '@/components/ui/Drawer';
import { QueryState } from '@/components/ui/QueryState';
import { Pagination } from '@/components/ui/Pagination';
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
  // 'all' exists so search can span every status — without it, the global
  // top-bar search landed on the Awaiting tab and shipped/cancelled matches
  // looked like "search not working".
  { id: 'all', label: 'All' },
  { id: 'awaiting_shipment', label: 'Awaiting shipment' },
  { id: 'shipped', label: 'Shipped' },
  { id: 'cancelled', label: 'Cancelled' },
] as const;
type Tab = (typeof TABS)[number]['id'];
function isTab(value: string): value is Tab {
  return TABS.some((t) => t.id === value);
}

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

function customerShippingRate(o: PortalOrder): number | null {
  const amount = Number(o.customerShippingRate);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function QtyBadge({ value }: { value: number }) {
  return (
    <span className="inline-flex min-w-[24px] items-center justify-center rounded-md bg-rose-50 px-1.5 py-0.5 text-xs font-bold text-rose-600 tnum ring-1 ring-rose-200">
      {value}
    </span>
  );
}

function OrderTotalCell({ value }: { value: number | string | null | undefined }) {
  return (
    <span className="font-semibold text-ink tnum">
      {value != null ? money(value) : '—'}
    </span>
  );
}

export default function Orders() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>('awaiting_shipment');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<PortalOrder | null>(null);
  const debouncedQ = useDebounced(q, 350);

  // Adopt the ?q= param whenever it changes. useState only reads it at mount, so
  // a top-bar search performed while Orders is ALREADY open would otherwise be
  // silently ignored (the box wouldn't update). The param only changes on
  // navigation, so this never clobbers in-page typing.
  const urlQ = params.get('q') ?? '';
  useEffect(() => setQ(urlQ), [urlQ]);

  // Adopt ?tab= the same way — the global top-bar search navigates with
  // tab=all so a search is never silently caged to the default Awaiting tab.
  const urlTab = params.get('tab') ?? '';
  useEffect(() => {
    if (isTab(urlTab)) setTab(urlTab);
  }, [urlTab]);

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
          queryKey: ['orders', tab, debouncedQ, p, 50, clientId ?? 'scope', true],
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
      render: (o) => <ItemNameLines items={o.items} />,
      sortAccessor: (o) => o.items[0]?.name ?? '',
    },
    {
      key: 'sku',
      header: 'SKU',
      defaultWidth: 150,
      render: (o) => <SkuLines items={o.items} />,
      sortAccessor: (o) => o.items[0]?.sku ?? '',
    },
    {
      key: 'qty',
      header: 'Qty',
      defaultWidth: 80,
      className: 'text-center',
      render: (o) => <QtyBadge value={itemCount(o.items)} />,
      sortAccessor: (o) => itemCount(o.items),
    },
    {
      key: 'total',
      header: 'Order Total',
      defaultWidth: 120,
      className: 'text-right',
      render: (o) => <OrderTotalCell value={o.orderTotal} />,
      sortAccessor: (o) => Number(o.orderTotal) || 0,
    },
    { key: 'weight', header: 'Weight', defaultWidth: 110, render: (o) => <span className="tnum text-ink-2">{fmtWeight(o.weightOz)}</span>, sortAccessor: (o) => o.weightOz ?? 0 },
    {
      // CP-018: the client sees the CUSTOMER shipping rate only — billed customer
      // shipping (fallback buyer-paid store shipping), never the internal
      // selected/best/label rate, carrier, or service. Financially gated
      // (null → "—" for clients without financial access).
      key: 'customerShipping',
      header: 'Customer Shipping Rate',
      defaultWidth: 170,
      className: 'text-right',
      render: (o) => {
        const amount = customerShippingRate(o);
        return amount != null
          ? <span className="font-semibold text-brand-700 tnum">{money(amount)}</span>
          : <span className="text-xs text-ink-3">—</span>;
      },
      sortAccessor: (o) => customerShippingRate(o) ?? -1,
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
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder="Search by order #, customer, SKU…"
          ariaLabel="Search orders"
        />

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
              className={cn(
                'focus-ring inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-glass-sm',
                'bg-white/70 px-4 text-sm font-semibold text-brand-700 ring-1 ring-brand-200',
                'transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60',
              )}
            >
              <Zap size={15} className={cn(backfill.running && 'animate-pulse')} />
              {backfill.running ? 'Filling' : 'Fill rates'}
            </button>
          )}

          <button
            onClick={handleSync}
            disabled={syncing || backfill.running}
            title="Re-pull the latest order data across every page of this tab"
            className={cn(
              'focus-ring inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-glass-sm',
              'bg-gradient-to-br from-brand-400 to-brand-600 px-4 text-sm font-semibold text-white',
              'shadow-glass transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60',
            )}
          >
            <RefreshCw size={15} className={cn(syncing && 'animate-spin')} />
            {syncing ? 'Syncing' : 'Sync'}
          </button>
        </div>
      </GlassPanel>

      {/* Search escape hatch: a search that misses inside a status tab is the
          "search looks broken" trap — offer the cross-status search in place. */}
      {debouncedQ && tab !== 'all' && !query.isLoading && !query.isError && rows.length === 0 && (
        <GlassPanel className="flex flex-col items-start gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink-2">
            No matches for “{debouncedQ}” in <span className="font-semibold">{TABS.find((t) => t.id === tab)?.label}</span> — it may be in another status.
          </p>
          <button
            onClick={() => setTab('all')}
            className={cn(
              'focus-ring inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-glass-sm',
              'bg-gradient-to-br from-brand-400 to-brand-600 px-3.5 text-sm font-semibold text-white',
              'shadow-glass transition-opacity hover:opacity-95',
            )}
          >
            Search all orders
          </button>
        </GlassPanel>
      )}

      <GlassPanel className="p-2 sm:p-3">
        <QueryState
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          isEmpty={rows.length === 0}
          onRetry={() => query.refetch()}
          emptyTitle="No orders"
          emptyMessage={tab === 'all' ? 'No orders match this search.' : 'No orders match this tab and search.'}
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
