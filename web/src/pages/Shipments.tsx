import { useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { DataTable, EmptyState, ErrorPanel, PageHeader, Panel, RefreshButton, TableSkeleton } from '../components/PortalPrimitives';
import { StoreBadge, StoreFilterBar, clientIdOf, storeNameForClient } from '../components/StoreScopeControls';
import { safeDate } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useClientsQuery, useShipmentsQuery } from '../lib/portalQueries';
import type { PortalClient } from '../types/portal';

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

  return (
    <>
      <PageHeader
        title="Shipments"
        subtitle="Safe shipment history and tracking links for labels already created in PrepShip."
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
        <StoreFilterBar clients={stores} value={activeClientId} onChange={setActiveClientId} search={search} onSearchChange={setSearch} label="Shipment store" />
        {isFirstLoad ? (
          <TableSkeleton rows={6} columns={5} />
        ) : (
          <DataTable
            tableId="shipments-history"
            rows={rows}
            getRowKey={(shipment) => shipment.id}
            columns={[
              {
                key: 'order',
                header: 'Order',
                render: (shipment) => (
                  <div className="min-w-0 space-y-1">
                    <StoreBadge name={storeNameForClient(stores, clientIdOf(shipment), shipment.storeName ?? shipment.clientName)} compact />
                    <div className="truncate font-black text-ink">{shipment.orderNumber ?? `Order ${shipment.orderId ?? '-'}`}</div>
                    <div className="text-xs font-semibold text-ink-3">{safeDate(shipment.shipDate)}</div>
                  </div>
                ),
              },
              {
                key: 'carrier',
                header: 'Carrier / Service',
                render: (shipment) => (
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-ink-2">{shipment.carrierCode ?? '-'}</div>
                    <div className="truncate text-xs font-semibold text-ink-3">{shipment.serviceCode ?? 'No service code'}</div>
                  </div>
                ),
              },
              {
                key: 'tracking',
                header: 'Tracking',
                render: (shipment) => (
                  <span className="block truncate font-semibold text-ink-2">
                    {shipment.trackingNumber ?? shipment.labelTracking ?? 'Tracking unavailable'}
                  </span>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (shipment) => (
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${shipment.voided ? 'bg-danger-bg text-danger' : 'bg-ok-bg text-ok'}`}>
                    {shipment.voided ? 'Voided' : 'Created'}
                  </span>
                ),
              },
              {
                key: 'label',
                header: 'Label',
                className: 'right',
                render: (shipment) => {
                  const labelUrl = safeExternalUrl(shipment.labelUrl);
                  return labelUrl ? (
                    <a href={labelUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-3 text-xs font-black text-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.985] motion-reduce:transform-none motion-reduce:transition-none">
                      Label <ExternalLink size={13} />
                    </a>
                  ) : shipment.labelUrl ? (
                    <span className="text-xs font-bold text-danger">Invalid label link</span>
                  ) : (
                    <span className="text-xs font-bold text-ink-3">No label</span>
                  );
                },
              },
            ]}
          />
        )}
        {!shipments.isLoading && rows.length === 0 ? <EmptyState title="No shipments found" body="Shipped labels and tracking for the selected store scope will appear here." /> : null}
      </Panel>
    </>
  );
}
