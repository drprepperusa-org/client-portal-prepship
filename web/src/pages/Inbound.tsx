import { Download, PackageCheck } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import { EmptyState, ErrorPanel, KpiSkeletonGrid, PageHeader, Panel, RefreshButton } from '../components/PortalPrimitives';
import { Table } from '../components/ui/Table';
import { safeDate, safeNumber } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useInventoryQuery } from '../lib/portalQueries';
import type { PortalInventoryItem } from '../types/portal';

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
  const columns = useMemo<ColumnDef<PortalInventoryItem>[]>(
    () => [
      {
        id: 'sku',
        header: 'SKU',
        size: 160,
        minSize: 120,
        accessorFn: (item) => item.sku ?? `SKU ${item.id}`,
        cell: ({ row }) => <span className="font-black text-ink">{row.original.sku ?? `SKU ${row.original.id}`}</span>,
      },
      {
        id: 'product',
        header: 'Product',
        size: 280,
        minSize: 180,
        accessorFn: (item) => item.name ?? '',
        cell: ({ row }) => <span className="font-semibold text-ink-2">{row.original.name ?? 'Unnamed item'}</span>,
      },
      {
        id: 'stock',
        header: 'Stock',
        size: 110,
        minSize: 90,
        accessorFn: (item) => Number(item.effectiveStock ?? item.stockQty ?? 0),
        cell: ({ row }) => <span className="font-black tabular-nums text-ink">{safeNumber(row.original.effectiveStock ?? row.original.stockQty)}</span>,
      },
      {
        id: 'reorder',
        header: 'Reorder',
        size: 120,
        minSize: 100,
        accessorFn: (item) => Number(item.reorderLevel ?? 0),
        cell: ({ row }) => <span className="font-semibold tabular-nums text-ink-2">{safeNumber(row.original.reorderLevel)}</span>,
      },
      {
        id: 'updated',
        header: 'Updated',
        size: 150,
        minSize: 120,
        accessorFn: (item) => item.updatedAt ?? '',
        cell: ({ row }) => <span className="font-semibold text-ink-2">{safeDate(row.original.updatedAt)}</span>,
      },
    ],
    [],
  );

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
        <div className="p-4">
          <Table
            tableId="inbound-receiving-watchlist"
            data={lowStock}
            columns={columns}
            loading={inventory.isLoading && !inventory.data}
            skeletonRows={5}
            defaultPageSize={25}
            pageSizeOptions={[10, 25, 50, 100]}
            emptyMessage="No inbound attention needed"
          />
        </div>
        {!inventory.isLoading && lowStock.length === 0 ? <EmptyState title="No inbound attention needed" body="Low-stock and receiving-watch SKUs will appear here." /> : null}
      </Panel>
    </>
  );
}
