import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ItemNameLines, SkuLines } from '@/components/ItemIdentityLines';
import { SearchInput } from '@/components/ui/SearchInput';
import { GlassPanel } from '@/components/ui/Glass';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Chip } from '@/components/ui/Display';
import { Drawer } from '@/components/ui/Drawer';
import { QueryState } from '@/components/ui/QueryState';
import { Pagination } from '@/components/ui/Pagination';
import { Undo2 } from 'lucide-react';
import { OrderDetailLoader } from '@/components/OrderDetailLoader';
import { Button } from '@/components/ui/Button';
import { ReturnCreateModal } from '@/components/returns/ReturnCreateModal';
import { ShippingRateCell } from '@/components/ShippingRateCell';
import { useCanCustomizeTables, useOrders } from '@/lib/hooks';
import { useDebounced } from '@/lib/useDebounced';
import { money } from '@/lib/status';
import type { PortalOrder } from '@/lib/api';
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

// Presentation only: the backend (src/lib/client-portal/order-status.ts) OWNS
// the fulfillment status value. This maps each canonical enum to a label +
// badge style and must cover exactly the five PortalOrder['fulfillmentStatus']
// values — the frontend never derives the status from order/tracking fields.
const ORDER_STATUS_META: Record<PortalOrder['fulfillmentStatus'], { label: string; cls: string }> = {
  pending: { label: 'Awaiting shipment', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  in_transit: { label: 'In Transit', cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  delivered: { label: 'Delivered', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  cancelled: { label: 'Cancelled', cls: 'bg-rose-50 text-rose-700 ring-rose-200' },
  voided: { label: 'Voided', cls: 'bg-slate-100 text-slate-600 ring-slate-300' },
};

function OrderStatusBadge({ status }: { status: PortalOrder['fulfillmentStatus'] }) {
  const meta = ORDER_STATUS_META[status] ?? ORDER_STATUS_META.pending;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset',
        meta.cls,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {meta.label}
    </span>
  );
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

function fmtWeight(value: number | string | null | undefined): string {
  const oz = Math.round(Number(value));
  if (!Number.isFinite(oz) || oz <= 0) return '-';
  const lb = Math.floor(oz / 16);
  const rem = oz % 16;
  if (lb > 0 && rem > 0) return `${lb} lb ${rem} oz`;
  if (lb > 0) return `${lb} lb`;
  return `${rem} oz`;
}

export default function Orders() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>('awaiting_shipment');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selected, setSelected] = useState<PortalOrder | null>(null);
  // CP-029: "Start return" opens the create-return modal for the selected order.
  const [returnOrderId, setReturnOrderId] = useState<number | null>(null);
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

  const query = useOrders({ status: tab, search: debouncedQ, page, pageSize });
  const canCustomizeTables = useCanCustomizeTables();
  const rows = query.data?.data ?? [];
  const pg = query.data?.pagination;

  const columns: Column<PortalOrder>[] = [
    {
      key: 'date',
      header: 'Order Date',
      defaultWidth: 130,
      render: (o) => {
        const d = fmtDateTime(o.orderDate);
        return (
          <div className="text-left leading-tight">
            <p className="tnum text-ink-2">{d.date}</p>
            <p className="text-xs text-ink-3">{d.time}</p>
          </div>
        );
      },
      sortAccessor: (o) => o.orderDate ?? '',
    },
    { key: 'client', header: 'Client', defaultWidth: 130, render: (o) => <Chip accent={clientAccent(o.clientName)} dot={false}>{o.clientName ?? '—'}</Chip>, sortAccessor: (o) => o.clientName ?? '' },
    { key: 'status', header: 'Status', defaultWidth: 120, render: (o) => <OrderStatusBadge status={o.fulfillmentStatus} />, sortAccessor: (o) => o.fulfillmentStatus },
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
      render: (o) => <QtyBadge value={o.orderedUnits} />,
      sortAccessor: (o) => o.orderedUnits,
    },
    ...(canCustomizeTables ? [{
      key: 'weight',
      header: 'Weight',
      defaultWidth: 110,
      defaultHidden: true,
      className: 'text-right',
      render: (o) => <span className="font-semibold text-ink-2 tnum">{fmtWeight(o.weightOz)}</span>,
      sortAccessor: (o) => Number(o.weightOz) || 0,
    } satisfies Column<PortalOrder>] : []),
    {
      key: 'total',
      header: 'Order Total',
      defaultWidth: 120,
      className: 'text-right',
      render: (o) => <OrderTotalCell value={o.orderTotal} />,
      sortAccessor: (o) => Number(o.orderTotal) || 0,
    },
    {
      // CP-018: the client sees the CUSTOMER shipping rate only — billed customer
      // shipping (fallback buyer-paid store shipping), never the internal
      // selected/best/label rate, carrier, or service. Financially gated
      // (null → "—" for clients without financial access).
      key: 'customerShipping',
      header: 'Customer Shipping Rate',
      defaultWidth: 170,
      className: 'text-right',
      render: (o) => (
        <ShippingRateCell
          rate={o.customerShippingRate}
          pending={o.customerShippingRatePending}
          moneyClassName="text-brand-700"
        />
      ),
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

      <GlassPanel className="p-4">
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder="Search by order #, customer, SKU…"
          ariaLabel="Search orders"
        />
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
          <DataTable
            tableId="orders"
            columns={columns}
            rows={rows}
            rowKey={(o) => String(o.id)}
            onRowClick={setSelected}
            rowActionLabel={(row) => `View order ${row.orderNumber ?? `#${row.id}`}`}
            allowColumnCustomization={canCustomizeTables}
            stickyHeader
          />
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

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected ? `Order ${selected.orderNumber ?? `#${selected.id}`}` : ''}>
        {/* CP-022: fetch the canonical /orders/:id DTO — the list row only drives
            the table, never the modal's business fields. */}
        {selected && (
          <div className="space-y-5">
            <OrderDetailLoader id={selected.id} />
            {/* CP-029: start-return entry point — opens the create-return modal
                for this order. The modal renders the backend order DTO only; no
                rate/carrier/billing math happens here. */}
            <Button variant="secondary" className="w-full" leadingIcon={<Undo2 size={16} />} onClick={() => setReturnOrderId(selected.id)}>
              Start a return
            </Button>
          </div>
        )}
      </Drawer>

      <ReturnCreateModal open={returnOrderId != null} orderId={returnOrderId} onClose={() => setReturnOrderId(null)} />
    </div>
  );
}
