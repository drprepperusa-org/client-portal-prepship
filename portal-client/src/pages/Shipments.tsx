import { useEffect, useMemo, useState } from 'react';
import { MapPin, Copy, Building2, ExternalLink, Truck } from 'lucide-react';
import { ItemNameLines, SkuLines } from '@/components/ItemIdentityLines';
import { GlassPanel } from '@/components/ui/Glass';
import { SearchInput } from '@/components/ui/SearchInput';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Chip } from '@/components/ui/Display';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { QueryState } from '@/components/ui/QueryState';
import { Pagination } from '@/components/ui/Pagination';
import { useToast } from '@/components/ui/Toast';
import { CarrierBadge } from '@/components/store/CarrierBadge';
import { useShipments, useClients } from '@/lib/hooks';
import { usePortalFilters } from '@/lib/portalContext';
import { useDebounced } from '@/lib/useDebounced';
import { money, shipmentStatusMeta, shortDate } from '@/lib/status';
import { type Accent } from '@/lib/accents';
import type { PortalShipment } from '@/lib/api';

const CLIENT_ACCENTS: Accent[] = ['emerald', 'rose', 'indigo', 'amber', 'teal', 'violet', 'sky'];
function clientAccent(name: string | null): Accent {
  const s = name ?? '';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i)) % CLIENT_ACCENTS.length;
  return CLIENT_ACCENTS[h];
}

/** Build a carrier tracking-page URL from the carrier code + tracking number. */
function trackingUrl(carrierCode: string | null | undefined, tracking: string | null | undefined): string | null {
  if (!tracking) return null;
  const c = (carrierCode ?? '').toLowerCase();
  const t = encodeURIComponent(tracking);
  if (c.includes('ups')) return `https://www.ups.com/track?loc=en_US&tracknum=${t}`;
  if (c.includes('usps') || c.includes('stamps')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${t}`;
  if (c.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${t}`;
  if (c.includes('dhl')) return `https://www.dhl.com/us-en/home/tracking/tracking-parcel.html?submit=1&tracking-id=${t}`;
  // Universal fallback (17track) for unknown / custom carriers.
  return `https://t.17track.net/en#nums=${t}`;
}

const STATUS_OPTIONS = ['In Transit', 'Label Created', 'Voided'] as const;

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
  const debouncedQ = useDebounced(q, 350);
  const effectiveClientId = clientFilter ?? globalClientId;

  useEffect(() => setPage(1), [debouncedQ, effectiveClientId]);

  const query = useShipments({ search: debouncedQ, page, clientId: effectiveClientId });
  const allRows = query.data?.data ?? [];
  // Delivery status is derived (Voided / In Transit / Label Created), so this
  // filters the loaded page client-side.
  const rows = statusFilter ? allRows.filter((s) => shipmentStatusMeta(s).label === statusFilter) : allRows;
  const pg = query.data?.pagination;

  const showClientFilter = clients.length > 1;
  const columns: Column<PortalShipment>[] = useMemo(
    () => [
      { key: 'id', header: 'Shipment', defaultWidth: 110, render: (s) => <span className="font-semibold text-ink">#{s.id}</span>, sortAccessor: (s) => s.id },
      { key: 'order', header: 'Order', defaultWidth: 150, render: (s) => <span className="text-ink-3">{s.orderNumber ?? (s.orderId ? `#${s.orderId}` : '—')}</span>, sortAccessor: (s) => s.orderNumber ?? '' },
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
        key: 'carrier',
        header: 'Carrier',
        defaultWidth: 110,
        className: 'text-center',
        render: (s) => (s.carrierCode ? <CarrierBadge code={s.carrierCode} /> : <span className="text-ink-3">—</span>),
        sortAccessor: (s) => s.carrierCode ?? '',
      },
      {
        key: 'shippingCost',
        header: 'Shipping Cost',
        defaultWidth: 130,
        className: 'text-right',
        render: (s) => <span className="font-semibold text-ink tnum">{s.shippingCost != null ? money(s.shippingCost) : '—'}</span>,
        sortAccessor: (s) => Number(s.shippingCost) || 0,
      },
      {
        key: 'tracking',
        header: 'Tracking #',
        defaultWidth: 190,
        render: (s) => {
          const tn = s.trackingNumber ?? s.labelTracking;
          const url = trackingUrl(s.carrierCode, tn);
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
        sortAccessor: (s) => s.trackingNumber ?? s.labelTracking ?? '',
      },
      {
        key: 'status',
        header: 'Status',
        defaultWidth: 120,
        render: (s) => {
          const m = shipmentStatusMeta(s);
          return <Chip accent={m.accent}>{m.label}</Chip>;
        },
        sortAccessor: (s) => shipmentStatusMeta(s).label,
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

        <div className="flex items-center gap-2 sm:shrink-0">
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
                <option key={s} value={s}>{s}</option>
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
          emptyTitle="No shipments yet"
          emptyMessage="Outbound shipments will appear here once orders ship."
        >
          <DataTable tableId="shipments" columns={columns} rows={rows} rowKey={(s) => String(s.id)} onRowClick={setSelected} />
          {pg && <Pagination page={pg.page} totalPages={pg.totalPages} total={pg.total} pageSize={pg.pageSize} onPage={setPage} />}
        </QueryState>
      </GlassPanel>

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected ? `Shipment #${selected.id}` : ''}>
        {selected && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <Chip accent={shipmentStatusMeta(selected).accent}>{shipmentStatusMeta(selected).label}</Chip>
              <span className="flex items-center gap-1 text-sm text-ink-3"><MapPin size={14} /> {selected.clientName ?? '—'}</span>
            </div>

            <div className="rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
              <p className="text-xs font-medium text-ink-3">Items</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(120px,0.5fr)]">
                <ItemNameLines items={selected.items} limit={6} />
                <SkuLines items={selected.items} limit={6} />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
              <div className="min-w-0">
                <p className="text-xs text-ink-3">Tracking number</p>
                <p className="truncate font-mono text-sm text-ink">{selected.trackingNumber ?? selected.labelTracking ?? '—'}</p>
              </div>
              {(selected.trackingNumber || selected.labelTracking) && (
                <Button
                  variant="icon"
                  size="sm"
                  aria-label="Copy tracking number"
                  onClick={() => {
                    navigator.clipboard?.writeText((selected.trackingNumber ?? selected.labelTracking)!);
                    toast.success('Copied', 'Tracking number copied to clipboard');
                  }}
                >
                  <Copy size={15} />
                </Button>
              )}
            </div>

            {trackingUrl(selected.carrierCode, selected.trackingNumber ?? selected.labelTracking) && (
              <a
                href={trackingUrl(selected.carrierCode, selected.trackingNumber ?? selected.labelTracking)!}
                target="_blank"
                rel="noreferrer"
                className="focus-ring flex w-full items-center justify-center gap-2 rounded-glass-sm bg-gradient-to-br from-brand-400 to-brand-600 py-2.5 text-sm font-semibold text-white shadow-glass transition-opacity hover:opacity-95"
              >
                <ExternalLink size={15} /> Track package
              </a>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Carrier" value={selected.carrierCode ?? '—'} />
              <Field label="Shipping Cost" value={selected.shippingCost != null ? money(selected.shippingCost) : '—'} />
              <Field label="Order" value={selected.orderNumber ?? (selected.orderId ? `#${selected.orderId}` : '—')} />
              <Field label="Ship date" value={shortDate(selected.shipDate)} />
            </div>
          </div>
        )}
      </Drawer>
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
