import { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, Copy, Building2, ExternalLink, Truck } from 'lucide-react';
import { ItemNameLines, SkuLines } from '@/components/ItemIdentityLines';
import { OrderDetailLoader } from '@/components/OrderDetailLoader';
import { GlassPanel } from '@/components/ui/Glass';
import { SearchInput } from '@/components/ui/SearchInput';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Chip } from '@/components/ui/Display';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { QueryState } from '@/components/ui/QueryState';
import { Pagination } from '@/components/ui/Pagination';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth';
import { useCanCustomizeTables, useShipments, useClients } from '@/lib/hooks';
import { ReturnCreateModal } from '@/components/returns/ReturnCreateModal';
import { ShippingRateCell } from '@/components/ShippingRateCell';
import { Undo2 } from 'lucide-react';
import { usePortalFilters } from '@/lib/portalContext';
import { useDebounced } from '@/lib/useDebounced';
import { money, shipmentStatusMeta, shortDate } from '@/lib/status';
import { type Accent } from '@/lib/accents';
import { portalApi, type PortalShipment } from '@/lib/api';
import { cn } from '@/lib/cn';

const CLIENT_ACCENTS: Accent[] = ['emerald', 'rose', 'indigo', 'amber', 'teal', 'violet', 'sky'];
function clientAccent(name: string | null): Accent {
  const s = name ?? '';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i)) % CLIENT_ACCENTS.length;
  return CLIENT_ACCENTS[h];
}

// CP-034: tracking links open the REAL carrier site (USPS/UPS/FedEx) via the
// backend-built `s.trackingUrl` — the portal no longer builds a neutral 17track
// link. When trackingUrl is null (unknown carrier), the number renders as
// copyable text with no external link. Carrier identity itself stays redacted.

// Server-side status filter: values match the backend's SHIPMENT_STATUS_FILTERS,
// so "Delivered" searches all shipments — not just the loaded page.
const STATUS_OPTIONS = [
  { value: 'delivered', label: 'Delivered' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'exception', label: 'Exception' },
  { value: 'attempted', label: 'Attempted' },
  { value: 'label_created', label: 'Label Created' },
  { value: 'voided', label: 'Voided' },
  { value: 'unavailable', label: 'Unavailable' },
] as const;

export default function Shipments() {
  const toast = useToast();
  const { clientId: globalClientId } = usePortalFilters();
  const clients = useClients().data?.data ?? [];
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  // Per-page client filter (like Orders' client switcher) for fast scoping.
  // undefined = follow the global "All clients" topbar filter.
  const [clientFilter, setClientFilter] = useState<number | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selected, setSelected] = useState<PortalShipment | null>(null);
  // CP-029: "Start return" opens the create-return modal for the shipment's order.
  const [returnOrderId, setReturnOrderId] = useState<number | null>(null);
  const debouncedQ = useDebounced(q, 350);
  const effectiveClientId = clientFilter ?? globalClientId;

  useEffect(() => setPage(1), [debouncedQ, effectiveClientId, statusFilter]);

  const query = useShipments({ search: debouncedQ, page, clientId: effectiveClientId, status: statusFilter || undefined });
  const canCustomizeTables = useCanCustomizeTables();
  const allRows = query.data?.data ?? [];
  const rows = allRows;
  const pg = query.data?.pagination;

  // Keep an open drawer on the latest backend DTO after tracking refetches.
  useEffect(() => {
    setSelected((current) =>
      current ? allRows.find((shipment) => shipment.id === current.id) ?? current : current,
    );
  }, [allRows]);

  // Live tracking: when a page of shipments loads, ask the backend to refresh
  // carrier tracking for undelivered rows. Targeted per-label lookups make the
  // forced refresh cheap; changed rows trigger one DTO refetch.
  const { accessToken } = useAuth();
  const lastTrackingKey = useRef('');
  useEffect(() => {
    if (!accessToken || !allRows.length) return;
    const ids = allRows
      .filter(
        (s) =>
          s.shipmentStatus !== 'voided' &&
          s.shipmentStatus !== 'delivered' &&
          s.displayTrackingNumber,
      )
      .map((s) => s.id);
    if (!ids.length) return;
    const key = ids.join(',');
    if (lastTrackingKey.current === key) return;
    lastTrackingKey.current = key;
    portalApi
      .refreshShipmentTracking(accessToken, ids)
      .then((res) => {
        if (res.updated.length) query.refetch();
      })
      .catch(() => {
        // Non-fatal: the table still shows the last persisted status.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, accessToken]);

  const showClientFilter = clients.length > 1;
  const columns: Column<PortalShipment>[] = useMemo(
    () => [
      { key: 'order', header: 'Order', defaultWidth: 150, render: (s) => <span className="font-semibold text-ink">{s.orderNumber ?? (s.orderId ? `#${s.orderId}` : '—')}</span>, sortAccessor: (s) => s.orderNumber ?? '' },
      {
        key: 'items',
        header: 'Item Name',
        defaultWidth: 260,
        minWidth: 180,
        render: (s) => <ItemNameLines items={s.items} />,
        sortAccessor: (s) => s.items?.[0]?.name ?? '',
      },
      {
        key: 'sku',
        header: 'SKU',
        defaultWidth: 150,
        render: (s) => <SkuLines items={s.items} />,
        sortAccessor: (s) => s.items?.[0]?.sku ?? '',
      },
      {
        key: 'client',
        header: 'Client',
        defaultWidth: 150,
        render: (s) => (s.clientName ? <Chip accent={clientAccent(s.clientName)} dot={false}>{s.clientName}</Chip> : <span className="text-ink-3">—</span>),
        sortAccessor: (s) => s.clientName ?? '',
      },
      {
        key: 'customerShippingRate',
        header: 'Customer Shipping Rate',
        defaultWidth: 170,
        className: 'text-right',
        render: (s) => <ShippingRateCell rate={s.customerShippingRate} pending={s.customerShippingRatePending} />,
        sortAccessor: (s) => Number(s.customerShippingRate) || 0,
      },
      {
        key: 'tracking',
        header: 'Tracking #',
        defaultWidth: 190,
        render: (s) => {
          const tn = s.displayTrackingNumber;
          const url = s.trackingUrl;
          if (!tn) return <span className="text-ink-3">—</span>;
          return url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="focus-ring inline-flex items-center gap-1 font-mono text-xs text-brand-700 hover:text-brand-600 hover:underline"
              title="Track on carrier site"
            >
              <span className="truncate">{tn}</span>
              <ExternalLink size={12} className="shrink-0" />
            </a>
          ) : (
            <span className="font-mono text-xs text-ink-2">{tn}</span>
          );
        },
        sortAccessor: (s) => s.displayTrackingNumber ?? '',
      },
      {
        key: 'status',
        header: 'Status',
        defaultWidth: 120,
        render: (s) => {
          const m = shipmentStatusMeta(s.shipmentStatus);
          return <Chip accent={m.accent}>{m.label}</Chip>;
        },
        sortAccessor: (s) => shipmentStatusMeta(s.shipmentStatus).label,
      },
      { key: 'shipped', header: 'Ship date', defaultWidth: 130, render: (s) => <span className="text-ink-3 tnum">{shortDate(s.shipDate)}</span>, sortAccessor: (s) => s.shipDate ?? '' },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <GlassPanel className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder="Search tracking, carrier, order…"
          ariaLabel="Search shipments"
        />

        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          <label className="relative flex items-center">
            <Truck size={15} className="pointer-events-none absolute left-3 z-10 text-ink-3" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by status"
              className="focus-ring h-11 cursor-pointer appearance-none rounded-glass-sm border border-white/80 bg-white/60 pl-9 pr-9 text-sm font-medium text-ink ring-1 ring-slate-200/70 focus:bg-white/90"
            >
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 text-ink-3">▾</span>
          </label>

          {showClientFilter && (
            <label className="relative flex items-center">
              <Building2 size={15} className="pointer-events-none absolute left-3 z-10 text-ink-3" />
              <select
                value={clientFilter ?? ''}
                onChange={(e) => setClientFilter(e.target.value ? Number(e.target.value) : undefined)}
                aria-label="Filter by client"
                className="focus-ring h-11 cursor-pointer appearance-none rounded-glass-sm border border-white/80 bg-white/60 pl-9 pr-9 text-sm font-medium text-ink ring-1 ring-slate-200/70 focus:bg-white/90"
              >
                <option value="">All clients</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name ?? `Client ${c.id}`}</option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 text-ink-3">▾</span>
            </label>
          )}
        </div>
      </GlassPanel>

      <GlassPanel className="p-2 sm:p-3">
        <QueryState
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          isEmpty={rows.length === 0}
          onRetry={() => query.refetch()}
          emptyTitle={statusFilter ? 'No matching shipments' : 'No shipments yet'}
          emptyMessage={
            statusFilter
              ? `No shipments with status “${STATUS_OPTIONS.find((s) => s.value === statusFilter)?.label ?? statusFilter}” in this view — tracking refreshes in the background, so check back shortly.`
              : 'Outbound shipments will appear here once orders ship.'
          }
        >
          <DataTable
            tableId="shipments"
            columns={columns}
            rows={rows}
            rowKey={(s) => String(s.id)}
            rowClassName={(s) => (
              s.shipmentStatus === 'voided' ? 'bg-rose-50/70 hover:bg-rose-100/60' : undefined
            )}
            onRowClick={setSelected}
            rowActionLabel={(row) => `View shipment ${row.displayTrackingNumber ?? `#${row.id}`}`}
            allowColumnCustomization={canCustomizeTables}
            stickyHeader
          />
          {pg && <Pagination page={pg.page} totalPages={pg.totalPages} total={pg.total} pageSize={pg.pageSize} onPage={setPage} />}
        </QueryState>
      </GlassPanel>

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected ? `Shipment #${selected.id}` : ''}>
        {selected && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <Chip accent={shipmentStatusMeta(selected.shipmentStatus).accent}>
                {shipmentStatusMeta(selected.shipmentStatus).label}
              </Chip>
              <span className="flex items-center gap-1 text-sm text-ink-3"><MapPin size={14} /> {selected.clientName ?? '—'}</span>
            </div>

            <div className="flex items-center justify-between rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
              <div className="min-w-0">
                <p className="text-xs text-ink-3">Tracking number</p>
                <p className="truncate font-mono text-sm text-ink">{selected.displayTrackingNumber ?? '—'}</p>
              </div>
              {selected.displayTrackingNumber && (
                <Button
                  variant="icon"
                  size="sm"
                  aria-label="Copy tracking number"
                  onClick={() => {
                    navigator.clipboard?.writeText(selected.displayTrackingNumber!);
                    toast.success('Copied', 'Tracking number copied to clipboard');
                  }}
                >
                  <Copy size={15} />
                </Button>
              )}
            </div>

            {selected.trackingUrl && (
              <a
                href={selected.trackingUrl}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  'focus-ring flex w-full items-center justify-center gap-2 rounded-glass-sm',
                  'bg-gradient-to-br from-brand-400 to-brand-600 py-2.5 text-sm font-semibold',
                  'text-white shadow-glass transition-opacity hover:opacity-95',
                )}
              >
                <ExternalLink size={15} /> Track package
              </a>
            )}

            {/* CP-009: customer-facing — the carrier identity is never shown.
                Only the customer-safe shipping cost + dates + tracking status. */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Customer Shipping Rate" value={selected.customerShippingRate != null ? money(selected.customerShippingRate) : selected.customerShippingRatePending ? 'Pending' : '—'} />
              <Field label="Ship date" value={shortDate(selected.shipDate)} />
              {selected.deliveredAt && <Field label="Delivered" value={shortDate(selected.deliveredAt)} />}
              {selected.shipmentStatusDetail && !selected.deliveredAt && (
                <Field label="Tracking status" value={selected.shipmentStatusDetail} />
              )}
            </div>

            {/* CP-029: start-return entry point from the shipment — opens the
                create-return modal for this shipment's order. */}
            {selected.orderId != null && (
              <Button variant="secondary" className="w-full" leadingIcon={<Undo2 size={16} />} onClick={() => setReturnOrderId(selected.orderId)}>
                Start a return
              </Button>
            )}

            {/* Full order details + ship-to address. Reuses the order detail
                panel (backend-owned money fields; carrier/service redacted). */}
            {selected.orderId != null ? (
              <div className="space-y-3 border-t border-slate-200/70 pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">Order details</p>
                <ShipmentOrderDetail orderId={selected.orderId} />
              </div>
            ) : (
              <div className="rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
                <p className="text-xs font-medium text-ink-3">Items</p>
                <div className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(120px,0.5fr)]">
                  <ItemNameLines items={selected.items} limit={6} />
                  <SkuLines items={selected.items} limit={6} />
                </div>
              </div>
            )}
          </div>
        )}
      </Drawer>

      <ReturnCreateModal open={returnOrderId != null} orderId={returnOrderId} onClose={() => setReturnOrderId(null)} />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
      <p className="text-xs font-medium text-ink-3">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-ink" title={value}>{value}</p>
    </div>
  );
}

/** Loads the shipment's order and renders the full order detail (ship-to
 *  address, line items with prices, cost summary) — carrier/service redacted. */
function ShipmentOrderDetail({ orderId }: { orderId: number }) {
  // CP-022: render through the ONE canonical order-detail loader.
  return <OrderDetailLoader id={orderId} />;
}
