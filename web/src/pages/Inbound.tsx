import { Download, PackageCheck } from 'lucide-react';
import { EmptyState, ErrorPanel, KpiSkeletonGrid, PageHeader, Panel, RefreshButton, TableSkeleton } from '../components/PortalPrimitives';
import { safeDate, safeNumber } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useInventoryQuery, useProductsQuery } from '../lib/portalQueries';

export default function Inbound() {
  const auth = useAuth();
  const inventory = useInventoryQuery(auth.accessToken);
  const products = useProductsQuery(auth.accessToken);

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
        subtitle="Receiving visibility for SKUs in your assigned client/store scope."
        action={<RefreshButton loading={inventory.isFetching || products.isFetching} onClick={() => { void inventory.refetch(); void products.refetch(); }} />}
      />
      {inventory.error ? (
        <div className="mb-5">
          <ErrorPanel message={inventory.error instanceof Error ? inventory.error.message : String(inventory.error)} loading={inventory.isFetching} onRetry={() => void inventory.refetch()} />
        </div>
      ) : null}
      {products.error ? (
        <div className="mb-5">
          <ErrorPanel message={products.error instanceof Error ? products.error.message : String(products.error)} loading={products.isFetching} onRetry={() => void products.refetch()} />
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
            <div className="portal-kpi-label">Product Records</div>
            <div className="portal-kpi-value">{safeNumber(products.data?.pagination?.total ?? products.data?.data?.length ?? 0)}</div>
            <div className="portal-kpi-hint">Catalog visibility</div>
          </div>
        </div>
      </div>}

      <Panel title="Receiving watchlist" right={<span className="text-xs font-bold text-ink-3">{safeNumber(lowStock.length)} SKU(s)</span>}>
        {inventory.isLoading && !inventory.data ? <TableSkeleton rows={5} columns={5} /> : <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-surface-2 text-[11px] uppercase text-ink-3">
              <tr>
                <th className="px-5 py-3 font-black">SKU</th>
                <th className="px-5 py-3 font-black">Product</th>
                <th className="px-5 py-3 font-black">Stock</th>
                <th className="px-5 py-3 font-black">Reorder</th>
                <th className="px-5 py-3 font-black">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {lowStock.map((item) => (
                <tr key={item.id} className="transition-colors duration-200 hover:bg-brand-bg/50 motion-reduce:transition-none">
                  <td className="px-5 py-4 font-black text-ink">{item.sku ?? `SKU ${item.id}`}</td>
                  <td className="px-5 py-4 text-ink-2">{item.name ?? 'Unnamed item'}</td>
                  <td className="px-5 py-4 text-ink-2">{safeNumber(item.effectiveStock ?? item.stockQty)}</td>
                  <td className="px-5 py-4 text-ink-2">{safeNumber(item.reorderLevel)}</td>
                  <td className="px-5 py-4 text-ink-2">{safeDate(item.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
        {!inventory.isLoading && lowStock.length === 0 ? <EmptyState title="No inbound attention needed" body="Low-stock and receiving-watch SKUs will appear here." /> : null}
      </Panel>
    </>
  );
}
