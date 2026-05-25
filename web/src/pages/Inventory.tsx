import { DataTable, EmptyState, ErrorPanel, PageHeader, Panel, RefreshButton, TableSkeleton } from '../components/PortalPrimitives';
import { safeDate, safeNumber } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useInventoryQuery } from '../lib/portalQueries';

export default function Inventory() {
  const auth = useAuth();
  const inventory = useInventoryQuery(auth.accessToken);
  const isFirstLoad = inventory.isLoading && !inventory.data;

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle="Current active SKU balances visible to your assigned client/store scope."
        action={<RefreshButton loading={inventory.isFetching} onClick={() => void inventory.refetch()} />}
      />
      {inventory.error ? (
        <ErrorPanel
          message={inventory.error instanceof Error ? inventory.error.message : String(inventory.error)}
          loading={inventory.isFetching}
          onRetry={() => void inventory.refetch()}
        />
      ) : null}
      <Panel title="Stock levels" right={<span className="text-xs font-bold text-ink-3">{inventory.data?.pagination?.total ?? 0} SKUs</span>}>
        {isFirstLoad ? (
          <TableSkeleton rows={7} columns={7} />
        ) : (
          <DataTable
            rows={inventory.data?.data ?? []}
            getRowKey={(item) => item.id}
            columns={[
              {
                key: 'sku',
                header: 'SKU',
                render: (item) => (
                  <div className="min-w-0">
                    <div className="truncate font-black text-ink">{item.sku ?? `SKU ${item.id}`}</div>
                    <div className="truncate text-xs font-semibold text-ink-3">{item.name ?? 'Unnamed item'}</div>
                  </div>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (item) => {
                  const stock = Number(item.effectiveStock ?? item.stockQty ?? 0);
                  const reorder = Number(item.reorderLevel ?? 0);
                  const low = Number.isFinite(stock) && Number.isFinite(reorder) && reorder > 0 && stock <= reorder;
                  return (
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${low ? 'bg-warn-bg text-warn' : 'bg-ok-bg text-ok'}`}>
                      {low ? 'Low' : 'Healthy'}
                    </span>
                  );
                },
              },
              {
                key: 'stock',
                header: 'Stock',
                className: 'right',
                render: (item) => <span className="font-black tabular-nums text-ink">{safeNumber(item.effectiveStock ?? item.stockQty)}</span>,
              },
              {
                key: 'reorder',
                header: 'Reorder',
                className: 'right',
                render: (item) => <span className="font-semibold tabular-nums text-ink-2">{safeNumber(item.reorderLevel)}</span>,
              },
              {
                key: 'sold',
                header: 'Sold 30d',
                className: 'right',
                render: (item) => <span className="font-semibold tabular-nums text-ink-2">{safeNumber(item.soldLast30Days)}</span>,
              },
              {
                key: 'updated',
                header: 'Updated',
                render: (item) => <span className="font-semibold text-ink-2">{safeDate(item.updatedAt)}</span>,
              },
            ]}
          />
        )}
        {!inventory.isLoading && (inventory.data?.data.length ?? 0) === 0 ? <EmptyState title="No inventory found" body="Active SKUs for your scoped account will appear here." /> : null}
      </Panel>
    </>
  );
}
