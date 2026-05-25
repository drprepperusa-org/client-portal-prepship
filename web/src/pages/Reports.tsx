import type { ReactNode } from 'react';
import { BarChart3, DollarSign, Package, Truck } from 'lucide-react';
import { EmptyState, ErrorPanel, KpiSkeletonGrid, PageHeader, Panel, RefreshButton, TableSkeleton } from '../components/PortalPrimitives';
import { safeMoney, safeNumber } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useBillingQuery, useDailyCountsQuery, useDailyShipmentsQuery, useDashboardQuery } from '../lib/portalQueries';

export default function Reports() {
  const auth = useAuth();
  const dashboard = useDashboardQuery(auth.accessToken);
  const dailyCounts = useDailyCountsQuery(auth.accessToken);
  const dailyShipments = useDailyShipmentsQuery(auth.accessToken);
  const billing = useBillingQuery(auth.accessToken);
  const queries = [dashboard, dailyCounts, dailyShipments, billing];

  const orderTotal = dailyCounts.data?.data.reduce((sum, day) => sum + Number(day.total ?? 0), 0) ?? 0;
  const shippedTotal = dailyCounts.data?.data.reduce((sum, day) => sum + Number(day.shipped ?? 0), 0) ?? 0;
  const billingTotal = billing.data?.data.reduce((sum, row) => sum + Number(row.grandTotal ?? 0), 0) ?? 0;
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

      {queries.some((query) => query.isLoading && !query.data) ? <KpiSkeletonGrid /> : <div className="portal-kpis mb-6">
        <ReportKpi label="Orders" value={safeNumber(orderTotal)} hint="Selected window" tone="red" icon={<Package size={18} />} />
        <ReportKpi label="Shipped" value={safeNumber(shippedTotal)} hint="Fulfilled orders" tone="blue" icon={<Truck size={18} />} />
        <ReportKpi label="Revenue" value={safeMoney(dashboard.data?.revenue)} hint="Dashboard summary" tone="green" icon={<DollarSign size={18} />} />
        <ReportKpi label="Billing" value={safeMoney(billingTotal)} hint="Invoice summary" tone="amber" icon={<BarChart3 size={18} />} />
      </div>}

      <div className="portal-grid-2">
        <Panel title="Daily order counts">
          {dailyCounts.isLoading && !dailyCounts.data ? <TableSkeleton rows={6} columns={3} /> : <div className="portal-report-bars">
            {(dailyCounts.data?.data ?? []).map((day) => {
              const max = Math.max(orderTotal, 1);
              const width = `${Math.max((Number(day.total ?? 0) / max) * 100, day.total ? 8 : 0)}%`;
              return (
                <div className="portal-report-row" key={day.day}>
                  <span>{day.day}</span>
                  <div><i style={{ width }} /></div>
                  <strong>{safeNumber(day.total)}</strong>
                </div>
              );
            })}
          </div>}
          {!dailyCounts.isLoading && (dailyCounts.data?.data.length ?? 0) === 0 ? <EmptyState title="No order report data" body="Orders will populate this chart after syncing." /> : null}
        </Panel>

        <Panel title="Shipment activity">
          {dailyShipments.isLoading && !dailyShipments.data ? <TableSkeleton rows={6} columns={3} /> : <div className="portal-report-bars">
            {shipmentRows.map((row, index) => {
              const day = String(row.day ?? row.date ?? `Row ${index + 1}`);
              const count = Number(row.shipments ?? row.count ?? row.total ?? 0);
              const max = Math.max(...shipmentRows.map((item) => Number(item.shipments ?? item.count ?? item.total ?? 0)), 1);
              return (
                <div className="portal-report-row" key={`${day}-${index}`}>
                  <span>{day}</span>
                  <div><i style={{ width: `${Math.max((count / max) * 100, count ? 8 : 0)}%` }} /></div>
                  <strong>{safeNumber(count)}</strong>
                </div>
              );
            })}
          </div>}
          {!dailyShipments.isLoading && shipmentRows.length === 0 ? <EmptyState title="No shipment report data" body="Shipment totals will appear once labels are created." /> : null}
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
