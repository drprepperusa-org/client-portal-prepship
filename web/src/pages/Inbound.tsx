import { Download, PackageCheck } from 'lucide-react';
import { DataTable, EmptyState, ErrorPanel, KpiSkeletonGrid, PageHeader, Panel, RefreshButton, TableSkeleton } from '../components/PortalPrimitives';
import { safeDate, safeNumber } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useInventoryQuery } from '../lib/portalQueries';

export default function Inbound() {
  const auth = useAuth();
  const inventory = useInventoryQuery(auth.accessToken);

  const rows = inventory.data?.data ?? [];
  const totalUnits = rows.reduce((sum, item) => sum + Number(item.effectiveStock ?? item.stockQty ?? 0), 0);
  const lowStock = rows.filter((item) => {
    const stock = Number(item.effectiveStock ?? item.stockQty ?? 0);
    const reorder = Number(item.reorderLevel ?? 0);
    return reorder > 0 && stock <= reorder;
  });

  return (
    <>
      <PageHeader
        title="Inbound"
        subtitle="Monitor receiving watchlists, restock needs, and inbound SKU activity."
        action={<RefreshButton loading={inventory.isFetching} onClick={() => { void inventory.refetch(); }} />}
      />
      {inventory.error ? (
        <div className="mb-5">
          <ErrorPanel message={inventory.error instanceof Error ? inventory.error.message : String(inventory.error)} loading={inventory.isFetching} onRetry={() => void inventory.refetch()} />
        </div>
      ) : null}

      {inventory.isLoading && !inventory.data ? <KpiSkeletonGrid /> : <div className="portal-kpis mb-6">
        <div className="portal-kpi portal-kpi-blue">
          <div className="portal-kpi-icon"><PackageCheck size={18} /></div>
          <div className="portal-kpi-body">
            <div className="portal-kpi-label">Active SKUs</div>
            <div className="portal-kpi-value">{safeNumber(inventory.data?.pagination?.total ?? rows.length)}</div>
            <div className="portal-kpi-hint">Scoped inventory</div>
          </div>
        </div>
        <div className="portal-kpi portal-kpi-green">
          <div className="portal-kpi-icon"><Download size={18} /></div>
          <div className="portal-kpi-body">
            <div className="portal-kpi-label">On Hand Units</div>
            <div className="portal-kpi-value">{safeNumber(totalUnits)}</div>
            <div className="portal-kpi-hint">Current effective stock</div>
          </div>
        </div>
        <div className="portal-kpi portal-kpi-amber">
          <div className="portal-kpi-icon"><PackageCheck size={18} /></div>
          <div className="portal-kpi-body">
            <div className="portal-kpi-label">Needs Restock</div>
            <div className="portal-kpi-value">{safeNumber(lowStock.length)}</div>
            <div className="portal-kpi-hint">At or below reorder</div>
          </div>
        </div>
        <div className="portal-kpi portal-kpi-red">
          <div className="portal-kpi-icon"><Download size={18} /></div>
          <div className="portal-kpi-body">
            <div className="portal-kpi-label">Receiving Watch</div>
            <div className="portal-kpi-value">{safeNumber(lowStock.length)}</div>
            <div className="portal-kpi-hint">Visible from scoped inventory</div>
          </div>
        </div>
      </div>}

      <Panel title="Receiving watchlist" right={<span className="text-xs font-bold text-ink-3">{safeNumber(lowStock.length)} SKU(s)</span>}>
        {inventory.isLoading && !inventory.data ? <TableSkeleton rows={5} columns={5} /> : (
          <DataTable
            tableId="inbound-receiving-watchlist"
            rows={lowStock}
            getRowKey={(item) => item.id}
            columns={[
              {
                key: 'sku',
                header: 'SKU',
                render: (item) => <span className="font-black text-ink">{item.sku ?? `SKU ${item.id}`}</span>,
              },
              {
                key: 'product',
                header: 'Product',
                render: (item) => <span className="font-semibold text-ink-2">{item.name ?? 'Unnamed item'}</span>,
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
                key: 'updated',
                header: 'Updated',
                render: (item) => <span className="font-semibold text-ink-2">{safeDate(item.updatedAt)}</span>,
              },
            ]}
          />
        )}
        {!inventory.isLoading && lowStock.length === 0 ? <EmptyState title="No inbound attention needed" body="Low-stock and receiving-watch SKUs will appear here." /> : null}
      </Panel>
    </>
  );
}
