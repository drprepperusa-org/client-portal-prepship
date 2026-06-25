import { useEffect, useState } from 'react';
import { Search, History, Boxes } from 'lucide-react';
import { Thumb } from '@/components/ui/Thumb';
import { GlassPanel } from '@/components/ui/Glass';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Chip } from '@/components/ui/Display';
import { Checkbox, Select } from '@/components/ui/Selection';
import { QueryState } from '@/components/ui/QueryState';
import { Pagination } from '@/components/ui/Pagination';
import { useInventory, useInventoryHistory } from '@/lib/hooks';
import { useDebounced } from '@/lib/useDebounced';
import type { PortalInventory, InventoryMovement } from '@/lib/api';
import type { Accent } from '@/lib/accents';
import { cn } from '@/lib/cn';

/* ---------- formatting helpers ---------- */
const trimNum = (n: number) => String(Number(n.toFixed(2))); // 11.0 -> "11"
function fmtWeight(oz: number | null): string {
  if (oz == null || oz <= 0) return '—';
  const lb = Math.floor(oz / 16);
  const rem = Math.round(oz - lb * 16);
  if (lb && rem) return `${lb} lb ${rem} oz`;
  if (lb) return `${lb} lb`;
  return `${rem} oz`;
}
const dims = (l: number | null, w: number | null, h: number | null) =>
  l != null && w != null && h != null ? `${trimNum(l)}×${trimNum(w)}×${trimNum(h)}` : '—';
function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { year: '2-digit', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit' });
}

function isLow(s: PortalInventory) {
  const stock = Number(s.stockQty ?? 0);
  const reorder = Number(s.reorderLevel ?? 0);
  return reorder > 0 && stock <= reorder;
}
function stockStatus(s: PortalInventory): { label: string; accent: Accent } {
  const stock = Number(s.stockQty ?? 0);
  if (stock <= 0) return { label: 'OUT', accent: 'rose' };
  if (isLow(s)) return { label: 'LOW', accent: 'amber' };
  return { label: 'IN', accent: 'emerald' };
}
const MOVEMENT_ACCENT: Record<string, Accent> = {
  ship: 'rose',
  receive: 'emerald',
  return: 'sky',
  adjust: 'amber',
  damage: 'rose',
  manual: 'violet',
};
function movementAccent(type: string | null): Accent {
  return MOVEMENT_ACCENT[(type ?? '').toLowerCase()] ?? 'indigo';
}

const TYPE_OPTS = [
  { value: 'all', label: 'All types' },
  { value: 'Ship', label: 'Ship' },
  { value: 'Receive', label: 'Receive' },
  { value: 'Return', label: 'Return' },
  { value: 'Adjust', label: 'Adjust' },
  { value: 'Damage', label: 'Damage' },
];

export default function Inventory() {
  const [tab, setTab] = useState<'stock' | 'history'>('stock');
  const [historySku, setHistorySku] = useState('');

  function openHistoryFor(sku: string | null) {
    setHistorySku(sku ?? '');
    setTab('history');
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <GlassPanel className="flex items-center gap-1 overflow-x-auto p-1.5">
        {(['stock', 'history'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'focus-ring relative flex-1 cursor-pointer whitespace-nowrap rounded-glass-sm px-3 py-2 text-sm font-semibold transition-colors sm:flex-none sm:px-4',
              tab === t ? 'bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-glass' : 'text-ink-2 hover:bg-slate-100',
            )}
          >
            {t === 'stock' ? 'Stock Levels' : 'History'}
          </button>
        ))}
      </GlassPanel>

      {tab === 'stock' ? <StockLevels onHistory={openHistoryFor} /> : <InventoryHistory initialSku={historySku} />}
    </div>
  );
}

/* ============================= Stock Levels ============================= */
function StockLevels({ onHistory }: { onHistory: (sku: string | null) => void }) {
  const [q, setQ] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [page, setPage] = useState(1);
  const debouncedQ = useDebounced(q, 350);
  useEffect(() => setPage(1), [debouncedQ, lowOnly]);

  // Low/Out-only is filtered SERVER-side so it spans every page (not just the
  // current one) and the pager totals stay accurate.
  const query = useInventory({ search: debouncedQ, page, lowStock: lowOnly });
  const pg = query.data?.pagination;
  const rows = query.data?.data ?? [];

  const columns: Column<PortalInventory>[] = [
    { key: 'sku', header: 'SKU', defaultWidth: 130, render: (s) => <span className="font-semibold text-brand-700">{s.sku ?? '—'}</span>, sortAccessor: (s) => s.sku ?? '' },
    {
      key: 'image',
      header: 'Image',
      defaultWidth: 76,
      minWidth: 64,
      draggable: true,
      render: (s) => <Thumb src={s.imageUrl} alt={s.name ?? s.sku ?? ''} size={36} iconSize={16} />,
    },
    { key: 'name', header: 'Name', defaultWidth: 240, render: (s) => <span className="block truncate text-ink" title={s.name ?? ''}>{s.name ?? '—'}</span>, sortAccessor: (s) => s.name ?? '' },
    { key: 'client', header: 'Client', defaultWidth: 130, render: (s) => <span className="text-ink-3">{s.clientName ?? '—'}</span>, sortAccessor: (s) => s.clientName ?? '' },
    { key: 'weight', header: 'Weight', defaultWidth: 110, render: (s) => <span className="tnum">{fmtWeight(s.weightOz)}</span>, sortAccessor: (s) => s.weightOz ?? 0 },
    { key: 'dims', header: 'Dims (LxWxH)', defaultWidth: 130, render: (s) => <span className="tnum text-ink-3">{dims(s.length, s.width, s.height)}</span>, sortAccessor: (s) => Number(s.length) || 0 },
    { key: 'cuft', header: 'Cu Ft/Unit', defaultWidth: 110, className: 'text-right', render: (s) => <span className="tnum text-ink-3">{s.cuFt != null ? s.cuFt.toFixed(3) : '—'}</span>, sortAccessor: (s) => s.cuFt ?? 0 },
    { key: 'package', header: 'Package', defaultWidth: 120, render: (s) => <span className="tnum text-ink-3">{s.packageLength != null ? dims(s.packageLength, s.packageWidth, s.packageHeight) : s.packageName ?? '—'}</span> },
    {
      key: 'stock',
      header: 'Stock',
      defaultWidth: 90,
      className: 'text-right',
      render: (s) => <span className={cn('font-semibold tnum', Number(s.stockQty ?? 0) <= 0 ? 'text-rose-600' : 'text-ink')}>{s.stockQty ?? 0}</span>,
      sortAccessor: (s) => Number(s.stockQty) || 0,
    },
    { key: 'sold30', header: 'Sold 30d', defaultWidth: 100, className: 'text-right', render: (s) => <span className="tnum text-ink-3">{Number(s.soldLast30Days ?? 0)}</span>, sortAccessor: (s) => Number(s.soldLast30Days) || 0 },
    { key: 'unitsPack', header: 'Units/Pack', defaultWidth: 110, className: 'text-right', render: (s) => <span className="tnum text-ink-3">{s.unitsPerPack ?? 1}</span>, sortAccessor: (s) => Number(s.unitsPerPack) || 0 },
    { key: 'totalUnits', header: 'Total Units', defaultWidth: 110, className: 'text-right', render: (s) => <span className="tnum text-ink-3">{s.totalUnits ?? 0}</span>, sortAccessor: (s) => Number(s.totalUnits) || 0 },
    { key: 'min', header: 'Min', defaultWidth: 80, className: 'text-right', render: (s) => <span className="tnum text-ink-3">{s.reorderLevel ?? 0}</span>, sortAccessor: (s) => Number(s.reorderLevel) || 0 },
    {
      key: 'status',
      header: 'Status',
      defaultWidth: 100,
      render: (s) => {
        const st = stockStatus(s);
        return <Chip accent={st.accent}>{st.label}</Chip>;
      },
      sortAccessor: (s) => stockStatus(s).label,
    },
    {
      key: 'actions',
      header: 'Actions',
      defaultWidth: 110,
      draggable: false,
      resizable: false,
      render: (s) => (
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); onHistory(s.sku); }}
            aria-label={`History for ${s.sku}`}
            className="focus-ring grid h-7 w-7 cursor-pointer place-items-center rounded-lg text-ink-3 transition-colors hover:bg-brand-50 hover:text-brand-600"
          >
            <History size={15} />
          </button>
          <span className={cn('h-2 w-2 rounded-full', s.active ? 'bg-emerald-500' : 'bg-slate-300')} title={s.active ? 'Active' : 'Inactive'} />
        </div>
      ),
    },
  ];

  return (
    <>
      <GlassPanel className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative flex flex-1 items-center sm:max-w-md">
            <Search size={16} className="absolute left-3 text-ink-3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter SKU or name…" aria-label="Search inventory" className="focus-ring h-11 w-full rounded-glass-sm border border-white/80 bg-white/60 pl-9 pr-3 text-sm text-ink ring-1 ring-slate-200/70 placeholder:text-slate-400 focus:bg-white/90" />
          </label>
          <Checkbox label="Low/Out only" checked={lowOnly} onChange={setLowOnly} />
        </div>
      </GlassPanel>

      <GlassPanel className="p-2 sm:p-3">
        <QueryState
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          isEmpty={rows.length === 0}
          onRetry={() => query.refetch()}
          emptyTitle="No SKUs found"
          emptyMessage="No inventory matches this view."
        >
          <DataTable tableId="inventory" columns={columns} rows={rows} rowKey={(s) => String(s.id)} />
          {pg && <Pagination page={pg.page} totalPages={pg.totalPages} total={pg.total} pageSize={pg.pageSize} onPage={setPage} />}
        </QueryState>
      </GlassPanel>
    </>
  );
}

/* ============================= History ============================= */
function InventoryHistory({ initialSku }: { initialSku: string }) {
  const [q, setQ] = useState(initialSku);
  const [type, setType] = useState<string | string[]>('all');
  const [page, setPage] = useState(1);
  const debouncedQ = useDebounced(q, 350);
  useEffect(() => setPage(1), [debouncedQ, type]);
  // Sync when an Actions→History click changes the requested SKU.
  useEffect(() => setQ(initialSku), [initialSku]);

  const query = useInventoryHistory({ sku: debouncedQ || undefined, type: type === 'all' ? undefined : (type as string), page });
  const rows = query.data?.data ?? [];
  const pg = query.data?.pagination;

  const columns: Column<InventoryMovement>[] = [
    { key: 'date', header: 'Date (local)', defaultWidth: 170, render: (m) => <span className="tnum text-ink-2">{fmtDateTime(m.createdAt)}</span> },
    { key: 'sku', header: 'SKU', defaultWidth: 180, render: (m) => <span className="font-mono text-[13px] text-ink">{m.sku ?? '—'}</span> },
    {
      key: 'type',
      header: 'Type',
      defaultWidth: 120,
      render: (m) => <Chip accent={movementAccent(m.type)} dot={false}>{m.type ?? '—'}</Chip>,
    },
    {
      key: 'qty',
      header: 'Qty',
      defaultWidth: 90,
      className: 'text-right',
      render: (m) => <span className={cn('font-semibold tnum', Number(m.qty ?? 0) < 0 ? 'text-rose-600' : 'text-emerald-600')}>{m.qty ?? 0}</span>,
    },
    { key: 'note', header: 'Note', defaultWidth: 260, render: (m) => <span className="block truncate text-ink-2" title={m.note ?? ''}>{m.note ?? '—'}</span> },
    { key: 'source', header: 'Source', defaultWidth: 180, render: (m) => <span className="font-mono text-xs text-ink-3">{m.source ?? '—'}</span> },
  ];

  return (
    <>
      <GlassPanel className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative flex flex-1 items-center sm:max-w-sm">
            <Search size={16} className="absolute left-3 text-ink-3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter SKU or name…" aria-label="Search history" className="focus-ring h-11 w-full rounded-glass-sm border border-white/80 bg-white/60 pl-9 pr-3 text-sm text-ink ring-1 ring-slate-200/70 placeholder:text-slate-400 focus:bg-white/90" />
          </label>
          <Select options={TYPE_OPTS} value={type} onChange={setType} className="sm:w-44" />
          <span className="text-xs text-ink-3">Date range follows the top-bar selector.</span>
        </div>
      </GlassPanel>

      <GlassPanel className="p-2 sm:p-3">
        <QueryState
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          isEmpty={rows.length === 0}
          onRetry={() => query.refetch()}
          emptyTitle="No movements"
          emptyMessage="No inventory movements for the selected filters and date range."
        >
          <DataTable tableId="inventory-history" columns={columns} rows={rows} rowKey={(m) => String(m.id)} />
          {pg && <Pagination page={pg.page} totalPages={pg.totalPages} total={pg.total} pageSize={pg.pageSize} onPage={setPage} />}
        </QueryState>
      </GlassPanel>

      {/* Tiny legend so the icon-free header still reads as inventory movements */}
      <p className="flex items-center gap-1.5 px-1 text-xs text-ink-3"><Boxes size={13} /> Audit trail of every inventory adjustment — receives, returns, write-offs, and order ships.</p>
    </>
  );
}
