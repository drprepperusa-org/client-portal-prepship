import { useEffect, useMemo, useState } from 'react';
import { Search, MapPin, Copy, Building2 } from 'lucide-react';
import { GlassPanel } from '@/components/ui/Glass';
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
import { shipmentStatusMeta, shortDate } from '@/lib/status';
import { type Accent } from '@/lib/accents';
import type { PortalShipment } from '@/lib/api';

const CLIENT_ACCENTS: Accent[] = ['emerald', 'rose', 'indigo', 'amber', 'teal', 'violet', 'sky'];
function clientAccent(name: string | null): Accent {
  const s = name ?? '';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i)) % CLIENT_ACCENTS.length;
  return CLIENT_ACCENTS[h];
}

export default function Shipments() {
  const toast = useToast();
  const { clientId: globalClientId } = usePortalFilters();
  const clients = useClients().data?.data ?? [];
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  // Per-page client filter (like Orders' client switcher) for fast scoping.
  // undefined = follow the global "All clients" topbar filter.
  const [clientFilter, setClientFilter] = useState<number | undefined>(undefined);
  const [selected, setSelected] = useState<PortalShipment | null>(null);
  const debouncedQ = useDebounced(q, 350);
  const effectiveClientId = clientFilter ?? globalClientId;

  useEffect(() => setPage(1), [debouncedQ, effectiveClientId]);

  const query = useShipments({ search: debouncedQ, page, clientId: effectiveClientId });
  const rows = query.data?.data ?? [];
  const pg = query.data?.pagination;

  const showClientFilter = clients.length > 1;
  const columns: Column<PortalShipment>[] = useMemo(
    () => [
      { key: 'id', header: 'Shipment', defaultWidth: 110, render: (s) => <span className="font-semibold text-ink">#{s.id}</span>, sortAccessor: (s) => s.id },
      { key: 'order', header: 'Order', defaultWidth: 150, render: (s) => <span className="text-ink-3">{s.orderNumber ?? (s.orderId ? `#${s.orderId}` : '—')}</span>, sortAccessor: (s) => s.orderNumber ?? '' },
      {
        key: 'client',
        header: 'Client',
        defaultWidth: 150,
        render: (s) => (s.clientName ? <Chip accent={clientAccent(s.clientName)} dot={false}>{s.clientName}</Chip> : <span className="text-ink-3">—</span>),
        sortAccessor: (s) => s.clientName ?? '',
      },
      { key: 'carrier', header: 'Carrier', defaultWidth: 110, className: 'text-center', render: (s) => (s.carrierCode ? <CarrierBadge code={s.carrierCode} /> : <span className="text-ink-3">—</span>), sortAccessor: (s) => s.carrierCode ?? '' },
      { key: 'service', header: 'Service', defaultWidth: 160, render: (s) => <span className="text-ink-3">{s.serviceCode ?? '—'}</span>, sortAccessor: (s) => s.serviceCode ?? '' },
      { key: 'tracking', header: 'Tracking #', defaultWidth: 180, render: (s) => <span className="font-mono text-xs text-ink-2">{s.trackingNumber ?? s.labelTracking ?? '—'}</span>, sortAccessor: (s) => s.trackingNumber ?? s.labelTracking ?? '' },
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
        <label className="relative flex flex-1 items-center sm:max-w-md">
          <Search size={16} className="absolute left-3 text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tracking, carrier, order…" aria-label="Search shipments" className="focus-ring h-11 w-full rounded-glass-sm border border-white/80 bg-white/60 pl-9 pr-3 text-sm text-ink ring-1 ring-slate-200/70 placeholder:text-slate-400 focus:bg-white/90" />
        </label>

        {showClientFilter && (
          <label className="relative flex items-center sm:shrink-0">
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

            <div className="grid grid-cols-2 gap-3">
              <Field label="Carrier" value={selected.carrierCode ?? '—'} />
              <Field label="Service" value={selected.serviceCode ?? '—'} />
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
    <div className="rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
      <p className="text-xs font-medium text-ink-3">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}
