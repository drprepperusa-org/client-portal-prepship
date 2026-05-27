import { useMemo, useState, type ReactNode } from 'react';
import { BarChart3, DollarSign, Package, TrendingUp, Truck } from 'lucide-react';
import { EmptyState, ErrorPanel, KpiSkeletonGrid, PageHeader, Panel, RefreshButton, TableSkeleton } from '../components/PortalPrimitives';
import { StoreFilterBar, clientIdOf, storeNameForClient } from '../components/StoreScopeControls';
import { safeMoney, safeNumber } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useBillingQuery, useClientsQuery, useDailyCountsQuery, useDailyShipmentsQuery, useDashboardQuery } from '../lib/portalQueries';
import type { PortalClient } from '../types/portal';

function clientRows(value: unknown): PortalClient[] {
  if (Array.isArray(value)) return value as PortalClient[];
  if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) return (value as { data: PortalClient[] }).data;
  return [];
}

export default function Reports() {
  const auth = useAuth();
  const clients = useClientsQuery(auth.accessToken);
  const dashboard = useDashboardQuery(auth.accessToken);
  const dailyCounts = useDailyCountsQuery(auth.accessToken);
  const dailyShipments = useDailyShipmentsQuery(auth.accessToken);
  const billing = useBillingQuery(auth.accessToken);
  const [activeClientId, setActiveClientId] = useState<number | 'all'>('all');
  const [search, setSearch] = useState('');
  const queries = [dashboard, dailyCounts, dailyShipments, billing, clients];
  const stores = clientRows(clients.data);
  const filteredBilling = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (billing.data?.data ?? []).filter((row) => {
      const clientId = clientIdOf(row);
      if (activeClientId !== 'all' && clientId !== activeClientId) return false;
      if (!query) return true;
      return storeNameForClient(stores, clientId, row.clientName).toLowerCase().includes(query);
    });
  }, [activeClientId, billing.data?.data, search, stores]);

  const orderTotal = dailyCounts.data?.data.reduce((sum, day) => sum + Number(day.total ?? 0), 0) ?? 0;
  const maxDailyOrders = Math.max(...(dailyCounts.data?.data ?? []).map((day) => Number(day.total ?? 0)), 1);
  const shippedTotal = dailyCounts.data?.data.reduce((sum, day) => sum + Number(day.shipped ?? 0), 0) ?? 0;
  const billingTotal = filteredBilling.reduce((sum, row) => sum + Number(row.grandTotal ?? 0), 0);
  const shipmentRows = Array.isArray(dailyShipments.data)
    ? dailyShipments.data
    : dailyShipments.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Live client-scoped operating totals from the same PrepShip backend."
        action={<RefreshButton loading={queries.some((query) => query.isFetching)} onClick={() => queries.forEach((query) => void query.refetch())} />}
      />
      {queries.find((query) => query.error)?.error ? (
        <div className="mb-5">
          <ErrorPanel
            message={queries.find((query) => query.error)?.error instanceof Error ? (queries.find((query) => query.error)?.error as Error).message : String(queries.find((query) => query.error)?.error)}
            loading={queries.some((query) => query.isFetching)}
            onRetry={() => queries.forEach((query) => void query.refetch())}
          />
        </div>
      ) : null}
      <StoreFilterBar clients={stores} value={activeClientId} onChange={setActiveClientId} search={search} onSearchChange={setSearch} label="Report store" />

      {queries.some((query) => query.isLoading && !query.data) ? <KpiSkeletonGrid /> : <div className="portal-kpis mb-6">
        <ReportKpi label="Orders" value={safeNumber(orderTotal)} hint="Selected window" tone="blue" icon={<Package size={18} />} />
        <ReportKpi label="Shipped" value={safeNumber(shippedTotal)} hint="Fulfilled orders" tone="blue" icon={<Truck size={18} />} />
        <ReportKpi label="Revenue" value={safeMoney(dashboard.data?.revenue)} hint="Dashboard summary" tone="green" icon={<DollarSign size={18} />} />
        <ReportKpi label="Billing" value={safeMoney(billingTotal)} hint="Scoped invoice summary" tone="amber" icon={<BarChart3 size={18} />} />
      </div>}

      <div className="portal-grid-2">
        <Panel title="Daily order trend" right={<span className="text-xs font-bold text-ink-3">Awaiting / shipped / cancelled</span>}>
          {dailyCounts.isLoading && !dailyCounts.data ? <TableSkeleton rows={6} columns={3} /> : <div className="portal-report-bars">
            {(dailyCounts.data?.data ?? []).map((day) => {
              const width = `${Math.max((Number(day.total ?? 0) / maxDailyOrders) * 100, day.total ? 8 : 0)}%`;
              return (
                <div className="portal-report-row" key={day.day}>
                  <span>{day.day}</span>
                  <div><i className="tone-orders" style={{ width }} /></div>
                  <strong>{safeNumber(day.total)}</strong>
                </div>
              );
            })}
          </div>}
          {!dailyCounts.isLoading && (dailyCounts.data?.data.length ?? 0) === 0 ? <EmptyState title="No order report data" body="Orders will populate this chart after syncing." /> : null}
        </Panel>

        <Panel title="Shipment activity" right={<TrendingUp size={15} className="text-brand" />}>
          {dailyShipments.isLoading && !dailyShipments.data ? <TableSkeleton rows={6} columns={3} /> : <div className="portal-report-bars">
            {shipmentRows.map((row, index) => {
              const day = String(row.day ?? row.date ?? `Row ${index + 1}`);
              const count = Number(row.shipments ?? row.count ?? row.total ?? 0);
              const max = Math.max(...shipmentRows.map((item) => Number(item.shipments ?? item.count ?? item.total ?? 0)), 1);
              return (
                <div className="portal-report-row" key={`${day}-${index}`}>
                  <span>{day}</span>
                  <div><i className="tone-shipments" style={{ width: `${Math.max((count / max) * 100, count ? 8 : 0)}%` }} /></div>
                  <strong>{safeNumber(count)}</strong>
                </div>
              );
            })}
          </div>}
          {!dailyShipments.isLoading && shipmentRows.length === 0 ? <EmptyState title="No shipment report data" body="Shipment totals will appear once labels are created." /> : null}
        </Panel>
      </div>
      <div className="mt-6">
        <Panel title="Store billing summary" right={<span className="text-xs font-bold text-ink-3">{filteredBilling.length} store(s)</span>}>
          <div className="portal-report-store-list">
            {filteredBilling.map((row) => (
              <div key={row.clientId ?? row.clientName}>
                <strong>{storeNameForClient(stores, row.clientId, row.clientName)}</strong>
                <span>{safeNumber(row.orderCount)} orders</span>
                <em>{safeMoney(row.grandTotal)}</em>
              </div>
            ))}
            {!billing.isLoading && filteredBilling.length === 0 ? <EmptyState title="No scoped billing rows" body="Billing totals appear only when invoice visibility is enabled for this account." /> : null}
          </div>
        </Panel>
      </div>
    </>
  );
}

function ReportKpi({ label, value, hint, tone, icon }: { label: string; value: string; hint: string; tone: string; icon: ReactNode }) {
  return (
    <div className={`portal-kpi portal-kpi-${tone}`}>
      <div className="portal-kpi-icon">{icon}</div>
      <div className="portal-kpi-body">
        <div className="portal-kpi-label">{label}</div>
        <div className="portal-kpi-value">{value}</div>
        <div className="portal-kpi-hint">{hint}</div>
      </div>
    </div>
  );
}
