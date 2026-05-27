import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  MoreHorizontal,
  Package,
  Plus,
  Settings,
  ShoppingCart,
  Truck,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
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
  { label: 'Awaiting Payment', key: 'awaiting_payment' },
  { label: 'Awaiting Fulfillment', key: 'awaiting_shipment' },
  { label: 'On Hold', key: 'hold' },
  { label: 'Exceptions', key: 'exception' },
] as const;

export default function Overview() {
  const auth = useAuth();
  const dashboard = useDashboardQuery(auth.accessToken);
  const dailyCounts = useDailyCountsQuery(auth.accessToken);
  const orders = useOrdersQuery(auth.accessToken);
  const inventory = useInventoryQuery(auth.accessToken);
  const shipments = useShipmentsQuery(auth.accessToken);
  const queries = [dashboard, dailyCounts, orders, inventory, shipments];
  const hasLoadIssue = queries.some((query) => query.error);

  const allOrders = orders.data?.data ?? [];
  const allInventory = inventory.data?.data ?? [];
  const allShipments = shipments.data?.data ?? [];
  const latest = dailyCounts.data?.data.at(-1);
  const openOrders = latest?.awaiting ?? allOrders.filter((order) => order.orderStatus === 'awaiting_shipment').length;
  const inTransit = allShipments.filter((shipment) => !shipment.voided).length;
  const lowStockItems = allInventory.filter(isLowStock);
  const visibleOrders = allOrders.filter((order) => order.orderStatus !== 'cancelled').slice(0, 6);
  const selectedOrderId = visibleOrders[1]?.id ?? visibleOrders[0]?.id;

  return (
    <div className="portal-page portal-dashboard-page">
      <div className="portal-ops-hero">
        <div>
          <div className="mb-1 text-[12px] text-ink-3">Workspace · Operations · <strong className="text-ink">Overview</strong></div>
          <h1>Overview</h1>
          <div className="portal-ops-filters mt-2">
            <button type="button"><CalendarDays size={13} /> May 12 – May 18, 2025</button>
            <button type="button">All Stores</button>
            <span>Updated 2m ago</span>
          </div>
        </div>
        <div className="portal-ops-actions">
          <button type="button" className="portal-ops-secondary"><Settings size={14} /> Customize</button>
          <button type="button" className="portal-ops-primary"><Plus size={14} /> New task</button>
        </div>
      </div>

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

      <div className="portal-dashboard-grid">
        <div className="portal-dashboard-main">
          <section className="portal-kpis portal-dashboard-kpis">
            <KpiCard
              icon={<ShoppingCart size={24} />}
              label="Open Orders"
              value={safeNumber(openOrders)}
              meta="+18% vs May 5 - May 11"
              to="/dashboard/orders"
              action="View Orders"
              tone="blue"
            />
            <KpiCard
              icon={<Download size={24} />}
              label="Inbound Receiving"
              value={safeNumber(lowStockItems.length)}
              meta={`${safeNumber(Math.min(lowStockItems.length, 3))} In Transit  -  ${safeNumber(Math.max(lowStockItems.length - 3, 0))} At Dock`}
              to="/dashboard/inbound"
              action="View Inbound"
              tone="green"
            />
            <KpiCard
              icon={<AlertTriangle size={24} />}
              label="Inventory Alerts"
              value={safeNumber(lowStockItems.length)}
              meta={`${safeNumber(lowStockItems.length)} Low Stock  -  0 Out of Stock`}
              to="/dashboard/inventory"
              action="View Inventory"
              tone="amber"
            />
            <KpiCard
              icon={<Truck size={24} />}
              label="Shipments In Transit"
              value={safeNumber(inTransit)}
              meta="+12% vs May 5 - May 11"
              to="/dashboard/shipments"
              action="View Shipments"
              tone="blue"
            />
          </section>

          <section className="portal-command-panel portal-open-orders-panel">
            <div className="portal-command-panel-head">
              <div className="portal-heading-inline">
                <h2>Open Orders</h2>
                <span>{safeNumber(openOrders || visibleOrders.length)}</span>
              </div>
              <div className="portal-panel-actions">
                <button type="button">Export</button>
                <button type="button" aria-label="More order actions"><MoreHorizontal size={18} /></button>
              </div>
            </div>
            <div className="portal-order-tabs" role="tablist" aria-label="Open order filters">
              {orderTabs.map((tab, index) => (
                <button key={tab.key} type="button" className={index === 0 ? 'active' : ''}>
                  {tab.label}
                  <span>{tab.key === 'all' ? safeNumber(openOrders || visibleOrders.length) : tab.key === 'awaiting_shipment' ? safeNumber(openOrders) : '0'}</span>
                </button>
              ))}
            </div>
            <div className="portal-reference-table-wrap">
              <table className="portal-reference-table">
                <thead>
                  <tr>
                    <th><input type="checkbox" aria-label="Select all open orders" /></th>
                    <th>Order #</th>
                    <th>Store</th>
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
                  {visibleOrders.length > 0 ? (
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
              <span>{visibleOrders.length > 0 ? '1 row selected' : 'No rows selected'}</span>
              <div>
                <span>Rows per page</span>
                <button type="button">25</button>
                <strong>1 - {Math.max(visibleOrders.length, 1)} of {safeNumber(openOrders || visibleOrders.length)}</strong>
                <button type="button" className="active">1</button>
                <button type="button">2</button>
                <button type="button">3</button>
              </div>
            </div>
          </section>

          <section className="portal-command-panel portal-shipment-strip">
            <div className="portal-command-panel-head">
              <div className="portal-heading-inline">
                <h2>Shipment Tracking Overview</h2>
                <span>{safeNumber(inTransit)} In Transit</span>
                <span>{safeNumber(Math.max(inTransit - 1, 0))} Out for Delivery</span>
                <span className="warn">0 Delayed</span>
                <span className="danger">0 Exception</span>
              </div>
              <Link to="/dashboard/shipments" className="portal-link">View All Shipments</Link>
            </div>
            <div className="portal-tracking-cards">
              {(allShipments.length > 0 ? allShipments : buildPlaceholderShipments()).slice(0, 5).map((shipment, index) => (
                <ShipmentCard key={`${shipment.id}-${index}`} shipment={shipment} delayed={index === 3} />
              ))}
            </div>
          </section>
        </div>

        <aside className="portal-dashboard-rail" aria-label="Operations side rail">
          <RailPanel title="Operational Timeline" action="View All">
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

          <RailPanel title="Inbound Receiving Queue" action="View All">
            <div className="portal-queue-list">
              {(lowStockItems.length > 0 ? lowStockItems : allInventory.slice(0, 4)).slice(0, 4).map((item, index) => (
                <QueueItem key={item.id} item={item} state={index < 2 ? 'At Dock' : index === 2 ? 'In Transit' : 'Tomorrow'} />
              ))}
              {allInventory.length === 0 ? <RailEmpty label="No receiving items yet" /> : null}
            </div>
          </RailPanel>

          <RailPanel title="Inventory Low Stock Alerts" action="View All">
            <div className="portal-lowstock-list">
              {(lowStockItems.length > 0 ? lowStockItems : allInventory.slice(0, 3)).slice(0, 3).map((item) => (
                <LowStockItem key={item.id} item={item} />
              ))}
              {allInventory.length === 0 ? <RailEmpty label="No low stock alerts" /> : null}
            </div>
            <Link to="/dashboard/inventory" className="portal-rail-footer-link">See all {safeNumber(lowStockItems.length)} alerts <ArrowRight size={14} /></Link>
          </RailPanel>
        </aside>
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  meta,
  to,
  action,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  meta: string;
  to: string;
  action: string;
  tone: 'blue' | 'green' | 'amber';
}) {
  return (
    <article className={`portal-kpi portal-reference-kpi portal-kpi-${tone}`}>
      <div className="portal-kpi-icon">{icon}</div>
      <div className="portal-kpi-body">
        <div className="portal-kpi-label">{label}</div>
        <div className="portal-kpi-value">{value}</div>
        <div className="portal-kpi-hint">{meta}</div>
      </div>
      <Link to={to} className="portal-kpi-action">{action} <ArrowRight size={15} /></Link>
    </article>
  );
}

function OrderRow({ order, selected }: { order: PortalOrder; selected: boolean }) {
  const itemCount = order.items?.reduce((sum, item) => sum + Number(item.quantity ?? 1), 0) ?? 0;
  return (
    <tr data-selected={selected ? 'true' : 'false'}>
      <td><input type="checkbox" aria-label={`Select order ${order.orderNumber ?? order.id}`} checked={selected} readOnly /></td>
      <td><Link to="/dashboard/orders">{order.orderNumber ?? order.externalOrderId ?? `PS-${order.id}`}</Link></td>
      <td><StoreMark label={order.sourceProvider ?? order.clientName ?? 'PrepShip'} /></td>
      <td><strong>{safeDate(order.orderDate)}</strong></td>
      <td>{order.shipToName ?? 'Customer'}</td>
      <td>{safeMoney(orderTotal(order))}</td>
      <td><span className="portal-status-pill">{orderStatus(order.orderStatus)}</span></td>
      <td><CarrierMark carrier={order.label?.carrierCode ?? order.carrierCode} /></td>
      <td>{safeNumber(itemCount)}</td>
      <td><button type="button" aria-label="Order row actions"><MoreHorizontal size={17} /></button></td>
    </tr>
  );
}

function RailPanel({ title, action, children }: { title: string; action: string; children: ReactNode }) {
  return (
    <section className="portal-rail-panel">
      <div className="portal-rail-panel-head">
        <h2>{title}</h2>
        <button type="button">{action}</button>
      </div>
      {children}
    </section>
  );
}

function StoreMark({ label }: { label: string }) {
  const normalized = label.toLowerCase();
  const mark = normalized.includes('shopify') ? 'S' : normalized.includes('amazon') ? 'a' : normalized.includes('walmart') ? '*' : normalized.includes('tiktok') ? 'T' : label.slice(0, 1);
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
    <article className={`portal-tracking-card ${delayed ? 'delayed' : ''}`}>
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
    </article>
  );
}

function QueueItem({ item, state }: { item: PortalInventoryItem; state: string }) {
  return (
    <div className="portal-queue-item">
      <span className="portal-cube-icon"><Package size={14} /></span>
      <div>
        <strong>{item.sku ?? `PO-${item.id}`}</strong>
        <small>{safeNumber(item.stockQty ?? item.effectiveStock)} SKUs - {safeNumber(item.soldLast30Days ?? 0)} Units</small>
      </div>
      <span>{state}</span>
    </div>
  );
}

function LowStockItem({ item }: { item: PortalInventoryItem }) {
  const stock = Number(item.effectiveStock ?? item.stockQty ?? 0);
  return (
    <div className="portal-lowstock-item">
      <ProductThumb item={item} />
      <div>
        <strong>{item.sku ?? `SKU-${item.id}`}</strong>
        <small>{item.name ?? 'Inventory item'}</small>
      </div>
      <span>{safeNumber(stock)}<small>In Stock</small></span>
    </div>
  );
}

function ProductThumb({ item }: { item: PortalInventoryItem }) {
  return (
    <span className="portal-product-thumb">
      {item.imageUrl ? <img src={item.imageUrl} alt={item.name ?? item.sku ?? 'Inventory item'} loading="lazy" /> : <Package size={16} />}
    </span>
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
