import { ExternalLink } from 'lucide-react';
import { DataTable, EmptyState, ErrorPanel, PageHeader, Panel, RefreshButton, TableSkeleton } from '../components/PortalPrimitives';
import { safeDate } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useShipmentsQuery } from '../lib/portalQueries';

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
  const shipments = useShipmentsQuery(auth.accessToken);
  const isFirstLoad = shipments.isLoading && !shipments.data;

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
        {isFirstLoad ? (
          <TableSkeleton rows={6} columns={5} />
        ) : (
          <DataTable
            tableId="shipments-history"
            rows={shipments.data?.data ?? []}
            getRowKey={(shipment) => shipment.id}
            columns={[
              {
                key: 'order',
                header: 'Order',
                render: (shipment) => (
                  <div className="min-w-0">
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
        {!shipments.isLoading && (shipments.data?.data.length ?? 0) === 0 ? <EmptyState title="No shipments found" body="Shipped labels and tracking will appear here after fulfillment." /> : null}
      </Panel>
    </>
  );
}
