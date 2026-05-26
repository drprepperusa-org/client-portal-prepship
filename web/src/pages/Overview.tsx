import { AlertTriangle, ArrowRight, CheckCircle2, DollarSign, Package, TrendingUp, Truck } from 'lucide-react';
import { lazy, Suspense, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ErrorPanel, TableSkeleton } from '../components/PortalPrimitives';
import { StoreLogo } from '../components/store-connections/StoreLogo';
import { findConnectionPlatform } from '../components/store-connections/storePlatforms';
import { safeMoney, safeNumber } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  useCarrierAccountsQuery,
  useDailyCountsQuery,
  useDashboardQuery,
  useInventoryQuery,
  useOrdersQuery,
  useShipmentsQuery,
} from '../lib/portalQueries';

const DashboardCharts = lazy(() => import('../components/DashboardCharts').then((module) => ({ default: module.OrderVolumeChart })));
const ChannelMixChart = lazy(() => import('../components/DashboardCharts').then((module) => ({ default: module.ChannelMixChart })));

const chartColors = ['#03b0f7', '#22c55e', '#f59e0b', '#6366f1', '#ef4444', '#14b8a6'];

export default function Overview() {
  const auth = useAuth();
  const dashboard = useDashboardQuery(auth.accessToken);
  const dailyCounts = useDailyCountsQuery(auth.accessToken);
  const orders = useOrdersQuery(auth.accessToken);
  const inventory = useInventoryQuery(auth.accessToken);
  const shipments = useShipmentsQuery(auth.accessToken);
  const carrierAccounts = useCarrierAccountsQuery(auth.accessToken);
  const queries = [dashboard, dailyCounts, orders, inventory, shipments, carrierAccounts];
  const firstError = queries.find((query) => query.error)?.error;

  const latest = dailyCounts.data?.data.at(-1);
  const openOrders = latest?.awaiting ?? orders.data?.data.filter((o) => o.orderStatus === 'awaiting_shipment').length ?? 0;
  const inTransit = shipments.data?.data.filter((s) => !s.voided).length ?? 0;
  const lowStock = inventory.data?.data.filter((item) => {
    const stock = Number(item.effectiveStock ?? item.stockQty ?? 0);
    const reorder = Number(item.reorderLevel ?? 0);
    return reorder > 0 && stock <= reorder;
  }).length ?? 0;
  const stores = (carrierAccounts.data?.data ?? []).map((row) => ({
        provider: row.provider,
        name: String(row.label ?? row.provider ?? 'Store connection'),
        platform: findConnectionPlatform(row.provider, row.label),
        store: String(row.accountIdentifier ?? row.account_identifier ?? 'Connected account'),
        today: 0,
        status: 'Connected',
        tone: 'connected',
      }));
  const orderChartData = useMemo(
    () =>
      (dailyCounts.data?.data ?? []).map((day) => ({
        day: String(day.day),
        total: Number(day.total ?? 0),
        awaiting: Number(day.awaiting ?? 0),
        shipped: Number(day.shipped ?? 0),
        cancelled: Number(day.cancelled ?? 0),
      })),
    [dailyCounts.data],
  );
  const channelMixData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const order of orders.data?.data ?? []) {
      const rawChannel = order.sourceProvider ?? order.carrierCode ?? 'PrepShip';
      const channel = String(rawChannel).trim() || 'PrepShip';
      counts.set(channel, (counts.get(channel) ?? 0) + 1);
    }
    if (counts.size === 0) {
      for (const store of stores) counts.set(store.name, Math.max(1, Number(store.today ?? 0)));
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count], index) => ({ name, count, color: chartColors[index % chartColors.length] ?? chartColors[0] ?? '#03b0f7' }));
  }, [orders.data, stores]);
  const orderTotal = orderChartData.reduce((sum, day) => sum + day.total, 0);

  return (
    <div className="portal-page">
      {firstError ? (
        <ErrorPanel
          message={firstError instanceof Error ? firstError.message : String(firstError)}
          onRetry={() => queries.forEach((query) => void query.refetch())}
          loading={queries.some((query) => query.isFetching)}
        />
      ) : null}
      <div className="portal-kpis">
        <KpiCard icon={<Package size={18} />} label="Open Orders" value={safeNumber(openOrders)} hint={orders.isFetching || dailyCounts.isFetching ? 'Refreshing...' : 'Pending + processing'} tone="red" />
        <KpiCard icon={<Truck size={18} />} label="In Transit" value={safeNumber(inTransit)} hint={shipments.isFetching ? 'Refreshing...' : 'Active shipments'} tone="blue" />
        <KpiCard icon={<AlertTriangle size={18} />} label="Low Stock SKUs" value={safeNumber(lowStock)} hint={inventory.isFetching ? 'Refreshing...' : 'Below reorder point'} tone="amber" />
        <KpiCard icon={<DollarSign size={18} />} label="Revenue" value={safeMoney(dashboard.data?.revenue)} hint={dashboard.isFetching ? 'Refreshing...' : 'Last 30 days'} tone="green" />
      </div>

      <div className="portal-grid-2">
        <section className="portal-card">
          <div className="portal-card-head">
            <div>
              <h2>Orders volume</h2>
              <div className="portal-card-sub">Last 30 days - {safeNumber(orderTotal)} orders</div>
            </div>
            <TrendingUp size={16} className="portal-muted-icon" />
          </div>
          <div className="portal-chart-wrap">
            {dailyCounts.isLoading && !dailyCounts.data ? (
              <ChartLoading label="Loading order volume..." />
            ) : (
              <Suspense fallback={<ChartLoading label="Loading chart..." />}>
                <DashboardCharts data={orderChartData} />
              </Suspense>
            )}
          </div>
        </section>

        <section className="portal-card">
          <div className="portal-card-head">
            <div>
              <h2>Channel mix</h2>
              <div className="portal-card-sub">{channelMixData.length} {channelMixData.length === 1 ? 'channel' : 'channels'}</div>
            </div>
          </div>
          <div className="portal-chart-wrap">
            {orders.isLoading && !orders.data && carrierAccounts.isLoading && !carrierAccounts.data ? (
              <ChartLoading label="Loading channel mix..." />
            ) : (
              <Suspense fallback={<ChartLoading label="Loading chart..." />}>
                <ChannelMixChart data={channelMixData} />
              </Suspense>
            )}
          </div>
        </section>
      </div>

      <div className="portal-grid-2">
        <section className="portal-card">
          <div className="portal-card-head">
            <h2>Recent Orders</h2>
            <Link to="/dashboard/orders" className="portal-link inline-flex items-center gap-1 transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.985] motion-reduce:transform-none motion-reduce:transition-none">View all <ArrowRight size={14} /></Link>
          </div>
          {orders.isLoading && !orders.data ? (
            <TableSkeleton rows={4} columns={5} />
          ) : (
            <div className="overflow-x-auto">
              <table className="portal-table min-w-[680px]">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Channel</th>
                    <th>Customer</th>
                    <th className="right">Items</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(orders.data?.data ?? []).slice(0, 5).map((order) => (
                    <tr key={order.id} className="transition-colors duration-200 hover:bg-brand-bg/50 motion-reduce:transition-none">
                      <td className="mono">{order.orderNumber ?? order.externalOrderId ?? order.id}</td>
                      <td>{order.sourceProvider ?? order.carrierCode ?? 'PrepShip'}</td>
                      <td>{order.shipToName ?? 'Customer'}</td>
                      <td className="right">{order.items?.length ?? 0}</td>
                      <td><span className={`portal-badge portal-badge-${String(order.orderStatus ?? 'pending').toLowerCase()}`}>{String(order.orderStatus ?? 'pending').replace('_', ' ')}</span></td>
                    </tr>
                  ))}
                  {!orders.isLoading && (orders.data?.data.length ?? 0) === 0 ? (
                    <tr><td colSpan={5} className="portal-empty">No orders yet.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="portal-card">
          <div className="portal-card-head">
            <h2>Connected Stores</h2>
            <Link to="/dashboard/connections" className="portal-link inline-flex items-center gap-1 transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.985] motion-reduce:transform-none motion-reduce:transition-none">Manage <ArrowRight size={14} /></Link>
          </div>
          {carrierAccounts.isLoading && !carrierAccounts.data ? <TableSkeleton rows={4} columns={4} /> : <div className="portal-connections-list">
            {stores.map((store) => (
              <div key={`${store.name}-${store.store}`} className="portal-connection-row">
                <StoreLogo
                  platform={store.platform}
                  provider={store.provider}
                  label={store.name}
                  className="portal-platform-logo-sm"
                />
                <div className="portal-connection-meta">
                  <div className="portal-connection-name">{store.name}</div>
                  <div className="portal-connection-store">{store.store}</div>
                </div>
                <div className="portal-connection-stat">
                  <span className="portal-stat-num">{store.today}</span>
                  <span className="portal-stat-lbl">today</span>
                </div>
                <span className={`portal-status portal-status-${store.tone}`}>
                  {store.tone === 'connected' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                  {store.status}
                </span>
              </div>
            ))}
            {stores.length === 0 ? <div className="portal-empty">No connected stores yet.</div> : null}
          </div>}
        </section>
      </div>
    </div>
  );
}

function ChartLoading({ label }: { label: string }) {
  return (
    <div className="portal-chart-empty">
      <span>{label}</span>
      <small>Preparing dashboard chart data.</small>
    </div>
  );
}

function KpiCard({ icon, label, value, hint, tone }: { icon: ReactNode; label: string; value: string; hint: string; tone: string }) {
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
