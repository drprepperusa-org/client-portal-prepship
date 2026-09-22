import { ExportInventoryCsv } from '@/components/inventory/ExportInventoryCsv';
import { useAuth } from '@/auth';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useTableSort } from '@/lib/useTableSort';
import { useEffect, useState } from 'react';
import { History, Boxes } from 'lucide-react';
import { Thumb } from '@/components/ui/Thumb';
import { GlassPanel } from '@/components/ui/Glass';
import { SearchInput } from '@/components/ui/SearchInput';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Chip, Tooltip } from '@/components/ui/Display';
import { Checkbox, Select } from '@/components/ui/Selection';
import { QueryState } from '@/components/ui/QueryState';
import { Pagination } from '@/components/ui/Pagination';
import { useCanCustomizeTables, useInventory, useInventoryHistory } from '@/lib/hooks';
import { inventoryStockStatusMeta } from '@/lib/inventory-status';
import { useDebounced } from '@/lib/useDebounced';
import { useSearchDraft } from '@/lib/useSearchDraft';
import { SavedViewsBar } from '@/components/ui/SavedViewsBar';
import { useQueryClient } from '@tanstack/react-query';
import { portalQueryKey, portalReadKeys } from '@/lib/query-keys';
import { useFilteredPage } from '@/lib/useFilteredPage';
import { usePortalFilters } from '@/lib/portalContext';
import type { PortalInventory, InventoryMovement } from '@/lib/api';
import type { Accent } from '@/lib/accents';
import { cn } from '@/lib/cn';

/* ---------- formatting helpers ---------- */
const trimNum = (n: number) => String(Number(n.toFixed(2))); // 11.0 -> "11"
// CP-023: this column is warehouse ship-out (inventory ledger), NOT ordered units.
const WHSE_SHIPPED_TOOLTIP =
  'Units shipped from the warehouse in the last 30 days (inventory ledger ship events, by ship date). ' +
  'Not order/sales units — see Analysis for units ordered.';
const dims = (l: number | null, w: number | null, h: number | null) =>
  l != null && w != null && h != null ? `${trimNum(l)}×${trimNum(w)}×${trimNum(h)}` : '—';
function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { year: '2-digit', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit' });
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
  const location = useLocation();
  // A bell link starts a fresh filtered view even when Inventory is already open.
  return <InventoryView key={location.state?.attention ? location.key : 'inventory'} />;
}

function InventoryView() {
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
  const { search: q, setSearch: setQ, appliedSearch: debouncedQ, applySearch } = useSearchDraft();
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const lowOnly = params.get('lowStock') === '1';
  const setLowOnly = (enabled: boolean) => setParams((previous) => {
    const next = new URLSearchParams(previous);
    if (enabled) next.set('lowStock', '1'); else next.delete('lowStock');
    return next;
  });
  const [pageSize, setPageSize] = useState(100);
  const canCustomizeTables = useCanCustomizeTables();
  const { clientId } = usePortalFilters();
  const [page, setPage] = useFilteredPage(JSON.stringify([clientId, debouncedQ, lowOnly]));
  const tableSort = useTableSort(setPage);

  // Low/Out-only is filtered SERVER-side so it spans every page (not just the
  // current one) and the pager totals stay accurate.
  const query = useInventory({ sortBy: tableSort.sortBy, sortDir: tableSort.sortDir, search: debouncedQ, page, pageSize, lowStock: lowOnly });
  const exportFilters = { clientId, search: debouncedQ, lowStock: lowOnly,
    sortBy: tableSort.sortBy, sortDir: tableSort.sortDir };
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
    { key: 'dims', header: 'Dims (LxWxH)', defaultWidth: 130, render: (s) => <span className="tnum text-ink-3">{dims(s.length, s.width, s.height)}</span>, sortAccessor: (s) => Number(s.length) || 0 },
    { key: 'cuft', header: 'Cu Ft/Unit', defaultWidth: 110, className: 'text-right', render: (s) => <span className="tnum text-ink-3">{s.cuFt != null ? s.cuFt.toFixed(3) : '—'}</span>, sortAccessor: (s) => s.cuFt ?? 0 },
    { key: 'package', header: 'Package', defaultWidth: 120, render: (s) => <span className="tnum text-ink-3">{s.packageLength != null ? dims(s.packageLength, s.packageWidth, s.packageHeight) : s.packageName ?? '—'}</span> },
    {
      key: 'stock',
      header: 'Stock',
      defaultWidth: 90,
      className: 'text-right',
      render: (s) => {
        const status = inventoryStockStatusMeta(s.stockStatus);
        return <span className={cn('font-semibold tnum', status.stockTextClass)}>{s.inventoryQuantity}</span>;
      },
      sortAccessor: (s) => Number(s.inventoryQuantity) || 0,
    },
    {
      key: 'whseShipped30',
      header: 'Whse Shipped 30d',
      defaultWidth: 130,
      className: 'text-right',
      render: (s) => (
        <Tooltip side="top" multiline label={WHSE_SHIPPED_TOOLTIP}>
          <span tabIndex={0} className="tnum text-ink-3 cursor-help">{Number(s.warehouseShipped30d ?? 0)}</span>
        </Tooltip>
      ),
      sortAccessor: (s) => Number(s.warehouseShipped30d) || 0,
    },
    { key: 'unitsPack', header: 'Units/Pack', defaultWidth: 110, className: 'text-right', render: (s) => <span className="tnum text-ink-3">{s.unitsPerPack ?? 1}</span>, sortAccessor: (s) => Number(s.unitsPerPack) || 0 },
    { key: 'min', header: 'Min', defaultWidth: 80, className: 'text-right', render: (s) => <span className="tnum text-ink-3">{s.reorderLevel ?? 0}</span>, sortAccessor: (s) => Number(s.reorderLevel) || 0 },
    {
      key: 'status',
      header: 'Status',
      defaultWidth: 100,
      render: (s) => {
        const st = inventoryStockStatusMeta(s.stockStatus);
        return <Chip accent={st.accent}>{st.label}</Chip>;
      },
      sortAccessor: (s) => inventoryStockStatusMeta(s.stockStatus).label,
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
      <GlassPanel className="space-y-3 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="Filter SKU or name…"
            ariaLabel="Search inventory"
          />
          <Checkbox label="Low/Out only" checked={lowOnly} onChange={setLowOnly} />
          <ExportInventoryCsv key={JSON.stringify([userId, exportFilters, q])} filters={exportFilters}
            disabled={query.isFetching || query.isError || !pg?.total || q !== debouncedQ} />
        </div>
        <SavedViewsBar current={{ page: 'inventory', search: q, lowStock: lowOnly, sort: tableSort.sort, pageSize }} onApply={(view) => {
          if (view.page !== 'inventory') return;
          applySearch(view.search); setLowOnly(view.lowStock); setPageSize(view.pageSize); setPage(1);
          const allowedSort = view.sort && columns.some((column) => column.key === view.sort?.key && column.sortAccessor);
          const sort = allowedSort ? view.sort : null;
          tableSort.onSortChange(sort);
          void queryClient.invalidateQueries({ exact: true, queryKey: portalQueryKey(userId,
            portalReadKeys.inventory(clientId, view.search, 1, view.pageSize, view.lowStock, sort?.key, sort?.dir)) });
        }} />
      </GlassPanel>

      <GlassPanel className="p-2 sm:p-3">
        <QueryState showUpdateStatus={false}
          isLoading={query.isLoading}
          isUpdating={query.isFetching && !query.isLoading}
          isError={query.isError}
          error={query.error}
          isEmpty={rows.length === 0}
          onRetry={() => query.refetch()}
          emptyTitle="No SKUs found"
          emptyMessage="No inventory matches this view."
        >
          <DataTable isUpdating={query.isFetching && !query.isLoading}
            sort={tableSort.sort} onSortChange={tableSort.onSortChange} tableId="inventory" columns={columns}
            rows={rows} rowKey={(s) => String(s.id)} allowColumnCustomization={canCustomizeTables} stickyHeader />
          {pg && (
            <Pagination
              page={pg.page}
              totalPages={pg.totalPages}
              total={pg.total}
              pageSize={pg.pageSize}
              onPage={setPage}
              onPageSize={(size) => { setPageSize(size); setPage(1); }}
            />
          )}
        </QueryState>
      </GlassPanel>
    </>
  );
}

/* ============================= History ============================= */
function InventoryHistory({ initialSku }: { initialSku: string }) {
  const [q, setQ] = useState(initialSku);
  const [type, setType] = useState<string | string[]>('all');
  const [pageSize, setPageSize] = useState(50);
  const canCustomizeTables = useCanCustomizeTables();
  const debouncedQ = useDebounced(q, 350);
  const { clientId, dateRange } = usePortalFilters();
  const [page, setPage] = useFilteredPage(JSON.stringify([clientId, debouncedQ, type, dateRange.dateFrom, dateRange.dateTo]));
  const tableSort = useTableSort(setPage);
  // Sync when an Actions→History click changes the requested SKU.
  useEffect(() => setQ(initialSku), [initialSku]);

  const query = useInventoryHistory({ sortBy: tableSort.sortBy, sortDir: tableSort.sortDir, sku: debouncedQ || undefined, type: type === 'all' ? undefined : (type as string), page, pageSize });
  const rows = query.data?.data ?? [];
  const pg = query.data?.pagination;

  const columns: Column<InventoryMovement>[] = [
    { key: 'date', sortAccessor: (m) => m.createdAt, header: 'Date (local)', defaultWidth: 170, render: (m) => <span className="tnum text-ink-2">{fmtDateTime(m.createdAt)}</span> },
    { key: 'sku', sortAccessor: (m) => m.sku, header: 'SKU', defaultWidth: 180, render: (m) => <span className="font-mono text-[13px] text-ink">{m.sku ?? '—'}</span> },
    {
      key: 'type', sortAccessor: (m) => m.type,
      header: 'Type',
      defaultWidth: 120,
      render: (m) => <Chip accent={movementAccent(m.type)} dot={false}>{m.type ?? '—'}</Chip>,
    },
    {
      key: 'qty', sortAccessor: (m) => m.qty,
      header: 'Qty',
      defaultWidth: 90,
      className: 'text-right',
      render: (m) => <span className={cn('font-semibold tnum', Number(m.qty ?? 0) < 0 ? 'text-rose-600' : 'text-emerald-600')}>{m.qty ?? 0}</span>,
    },
    { key: 'note', sortAccessor: (m) => m.note, header: 'Note', defaultWidth: 260, render: (m) => <span className="block truncate text-ink-2" title={m.note ?? ''}>{m.note ?? '—'}</span> },
    { key: 'source', sortAccessor: (m) => m.source, header: 'Source', defaultWidth: 180, render: (m) => <span className="font-mono text-xs text-ink-3">{m.source ?? '—'}</span> },
  ];

  return (
    <>
      <GlassPanel className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="sm:max-w-sm">
            <SearchInput
              value={q}
              onChange={setQ}
              placeholder="Filter SKU or name…"
              ariaLabel="Search history"
            />
          </div>
          <Select options={TYPE_OPTS} value={type} onChange={setType} className="sm:w-44" />
          <span className="text-xs text-ink-3">Date range follows the top-bar selector.</span>
        </div>
      </GlassPanel>

      <GlassPanel className="p-2 sm:p-3">
        <QueryState showUpdateStatus={false}
          isLoading={query.isLoading}
          isUpdating={query.isFetching && !query.isLoading}
          isError={query.isError}
          error={query.error}
          isEmpty={rows.length === 0}
          onRetry={() => query.refetch()}
          emptyTitle="No movements"
          emptyMessage="No inventory movements for the selected filters and date range."
        >
          <DataTable isUpdating={query.isFetching && !query.isLoading}
            sort={tableSort.sort} onSortChange={tableSort.onSortChange} tableId="inventory-history" columns={columns}
            rows={rows} rowKey={(m) => String(m.id)} allowColumnCustomization={canCustomizeTables} stickyHeader />
          {pg && (
            <Pagination
              page={pg.page}
              totalPages={pg.totalPages}
              total={pg.total}
              pageSize={pg.pageSize}
              onPage={setPage}
              onPageSize={(size) => { setPageSize(size); setPage(1); }}
            />
          )}
        </QueryState>
      </GlassPanel>

      {/* Tiny legend so the icon-free header still reads as inventory movements */}
      <p className="flex items-center gap-1.5 px-1 text-xs text-ink-3"><Boxes size={13} /> Audit trail of every inventory adjustment — receives, returns, write-offs, and order ships.</p>
    </>
  );
}
