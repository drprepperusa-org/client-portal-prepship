import { DataTable, EmptyState, ErrorPanel, PageHeader, Panel, RefreshButton, StatusBadge, TableSkeleton } from '../components/PortalPrimitives';
import { safeDate } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useOrdersQuery } from '../lib/portalQueries';

export default function Orders() {
  const auth = useAuth();
  const orders = useOrdersQuery(auth.accessToken);
  const isFirstLoad = orders.isLoading && !orders.data;

  return (
    <>
      <PageHeader
        title="Orders"
        subtitle="Read-only order visibility for your assigned client/store scope."
        action={<RefreshButton loading={orders.isFetching} onClick={() => void orders.refetch()} />}
      />
      {orders.error ? (
        <ErrorPanel
          message={orders.error instanceof Error ? orders.error.message : String(orders.error)}
          loading={orders.isFetching}
          onRetry={() => void orders.refetch()}
        />
      ) : null}
      <Panel title="Order activity" right={<span className="text-xs font-bold text-ink-3">{orders.data?.pagination?.total ?? 0} orders</span>}>
        {isFirstLoad ? (
          <TableSkeleton rows={6} columns={6} />
        ) : (
          <DataTable
            rows={orders.data?.data ?? []}
            getRowKey={(order) => order.id}
            columns={[
              {
                key: 'order',
                header: 'Order',
                render: (order) => <span className="font-black text-ink">{order.orderNumber ?? order.externalOrderId ?? order.id}</span>,
              },
              {
                key: 'status',
                header: 'Status',
                render: (order) => <StatusBadge value={order.orderStatus} />,
              },
              {
                key: 'recipient',
                header: 'Recipient',
                render: (order) => (
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-ink-2">{order.shipToName ?? 'Not available'}</div>
                    <div className="truncate text-xs text-ink-3">{[order.shipToCity, order.shipToState].filter(Boolean).join(', ') || 'No city/state'}</div>
                  </div>
                ),
              },
              {
                key: 'items',
                header: 'Items',
                render: (order) => (
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-ink-2">{order.items?.[0]?.sku ?? 'Mixed items'}</div>
                    <div className="text-xs text-ink-3">{order.items?.length ?? 0} line(s)</div>
                  </div>
                ),
              },
              {
                key: 'carrier',
                header: 'Carrier',
                render: (order) => (
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-ink-2">{order.label?.carrierCode ?? order.carrierCode ?? '-'}</div>
                    <div className="truncate text-xs text-ink-3">{order.label?.serviceCode ?? order.serviceCode ?? ''}</div>
                  </div>
                ),
              },
              {
                key: 'date',
                header: 'Date',
                render: (order) => <span className="font-semibold text-ink-2">{safeDate(order.orderDate)}</span>,
              },
            ]}
          />
        )}
        {!orders.isLoading && (orders.data?.data.length ?? 0) === 0 ? <EmptyState title="No orders found" body="Your scoped orders will appear here after they sync into PrepShip." /> : null}
      </Panel>
    </>
  );
}
