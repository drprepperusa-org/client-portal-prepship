import { useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { Bar, BarChart, ResponsiveContainer } from 'recharts';
import { EmptyState, ErrorPanel, PageHeader, Panel, RefreshButton } from '../components/PortalPrimitives';
import { StoreSelectorDropdown, clientIdOf, storeNameForClient } from '../components/StoreScopeControls';
import { Table } from '../components/ui/Table';
import { safeDate, safeNumber } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useClientsQuery, useShipmentsQuery } from '../lib/portalQueries';
import type { PortalClient, PortalShipment } from '../types/portal';

function clientRows(value: unknown): PortalClient[] {
  if (Array.isArray(value)) return value as PortalClient[];
  if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) return (value as { data: PortalClient[] }).data;
  return [];
}

function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export default function Shipments() {
  const auth = useAuth();
  const clients = useClientsQuery(auth.accessToken);
  const shipments = useShipmentsQuery(auth.accessToken);
  const [activeClientId, setActiveClientId] = useState<number | 'all'>('all');
  const [search, setSearch] = useState('');
  const [storeSearch, setStoreSearch] = useState('');
  const isFirstLoad = shipments.isLoading && !shipments.data;
  const stores = clientRows(clients.data);
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (shipments.data?.data ?? []).filter((shipment) => {
      const clientId = clientIdOf(shipment);
      if (activeClientId !== 'all' && clientId !== activeClientId) return false;
      if (!query) return true;
      const store = storeNameForClient(stores, clientId, shipment.storeName ?? shipment.clientName);
      return [store, shipment.orderNumber, shipment.trackingNumber, shipment.labelTracking, shipment.carrierCode, shipment.serviceCode].filter(Boolean).join(' ').toLowerCase().includes(query);
    });
  }, [activeClientId, search, shipments.data?.data, stores]);
  const shipmentActivity = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const shipment of rows) {
      const day = safeDate(shipment.shipDate);
      buckets.set(day, (buckets.get(day) ?? 0) + 1);
    }
    const data = [...buckets.entries()].slice(-7).map(([day, count]) => ({ day, count }));
    return data.length > 0 ? data : [{ day: 'No data', count: 0 }];
  }, [rows]);
  const createdCount = rows.filter((shipment) => !shipment.voided).length;
  const voidedCount = rows.length - createdCount;
  const carrierCount = new Set(rows.map((shipment) => shipment.carrierCode).filter(Boolean)).size;
  const columns = useMemo<ColumnDef<PortalShipment>[]>(() => [
    {
      id: 'order',
      header: 'Order',
      size: 210,
      minSize: 170,
      accessorFn: (shipment) => shipment.orderNumber ?? shipment.orderId ?? '',
      cell: ({ row }) => {
        const shipment = row.original;
        return (
          <div className="min-w-0 space-y-1">
            <div className="truncate font-black text-ink">{shipment.orderNumber ?? `Order ${shipment.orderId ?? '-'}`}</div>
            <div className="text-xs font-semibold text-ink-3">{safeDate(shipment.shipDate)}</div>
          </div>
        );
      },
    },
    {
      id: 'carrier',
      header: 'Carrier / Service',
      size: 190,
      minSize: 150,
      accessorFn: (shipment) => `${shipment.carrierCode ?? ''} ${shipment.serviceCode ?? ''}`,
      cell: ({ row }) => {
        const shipment = row.original;
        return (
          <div className="min-w-0">
            <div className="truncate font-semibold text-ink-2">{shipment.carrierCode ?? '-'}</div>
            <div className="truncate text-xs font-semibold text-ink-3">{shipment.serviceCode ?? 'No service code'}</div>
          </div>
        );
      },
    },
    {
      id: 'tracking',
      header: 'Tracking',
      size: 220,
      minSize: 170,
      accessorFn: (shipment) => shipment.trackingNumber ?? shipment.labelTracking ?? '',
      cell: ({ row }) => (
        <span className="block truncate font-semibold text-ink-2">
          {row.original.trackingNumber ?? row.original.labelTracking ?? 'Tracking unavailable'}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      size: 120,
      minSize: 100,
      accessorFn: (shipment) => (shipment.voided ? 'Voided' : 'Created'),
      cell: ({ row }) => (
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${row.original.voided ? 'bg-danger-bg text-danger' : 'bg-ok-bg text-ok'}`}>
          {row.original.voided ? 'Voided' : 'Created'}
        </span>
      ),
    },
    {
      id: 'label',
      header: 'Label',
      size: 130,
      minSize: 110,
      enableSorting: false,
      cell: ({ row }) => {
        const labelUrl = safeExternalUrl(row.original.labelUrl);
        return labelUrl ? (
          <a href={labelUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-3 text-xs font-black text-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.985] motion-reduce:transform-none motion-reduce:transition-none">
            Label <ExternalLink size={13} />
          </a>
        ) : row.original.labelUrl ? (
          <span className="text-xs font-bold text-danger">Invalid label link</span>
        ) : (
          <span className="text-xs font-bold text-ink-3">No label</span>
        );
      },
    },
  ], []);

  return (
    <div className="portal-client-indicators-page">
      <PageHeader
        title="Shipments"
        subtitle="Review shipment history, tracking numbers, carrier service, and label links."
        action={<RefreshButton loading={shipments.isFetching} onClick={() => void shipments.refetch()} />}
      />
      {shipments.error ? (
        <ErrorPanel
          message={shipments.error instanceof Error ? shipments.error.message : String(shipments.error)}
          loading={shipments.isFetching}
          onRetry={() => void shipments.refetch()}
        />
      ) : null}
      <Panel title="Shipment history" right={<span className="text-xs font-bold text-ink-3">{shipments.data?.pagination?.total ?? 0} shipments</span>}>
        <div className="border-b border-line bg-surface-2 p-4">
          <StoreSelectorDropdown
            clients={stores}
            value={activeClientId}
            onChange={setActiveClientId}
            search={storeSearch}
            onSearchChange={setStoreSearch}
            label="Shipment store"
          />
          <div className="mt-4 grid gap-3 md:grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr]">
            <div className="rounded-xl bg-white p-4 ring-1 ring-line">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-ink-3">Shipment Activity</div>
                  <div className="mt-1 text-2xl font-black text-ink">{safeNumber(rows.length)}</div>
                </div>
                <div className="h-14 w-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={shipmentActivity}>
                      <Bar dataKey="count" fill="rgb(var(--brand-rgb))" radius={[4, 4, 2, 2]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
            <ShipmentMetric label="Created" value={safeNumber(createdCount)} tone="ok" />
            <ShipmentMetric label="Voided" value={safeNumber(voidedCount)} tone="danger" />
            <ShipmentMetric label="Carriers" value={safeNumber(carrierCount)} tone="brand" />
          </div>
        </div>
        <div className="p-4">
          <Table
            tableId="shipments-history"
            data={rows}
            columns={columns}
            loading={isFirstLoad}
            skeletonRows={6}
            defaultPageSize={25}
            pageSizeOptions={[10, 25, 50, 100]}
            emptyMessage="No shipments found"
          />
        </div>
        {!shipments.isLoading && rows.length === 0 ? <EmptyState title="No shipments found" body="Shipped labels and tracking for the selected store scope will appear here." /> : null}
      </Panel>
    </div>
  );
}

function ShipmentMetric({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'danger' | 'brand' }) {
  const toneClass =
    tone === 'ok'
      ? 'bg-ok/10 text-ok ring-ok/20'
      : tone === 'danger'
        ? 'bg-danger/10 text-danger ring-danger/20'
        : 'bg-brand/10 text-brand ring-brand/20';

  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-line">
      <div className="text-[10px] font-black uppercase tracking-widest text-ink-3">{label}</div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="text-xl font-black text-ink">{value}</div>
        <span className={`h-2.5 w-2.5 rounded-full ring-4 ${toneClass}`} aria-hidden />
      </div>
    </div>
  );
}
