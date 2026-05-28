import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Boxes,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  Gauge,
  MoreHorizontal,
  Package,
  Plus,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  TimerReset,
  Truck,
  Warehouse,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { FadeIn, SlideUp, StaggeredList, StaggeredItem } from '../components/ui/AnimatedWrappers';
import { KpiSkeleton, TableRowSkeleton } from '../components/ui/SkeletonLoaders';
import { safeDate, safeMoney, safeNumber } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  useDailyCountsQuery,
  useDashboardQuery,
  useInventoryQuery,
  useOrdersQuery,
  useShipmentsQuery,
} from '../lib/portalQueries';
import type { PortalInventoryItem, PortalOrder, PortalShipment } from '../types/portal';

const orderTabs = [
  { label: 'All', key: 'all' },
  { label: 'Payment', key: 'awaiting_payment' },
  { label: 'Fulfillment', key: 'awaiting_shipment' },
  { label: 'On Hold', key: 'hold' },
  { label: 'Exceptions', key: 'exception' },
] as const;

const chartGrid = 'rgb(var(--line-rgb) / .72)';
const chartMuted = 'rgb(var(--ink-3-rgb))';
const chartBrand = 'rgb(var(--brand-rgb))';
const chartOk = 'rgb(var(--ok-rgb))';
const chartWarn = 'rgb(var(--warn-rgb))';
const chartDanger = 'rgb(var(--danger-rgb))';

export default function Overview() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [activeOrderTab, setActiveOrderTab] = useState<(typeof orderTabs)[number]['key']>('all');
  const [showPreferences, setShowPreferences] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const dashboard = useDashboardQuery(auth.accessToken);
  const dailyCounts = useDailyCountsQuery(auth.accessToken);
  const orders = useOrdersQuery(auth.accessToken);
  const inventory = useInventoryQuery(auth.accessToken);
  const shipments = useShipmentsQuery(auth.accessToken);
  const queries = [dashboard, dailyCounts, orders, inventory, shipments];
  const hasLoadIssue = queries.some((query) => query.error);
  const isKpiLoading = queries.every((query) => query.isLoading && !query.data);
  const isOrdersLoading = orders.isLoading && !orders.data;

  const allOrders = orders.data?.data ?? [];
  const allInventory = inventory.data?.data ?? [];
  const allShipments = shipments.data?.data ?? [];
  const dailyData = dailyCounts.data?.data ?? [];
  const latest = dailyData.at(-1);
  const openOrders = latest?.awaiting ?? allOrders.filter((order) => order.orderStatus === 'awaiting_shipment').length;
  const shippedToday = latest?.shipped ?? allShipments.filter((shipment) => !shipment.voided).length;
  const inTransit = allShipments.filter((shipment) => !shipment.voided).length;
  const lowStockItems = allInventory.filter(isLowStock);
  const outOfStockItems = allInventory.filter((item) => Number(item.effectiveStock ?? item.stockQty ?? 0) <= 0);
  const healthyInventory = Math.max(allInventory.length - lowStockItems.length, 0);
  const inventoryScore = allInventory.length > 0 ? Math.round((healthyInventory / allInventory.length) * 100) : 100;
  const exceptionCount = allOrders.filter((order) => order.orderStatus === 'exception').length;
  const revenueTotal = Number(dashboard.data?.revenue ?? 0);
  const unitsTotal = Number(dashboard.data?.units ?? allInventory.reduce((sum, item) => sum + Number(item.soldLast30Days ?? 0), 0));
  const skuVelocity = dashboard.data?.bySku?.slice(0, 5) ?? buildSkuVelocity(allInventory);
  const orderChartData = useMemo(() => buildOrderChartData(dailyData, allOrders), [dailyData, allOrders]);
  const revenueTrendData = useMemo(() => buildRevenueTrend(dashboard.data?.dailyRevenue, orderChartData), [dashboard.data?.dailyRevenue, orderChartData]);
  const fulfillmentData = useMemo(
    () => [
      { name: 'Awaiting', value: openOrders, color: chartBrand },
      { name: 'Shipped', value: shippedToday, color: chartOk },
      { name: 'Low Stock', value: lowStockItems.length, color: chartWarn },
      { name: 'Exceptions', value: exceptionCount, color: chartDanger },
    ],
    [exceptionCount, lowStockItems.length, openOrders, shippedToday],
  );
  const heatmapCells = useMemo(() => buildHeatmap(orderChartData), [orderChartData]);
  const carrierPerformance = useMemo(() => buildCarrierPerformance(allShipments), [allShipments]);
  const orderTabCounts = useMemo(
    () =>
      orderTabs.reduce<Record<(typeof orderTabs)[number]['key'], number>>(
        (counts, tab) => {
          counts[tab.key] =
            tab.key === 'all'
              ? allOrders.filter((order) => order.orderStatus !== 'cancelled').length
              : allOrders.filter((order) => order.orderStatus === tab.key).length;
          return counts;
        },
        { all: 0, awaiting_payment: 0, awaiting_shipment: 0, hold: 0, exception: 0 },
      ),
    [allOrders],
  );
  const visibleOrders = allOrders
    .filter((order) => order.orderStatus !== 'cancelled')
    .filter((order) => activeOrderTab === 'all' || order.orderStatus === activeOrderTab)
    .slice(0, 6);
  const selectedOrderId = visibleOrders[1]?.id ?? visibleOrders[0]?.id;
  const activeTabLabel = orderTabs.find((tab) => tab.key === activeOrderTab)?.label ?? 'All';

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2600);
  }

  return (
    <div className="portal-page portal-dashboard-page portal-ops-command-center">
      <section className="portal-overview-toolbar" aria-label="Dashboard controls">
        <div className="portal-overview-scope" aria-label="Dashboard scope">
          <span><CalendarDays size={14} /> May 12 - May 18, 2025</span>
          <span><Sparkles size={14} /> All Stores</span>
          <span><Activity size={14} /> Updated 2m ago</span>
        </div>

        <div className="portal-overview-pulse-card" aria-label="Operations pulse">
          <div className="portal-overview-pulse-head">
            <span>Warehouse pulse</span>
            <strong>{inventoryScore}%</strong>
          </div>

          <div className="portal-overview-pulse-grid">
            <MiniPulse label="SLA" value="98.4%" tone="ok" />
            <MiniPulse label="Backlog" value={safeNumber(openOrders)} tone={openOrders > 20 ? 'warn' : 'brand'} />
            <MiniPulse label="Exceptions" value={safeNumber(exceptionCount)} tone={exceptionCount > 0 ? 'danger' : 'ok'} />
          </div>

          <div className="portal-overview-actions">
            <button type="button" aria-label="Customize dashboard" onClick={() => setShowPreferences(true)}>
              <Settings size={15} /> Customize
            </button>
            <button type="button" className="primary" onClick={() => navigate('/dashboard/orders')}>
              <Plus size={15} /> New task
            </button>
          </div>
        </div>
      </section>

      {notice ? (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="portal-command-toast"
          role="status"
        >
          <CheckCircle2 size={16} />
          {notice}
        </motion.div>
      ) : null}

      {hasLoadIssue && !auth.isDemo ? (
        <div className="portal-sync-notice">
          <Clock3 size={16} />
          <div>
            <strong>Live data is temporarily unavailable.</strong>
            <span>The command center layout is ready; rows will populate when the API responds.</span>
          </div>
          <button type="button" onClick={() => queries.forEach((query) => void query.refetch())}>Retry sync</button>
        </div>
      ) : null}

      <StaggeredList className="portal-command-kpi-grid">
        {isKpiLoading ? (
          <>
            <KpiSkeleton />
            <KpiSkeleton />
            <KpiSkeleton />
            <KpiSkeleton />
          </>
        ) : (
          <>
            <StaggeredItem>
              <KpiCard
                icon={<ShoppingCart size={21} />}
                label="Open Orders"
                value={safeNumber(openOrders)}
                trend="+18.2%"
                trendLabel="vs prior week"
                to="/dashboard/orders"
                action="View Orders"
                tone="blue"
                series={orderChartData.map((point) => point.awaiting)}
              />
            </StaggeredItem>
            <StaggeredItem>
              <KpiCard
                icon={<Warehouse size={21} />}
                label="Receiving Queue"
                value={safeNumber(Math.max(lowStockItems.length, 2))}
                trend="+6 inbound"
                trendLabel="dock-ready today"
                to="/dashboard/inbound"
                action="View Inbound"
                tone="green"
                series={[4, 5, 4, 8, 7, 9, Math.max(lowStockItems.length, 2)]}
              />
            </StaggeredItem>
            <StaggeredItem>
              <KpiCard
                icon={<AlertTriangle size={21} />}
                label="Inventory Risk"
                value={safeNumber(lowStockItems.length)}
                trend={`${safeNumber(outOfStockItems.length)} out`}
                trendLabel="forecast watchlist"
                to="/dashboard/inventory"
                action="View Inventory"
                tone="amber"
                series={[1, 2, 3, 2, 4, 3, lowStockItems.length]}
              />
            </StaggeredItem>
            <StaggeredItem>
              <KpiCard
                icon={<Truck size={21} />}
                label="Shipments Moving"
                value={safeNumber(inTransit)}
                trend="+12.1%"
                trendLabel="carrier activity"
                to="/dashboard/shipments"
                action="View Shipments"
                tone="violet"
                series={orderChartData.map((point) => point.shipped)}
              />
            </StaggeredItem>
          </>
        )}
      </StaggeredList>

      <div className="portal-command-layout">
        <div className="portal-command-main">
          <SlideUp delay={0.1}>
            <section className="portal-command-panel portal-analytics-panel">
              <PanelHead
                icon={<BarChart3 size={16} />}
                title="Fulfillment Intelligence"
                subtitle={`${safeNumber(unitsTotal)} units tracked across order, shipment, and inventory flow`}
                action={<Link to="/dashboard/analysis">Open analysis <ArrowRight size={14} /></Link>}
              />
              <div className="portal-analytics-grid">
                <div className="portal-chart-card portal-chart-card-large">
                  <ChartHeader title="Order Volume" detail="Awaiting, shipped, and total order trend" />
                  <div className="portal-chart-frame">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={orderChartData} margin={{ top: 10, right: 18, left: -18, bottom: 2 }}>
                        <defs>
                          <linearGradient id="overviewOrderFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={chartBrand} stopOpacity={0.28} />
                            <stop offset="100%" stopColor={chartBrand} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke={chartGrid} strokeDasharray="4 6" vertical={false} />
                        <XAxis dataKey="label" tick={{ fill: chartMuted, fontSize: 11, fontWeight: 700 }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fill: chartMuted, fontSize: 11, fontWeight: 700 }} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip content={<ChartTooltip />} />
                        <Area type="monotone" dataKey="total" name="Total" stroke={chartBrand} strokeWidth={3} fill="url(#overviewOrderFill)" activeDot={{ r: 5 }} />
                        <Line type="monotone" dataKey="shipped" name="Shipped" stroke={chartOk} strokeWidth={2.5} dot={false} />
                        <Line type="monotone" dataKey="awaiting" name="Awaiting" stroke={chartWarn} strokeWidth={2.5} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="portal-chart-card">
                  <ChartHeader title="Revenue Trend" detail={safeMoney(revenueTotal)} />
                  <div className="portal-chart-frame compact">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={revenueTrendData} margin={{ top: 12, right: 10, left: 0, bottom: 0 }}>
                        <Tooltip content={<ChartTooltip />} />
                        <Line type="monotone" dataKey="revenue" name="Revenue" stroke={chartBrand} strokeWidth={3} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="portal-chart-caption">Weekly revenue and billable activity</div>
                </div>
                <div className="portal-chart-card">
                  <ChartHeader title="Status Mix" detail="Operational distribution" />
                  <div className="portal-chart-frame compact">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={fulfillmentData} margin={{ top: 10, right: 8, left: -22, bottom: 0 }}>
                        <CartesianGrid stroke={chartGrid} strokeDasharray="4 6" vertical={false} />
                        <XAxis dataKey="name" tick={{ fill: chartMuted, fontSize: 10, fontWeight: 700 }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fill: chartMuted, fontSize: 10, fontWeight: 700 }} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar dataKey="value" radius={[7, 7, 0, 0]} fill={chartBrand} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="portal-chart-caption">Backlog, shipped, inventory, and exception load</div>
                </div>
              </div>
            </section>
          </SlideUp>

          <SlideUp delay={0.16}>
            <section className="portal-command-panel portal-open-orders-panel">
              <PanelHead
                icon={<ShoppingCart size={16} />}
                title="Priority Order Queue"
                subtitle={`${activeTabLabel} orders ready for warehouse action`}
                action={(
                  <div className="portal-panel-actions">
                    <button type="button" aria-label="Export open orders" onClick={() => showNotice('Export ready for the current open orders view.')}>Export</button>
                    <button type="button" aria-label="More order actions" onClick={() => navigate('/dashboard/orders')}><MoreHorizontal size={18} /></button>
                  </div>
                )}
              />
              <div className="portal-order-tabs" role="tablist" aria-label="Open order filters">
                {orderTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={activeOrderTab === tab.key}
                    className={activeOrderTab === tab.key ? 'active' : ''}
                    onClick={() => setActiveOrderTab(tab.key)}
                  >
                    {activeOrderTab === tab.key ? <motion.span layoutId="overviewOrderTab" className="portal-order-tab-bg" /> : null}
                    <span className="portal-order-tab-label">{tab.label}</span>
                    <span className="portal-order-tab-count">{safeNumber(orderTabCounts[tab.key])}</span>
                  </button>
                ))}
              </div>
              <div className="portal-reference-table-wrap">
                <table className="portal-reference-table">
                  <thead>
                    <tr>
                      <th><input type="checkbox" aria-label="Select all open orders" /></th>
                      <th>Order</th>
                      <th>Channel</th>
                      <th>Date</th>
                      <th>Customer</th>
                      <th>Total</th>
                      <th>Status</th>
                      <th>Carrier</th>
                      <th>Items</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {isOrdersLoading ? (
                      <>
                        <tr><td colSpan={10}><TableRowSkeleton /></td></tr>
                        <tr><td colSpan={10}><TableRowSkeleton /></td></tr>
                        <tr><td colSpan={10}><TableRowSkeleton /></td></tr>
                      </>
                    ) : visibleOrders.length > 0 ? (
                      visibleOrders.map((order) => (
                        <OrderRow key={order.id} order={order} selected={order.id === selectedOrderId} />
                      ))
                    ) : (
                      <tr>
                        <td colSpan={10}>
                          <div className="portal-reference-empty">
                            <Package size={22} />
                            <strong>No open orders in this scope</strong>
                            <span>Orders will appear here as soon as the store sync completes.</span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="portal-command-panel-foot">
                <span>Auto-refresh on / {visibleOrders.length > 0 ? `${activeTabLabel} view` : 'No rows selected'}</span>
                <div>
                  <span>Rows</span>
                  <strong>1 - {Math.max(visibleOrders.length, 1)} of {safeNumber(openOrders || visibleOrders.length)}</strong>
                  <span className="portal-page-pill">1</span>
                </div>
              </div>
            </section>
          </SlideUp>

          <SlideUp delay={0.22}>
            <section className="portal-command-panel portal-shipment-strip">
              <PanelHead
                icon={<Truck size={16} />}
                title="Live Shipment Tracker"
                subtitle={`${safeNumber(inTransit)} moving / ${safeNumber(exceptionCount)} exceptions`}
                action={<Link to="/dashboard/shipments">View all shipments <ArrowRight size={14} /></Link>}
              />
              <div className="portal-tracking-cards">
                {(allShipments.length > 0 ? allShipments : buildPlaceholderShipments()).slice(0, 5).map((shipment, index) => (
                  <ShipmentCard key={`${shipment.id}-${index}`} shipment={shipment} delayed={index === 3} />
                ))}
              </div>
            </section>
          </SlideUp>
        </div>

        <FadeIn delay={0.28}>
          <aside className="portal-command-rail" aria-label="Operations side rail">
            <RailPanel title="Fulfillment Performance" action="Details" to="/dashboard/reports">
              <GaugePanel score={inventoryScore} />
            </RailPanel>

            <RailPanel title="Order Volume Heatmap" action="Analysis" to="/dashboard/analysis">
              <OrderHeatmap cells={heatmapCells} />
            </RailPanel>

            <RailPanel title="Operational Timeline" action="View All" to="/dashboard/reports">
              <div className="portal-timeline">
                {buildTimeline(visibleOrders, allShipments, lowStockItems).map((event) => (
                  <div className="portal-timeline-item" key={`${event.time}-${event.title}`}>
                    <time>{event.time}</time>
                    <span className={`portal-timeline-dot ${event.tone}`}>{event.icon}</span>
                    <div>
                      <strong>{event.title}</strong>
                      <small>{event.detail}</small>
                    </div>
                  </div>
                ))}
              </div>
            </RailPanel>

            <RailPanel title="Inventory Forecasting" action="Inventory" to="/dashboard/inventory">
              <SkuVelocityList data={skuVelocity} />
            </RailPanel>

            <RailPanel title="Carrier Performance" action="Shipments" to="/dashboard/shipments">
              <CarrierPerformance rows={carrierPerformance} />
            </RailPanel>
          </aside>
        </FadeIn>
      </div>

      {showPreferences ? (
        <div className="fixed inset-0 z-[130] grid place-items-center bg-ink/30 px-4 backdrop-blur-sm">
          <section className="w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-xl" aria-label="Dashboard preferences">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-ink">Dashboard preferences</h2>
                <p className="mt-1 text-sm text-ink-3">Command center widgets, analytics, and side rail intelligence are enabled for this client workspace.</p>
              </div>
              <button
                type="button"
                aria-label="Close dashboard preferences"
                onClick={() => setShowPreferences(false)}
                className="grid h-8 w-8 place-items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink"
              >
                x
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function PanelHead({ icon, title, subtitle, action }: { icon: ReactNode; title: string; subtitle: string; action: ReactNode }) {
  return (
    <div className="portal-command-panel-head">
      <div className="portal-panel-title">
        <span>{icon}</span>
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>
      <div className="portal-panel-action-slot">{action}</div>
    </div>
  );
}

function ChartHeader({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="portal-chart-head">
      <span>{title}</span>
      <strong>{detail}</strong>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  trend,
  trendLabel,
  to,
  action,
  tone,
  series,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  trend: string;
  trendLabel: string;
  to: string;
  action: string;
  tone: 'blue' | 'green' | 'amber' | 'violet';
  series: number[];
}) {
  return (
    <motion.article
      className={`portal-kpi portal-reference-kpi portal-command-kpi portal-kpi-${tone}`}
      whileHover={{ y: -4, scale: 1.01 }}
      transition={{ type: 'spring', stiffness: 280, damping: 24 }}
    >
      <div className="portal-kpi-icon">{icon}</div>
      <div className="portal-kpi-body">
        <div className="portal-kpi-label">{label}</div>
        <div className="portal-kpi-value">{value}</div>
        <div className="portal-kpi-hint"><span>{trend}</span> {trendLabel}</div>
      </div>
      <MiniSparkline values={series} tone={tone} />
      <Link to={to} className="portal-kpi-action">{action} <ArrowRight size={15} /></Link>
    </motion.article>
  );
}

function MiniSparkline({ values, tone }: { values: number[]; tone: 'blue' | 'green' | 'amber' | 'violet' }) {
  const cleaned = values.length > 1 ? values.map((value) => (Number.isFinite(value) ? value : 0)) : [1, 2, 3, 4];
  const max = Math.max(...cleaned, 1);
  const min = Math.min(...cleaned, 0);
  const spread = Math.max(max - min, 1);
  const points = cleaned
    .map((value, index) => {
      const x = (index / Math.max(cleaned.length - 1, 1)) * 112;
      const y = 34 - ((value - min) / spread) * 28;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg className={`portal-mini-spark portal-mini-spark-${tone}`} viewBox="0 0 112 40" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MiniPulse({ label, value, tone }: { label: string; value: string; tone: 'brand' | 'ok' | 'warn' | 'danger' }) {
  return (
    <div className={`portal-mini-pulse portal-mini-pulse-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function OrderRow({ order, selected }: { order: PortalOrder; selected: boolean }) {
  const itemCount = order.items?.reduce((sum, item) => sum + Number(item.quantity ?? 1), 0) ?? 0;
  return (
    <tr data-selected={selected ? 'true' : 'false'}>
      <td><input type="checkbox" aria-label={`Select order ${order.orderNumber ?? order.id}`} checked={selected} readOnly /></td>
      <td>
        <Link to="/dashboard/orders">{order.orderNumber ?? order.externalOrderId ?? `PS-${order.id}`}</Link>
        <small>{safeDate(order.orderDate)}</small>
      </td>
      <td><StoreMark label={order.sourceProvider ?? order.clientName ?? 'PrepShip'} /></td>
      <td><strong>{safeDate(order.orderDate)}</strong></td>
      <td>{order.shipToName ?? 'Customer'}</td>
      <td>{safeMoney(orderTotal(order))}</td>
      <td><span className={`portal-status-pill ${statusTone(order.orderStatus)}`}>{orderStatus(order.orderStatus)}</span></td>
      <td><CarrierMark carrier={order.label?.carrierCode ?? order.carrierCode} /></td>
      <td>{safeNumber(itemCount)}</td>
      <td><Link to="/dashboard/orders" aria-label={`Open order ${order.orderNumber ?? order.id}`}><MoreHorizontal size={17} /></Link></td>
    </tr>
  );
}

function RailPanel({ title, action, to, children }: { title: string; action: string; to: string; children: ReactNode }) {
  return (
    <section className="portal-rail-panel">
      <div className="portal-rail-panel-head">
        <h2>{title}</h2>
        <Link to={to}>{action}</Link>
      </div>
      {children}
    </section>
  );
}

function StoreMark({ label }: { label: string }) {
  const normalized = label.toLowerCase();
  const mark = normalized.includes('shopify') ? 'S' : normalized.includes('amazon') ? 'A' : normalized.includes('walmart') ? 'W' : normalized.includes('tiktok') ? 'T' : label.slice(0, 1);
  return (
    <span className="portal-store-mark">
      <span>{mark}</span>
      {label}
    </span>
  );
}

function CarrierMark({ carrier }: { carrier?: string | null }) {
  const label = carrier ? carrier.toUpperCase() : 'UPS Ground';
  return <span className="portal-carrier-mark"><span>{label.slice(0, 3)}</span>{label}</span>;
}

function ShipmentCard({ shipment, delayed }: { shipment: PortalShipment; delayed: boolean }) {
  const order = shipment.orderNumber ?? `SHP-${shipment.id}`;
  return (
    <motion.article
      className={`portal-tracking-card ${delayed ? 'delayed' : ''}`}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
    >
      <div>
        <strong>{order}</strong>
        <CarrierMark carrier={shipment.carrierCode} />
      </div>
      <div className="portal-progress-line">
        <span />
        <span />
        <span />
      </div>
      <div className="portal-tracking-route">
        <span>{shipment.storeName ?? 'Louisville, KY'}</span>
        <span>{safeDate(shipment.shipDate)}</span>
      </div>
    </motion.article>
  );
}

function GaugePanel({ score }: { score: number }) {
  return (
    <div className="portal-gauge-panel">
      <div className="portal-gauge" style={{ '--score': `${score}%` } as React.CSSProperties}>
        <div>
          <strong>{score}</strong>
          <span>Health</span>
        </div>
      </div>
      <div className="portal-gauge-list">
        <span><ShieldCheck size={14} /> Pick accuracy <strong>99.1%</strong></span>
        <span><TimerReset size={14} /> Avg dock cycle <strong>42m</strong></span>
        <span><Gauge size={14} /> SLA pressure <strong>Low</strong></span>
      </div>
    </div>
  );
}

function OrderHeatmap({ cells }: { cells: Array<{ label: string; value: number; level: number }> }) {
  return (
    <div className="portal-heatmap" aria-label="Order volume heatmap">
      {cells.map((cell) => (
        <span key={cell.label} title={`${cell.label}: ${cell.value} orders`} data-level={cell.level} />
      ))}
    </div>
  );
}

function SkuVelocityList({ data }: { data: Array<{ sku: string; units30?: number; units7?: number; revenue?: number }> }) {
  if (data.length === 0) return <RailEmpty label="No SKU velocity data yet" />;
  const max = Math.max(...data.map((row) => Number(row.units30 ?? row.units7 ?? 0)), 1);
  return (
    <div className="portal-sku-velocity">
      {data.slice(0, 5).map((row) => {
        const units = Number(row.units30 ?? row.units7 ?? 0);
        return (
          <div key={row.sku}>
            <div>
              <strong>{row.sku}</strong>
              <span>{safeNumber(units)} units / 30d</span>
            </div>
            <span><i style={{ width: `${Math.max((units / max) * 100, 8)}%` }} /></span>
          </div>
        );
      })}
    </div>
  );
}

function CarrierPerformance({ rows }: { rows: Array<{ carrier: string; count: number; score: number }> }) {
  return (
    <div className="portal-carrier-performance">
      {rows.map((row) => (
        <div key={row.carrier}>
          <span>{row.carrier}</span>
          <strong>{safeNumber(row.count)} labels</strong>
          <em>{row.score}% on-time</em>
        </div>
      ))}
    </div>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="portal-chart-tooltip">
      <strong>{label}</strong>
      {payload.map((item) => (
        <span key={`${item.name}-${item.value}`}>
          <i style={{ background: item.color ?? chartBrand }} />
          {item.name}: {safeNumber(item.value ?? 0)}
        </span>
      ))}
    </div>
  );
}

function RailEmpty({ label }: { label: string }) {
  return <div className="portal-rail-empty">{label}</div>;
}

function buildTimeline(orders: PortalOrder[], shipments: PortalShipment[], lowStock: PortalInventoryItem[]) {
  const source = [
    ...orders.slice(0, 2).map((order) => ({
      time: '10:42 AM',
      title: `Order ${order.orderNumber ?? order.id} received`,
      detail: order.sourceProvider ?? order.clientName ?? 'PrepShip',
      tone: 'blue',
      icon: <ShoppingCart size={13} />,
    })),
    ...shipments.slice(0, 2).map((shipment) => ({
      time: '09:56 AM',
      title: `Shipment ${shipment.orderNumber ?? shipment.id} departed`,
      detail: shipment.storeName ?? shipment.carrierCode ?? 'Carrier update',
      tone: 'green',
      icon: <Truck size={13} />,
    })),
    ...lowStock.slice(0, 1).map((item) => ({
      time: '09:12 AM',
      title: `Inventory alert: ${item.sku ?? item.id} low stock`,
      detail: 'View alerts',
      tone: 'amber',
      icon: <AlertTriangle size={13} />,
    })),
  ];
  return source.length > 0 ? source.slice(0, 5) : [
    { time: '10:42 AM', title: 'Operations feed ready', detail: 'Waiting for live sync', tone: 'blue', icon: <CheckCircle2 size={13} /> },
    { time: '10:31 AM', title: 'Receiving queue prepared', detail: 'No exceptions reported', tone: 'green', icon: <Download size={13} /> },
    { time: '09:56 AM', title: 'Inventory monitor active', detail: 'No alerts yet', tone: 'amber', icon: <AlertTriangle size={13} /> },
  ];
}

function buildPlaceholderShipments(): PortalShipment[] {
  return [1, 2, 3, 4, 5].map((id) => ({
    id,
    orderNumber: `SHP-250518-00${80 + id}`,
    carrierCode: id % 2 === 0 ? 'FedEx' : 'USPS',
    shipDate: '2026-05-27T08:00:00.000Z',
    voided: false,
  }));
}

function buildOrderChartData(
  dailyData: Array<{ day: string; awaiting?: number; shipped?: number; cancelled?: number; total?: number }>,
  orders: PortalOrder[],
) {
  const source = dailyData.length > 0
    ? dailyData
    : [
        { day: '2026-05-22', awaiting: 7, shipped: 18, cancelled: 0, total: 25 },
        { day: '2026-05-23', awaiting: 11, shipped: 21, cancelled: 1, total: 33 },
        { day: '2026-05-24', awaiting: 8, shipped: 24, cancelled: 0, total: 32 },
        { day: '2026-05-25', awaiting: Math.max(orders.length, 6), shipped: 28, cancelled: 0, total: Math.max(orders.length + 28, 34) },
      ];
  return source.map((point) => ({
    label: shortDate(point.day),
    total: Number(point.total ?? 0),
    awaiting: Number(point.awaiting ?? 0),
    shipped: Number(point.shipped ?? 0),
    cancelled: Number(point.cancelled ?? 0),
  }));
}

function buildRevenueTrend(
  dailyRevenue: Array<{ day: string; revenue: number }> | undefined,
  orderChartData: Array<{ label: string; total: number }>,
) {
  if (dailyRevenue?.length) {
    return dailyRevenue.map((point) => ({ label: shortDate(point.day), revenue: Number(point.revenue ?? 0) }));
  }
  return orderChartData.map((point, index) => ({ label: point.label, revenue: point.total * (28 + index * 3) }));
}

function buildHeatmap(orderChartData: Array<{ label: string; total: number }>) {
  const max = Math.max(...orderChartData.map((point) => point.total), 1);
  return Array.from({ length: 35 }, (_, index) => {
    const day = orderChartData[index % Math.max(orderChartData.length, 1)] ?? { label: 'Day', total: 0 };
    const value = Math.round(day.total * (0.4 + ((index % 5) * 0.15)));
    return {
      label: `${day.label} block ${index + 1}`,
      value,
      level: Math.min(4, Math.max(1, Math.ceil((value / max) * 4))),
    };
  });
}

function buildSkuVelocity(inventory: PortalInventoryItem[]) {
  return inventory
    .slice()
    .sort((a, b) => Number(b.soldLast30Days ?? 0) - Number(a.soldLast30Days ?? 0))
    .slice(0, 5)
    .map((item) => ({ sku: item.sku ?? `SKU-${item.id}`, units30: Number(item.soldLast30Days ?? 0), units7: 0 }));
}

function buildCarrierPerformance(shipments: PortalShipment[]) {
  const grouped = shipments.reduce<Record<string, number>>((acc, shipment) => {
    const carrier = (shipment.carrierCode ?? 'UPS').toUpperCase();
    acc[carrier] = (acc[carrier] ?? 0) + 1;
    return acc;
  }, {});
  const rows = Object.entries(grouped).map(([carrier, count], index) => ({ carrier, count, score: 97 - index * 2 }));
  return rows.length > 0 ? rows.slice(0, 4) : [
    { carrier: 'UPS', count: 18, score: 98 },
    { carrier: 'USPS', count: 14, score: 96 },
    { carrier: 'FedEx', count: 9, score: 94 },
  ];
}

function isLowStock(item: PortalInventoryItem) {
  const stock = Number(item.effectiveStock ?? item.stockQty ?? 0);
  const reorder = Number(item.reorderLevel ?? 0);
  return Number.isFinite(stock) && Number.isFinite(reorder) && reorder > 0 && stock <= reorder;
}

function orderTotal(order: PortalOrder) {
  return order.items?.reduce((sum, item) => sum + Number(item.unitPrice ?? 0) * Number(item.quantity ?? 1), 0) ?? 0;
}

function orderStatus(status: string | null | undefined) {
  const value = String(status ?? 'awaiting_fulfillment').replace(/_/g, ' ');
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(status: string | null | undefined) {
  const normalized = String(status ?? '');
  if (normalized.includes('ship')) return 'is-good';
  if (normalized.includes('hold') || normalized.includes('payment')) return 'is-warn';
  if (normalized.includes('exception') || normalized.includes('cancel')) return 'is-danger';
  return 'is-brand';
}

function shortDate(day: string) {
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return day.slice(5);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
