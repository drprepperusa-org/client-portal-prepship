import { useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { motion } from 'framer-motion';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { SiFedex, SiUps, SiUsps } from 'react-icons/si';
import { EmptyState, ErrorPanel, PageHeader, Panel, RefreshButton } from '../components/PortalPrimitives';
import { StoreSelectorDropdown, storeNameForClient } from '../components/StoreScopeControls';
import { Table } from '../components/ui/Table';
import { safeDate, safeMoney } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useClientsQuery, useInventoryQuery, useOrdersQuery, useShipmentsQuery } from '../lib/portalQueries';
import type { OrderItem, OrderStatus, PortalClient, PortalInventoryItem, PortalOrder, PortalShipment } from '../types/portal';

const orderTabs: Array<{ value: OrderStatus; label: string; empty: string }> = [
  { value: 'awaiting_shipment', label: 'Awaiting shipment', empty: 'Awaiting shipment orders will appear here after they sync into PrepShip.' },
  { value: 'shipped', label: 'Shipped', empty: 'Shipped orders will appear here after fulfillment.' },
  { value: 'cancelled', label: 'Cancelled', empty: 'Cancelled orders will appear here when available in your scoped account.' },
];

const CARRIER_NAMES: Record<string, string> = {
  stamps_com: 'USPS',
  usps: 'USPS',
  ups: 'UPS',
  ups_walleted: 'UPS',
  fedex: 'FedEx',
  fedex_walleted: 'FedEx',
  dhl_express: 'DHL',
  asendia_us: 'Asendia',
  ontrac: 'OnTrac',
  lasership: 'LaserShip',
  amazon_swa: 'Amazon',
  globegistics: 'Globegistics',
};

const SERVICE_NAMES: Record<string, string> = {
  usps_priority_mail: 'Priority Mail',
  usps_priority_mail_express: 'Priority Express',
  usps_first_class_mail: 'First Class',
  usps_ground_advantage: 'Ground Advantage',
  ground_advantage: 'Ground Advantage',
  usps_media_mail: 'Media Mail',
  media_mail: 'Media Mail',
  usps_library_mail: 'Library Mail',
  usps_parcel_select: 'Parcel Select',
  ups_ground: 'UPS Ground',
  ups_ground_saver: 'UPS Ground Saver',
  ups_surepost: 'UPS Ground Saver',
  ups_surepost_1_lb_or_greater: 'UPS Ground Saver (1 lb+)',
  ups_surepost_less_than_1_lb: 'UPS Ground Saver (<1 lb)',
  ups_3_day_select: 'UPS 3 Day Select',
  ups_2nd_day_air: 'UPS 2nd Day Air',
  ups_2nd_day_air_am: 'UPS 2nd Day Air AM',
  ups_next_day_air_saver: 'UPS Next Day Air Saver',
  ups_next_day_air: 'UPS Next Day Air',
  ups_next_day_air_early_am: 'UPS Next Day Air Early AM',
  fedex_ground: 'FedEx Ground',
  fedex_home_delivery: 'FedEx Home Delivery',
  fedex_2day: 'FedEx 2Day',
  fedex_2_day: 'FedEx 2Day',
  fedex_2day_am: 'FedEx 2Day AM',
  fedex_express_saver: 'FedEx Express Saver',
  fedex_priority_overnight: 'FedEx Priority Overnight',
  fedex_standard_overnight: 'FedEx Standard Overnight',
  fedex_first_overnight: 'FedEx First Overnight',
};

function clientRows(value: unknown): PortalClient[] {
  if (Array.isArray(value)) return value as PortalClient[];
  if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) {
    return (value as { data: PortalClient[] }).data;
  }
  return [];
}

export default function Orders() {
  const auth = useAuth();
  const [activeStatus, setActiveStatus] = useState<OrderStatus>('awaiting_shipment');
  const [activeClientId, setActiveClientId] = useState<number | 'all'>('all');
  const [search, setSearch] = useState('');
  const [storeSearch, setStoreSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<PortalOrder | null>(null);
  const orders = useOrdersQuery(auth.accessToken, activeStatus);
  const clients = useClientsQuery(auth.accessToken);
  const inventory = useInventoryQuery(auth.accessToken);
  const shipments = useShipmentsQuery(auth.accessToken);
  const isFirstLoad = orders.isLoading && !orders.data;
  const activeTab = useMemo(() => orderTabs.find((tab) => tab.value === activeStatus) ?? orderTabs[0]!, [activeStatus]);
  const rows = orders.data?.data ?? [];
  const storeBuckets = useMemo(() => {
    const names = new Map<number, string>();
    const rowCounts = new Map<number, number>();
    for (const order of rows) {
      const clientId = orderClientId(order);
      if (clientId == null) continue;
      names.set(clientId, storeNameForClient(clientRows(clients.data), clientId, orderClientName(order)));
      rowCounts.set(clientId, (rowCounts.get(clientId) ?? 0) + 1);
    }
    const totals = orders.data?.pagination?.clientTotals ?? [];
    const ids = new Set<number>([...names.keys(), ...totals.map((row) => row.clientId)]);
    return [...ids]
      .map((clientId) => ({
        clientId,
        name: names.get(clientId) ?? `Client ${clientId}`,
        count: totals.find((row) => row.clientId === clientId)?.total ?? rowCounts.get(clientId) ?? 0,
      }))
      .filter((bucket) => bucket.count > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clients.data, orders.data?.pagination?.clientTotals, rows]);
  const filteredRows = useMemo(
    () => {
      const query = search.trim().toLowerCase();
      return rows.filter((order) => {
        const clientId = orderClientId(order);
        if (activeClientId !== 'all' && clientId !== activeClientId) return false;
        if (!query) return true;
        const storeName = storeNameForClient(clientRows(clients.data), clientId, orderClientName(order));
        return [
          storeName,
          order.orderNumber,
          order.externalOrderId,
          order.shipToName,
          order.items?.[0]?.sku,
          order.items?.[0]?.name,
          order.carrierCode,
        ].filter(Boolean).join(' ').toLowerCase().includes(query);
      });
    },
    [activeClientId, clients.data, rows, search],
  );
  const visibleTotal = activeClientId === 'all'
    ? orders.data?.pagination?.total ?? rows.length
    : storeBuckets.find((bucket) => bucket.clientId === activeClientId)?.count ?? filteredRows.length;
  const inventoryImages = useMemo(() => {
    const map = new Map<string, PortalInventoryItem>();
    for (const item of inventory.data?.data ?? []) {
      if (item.sku) map.set(item.sku.toLowerCase(), item);
    }
    return map;
  }, [inventory.data]);
  const selectedShipment = useMemo(
    () => (selectedOrder ? shipmentForOrder(selectedOrder, shipments.data?.data ?? []) : null),
    [selectedOrder, shipments.data],
  );

  function itemImage(item: OrderItem | null | undefined) {
    if (!item) return null;
    return item.imageUrl ?? item.image_url ?? item.thumbnailUrl ?? item.productImageUrl ?? null;
  }

  function primaryItem(order: PortalOrder) {
    return order.items?.find((item) => item?.sku || item?.name) ?? order.items?.[0] ?? null;
  }

  function orderImageUrl(order: PortalOrder) {
    const item = primaryItem(order);
    const direct = itemImage(item);
    if (direct) return direct;
    const sku = item?.sku?.toLowerCase();
    return sku ? inventoryImages.get(sku)?.imageUrl ?? null : null;
  }

  function lineItemImage(item: OrderItem) {
    const direct = itemImage(item);
    if (direct) return direct;
    const sku = item.sku?.toLowerCase();
    return sku ? inventoryImages.get(sku)?.imageUrl ?? null : null;
  }

  function orderInitial(order: PortalOrder) {
    const item = primaryItem(order);
    return (item?.sku ?? item?.name ?? order.orderNumber ?? 'O').slice(0, 2).toUpperCase();
  }

  function openOrder(order: PortalOrder) {
    setSelectedOrder(order);
  }

  const orderColumns = useMemo<ColumnDef<PortalOrder>[]>(
    () => [
      {
        id: 'select',
        header: '',
        size: 42,
        minSize: 42,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`Select order ${orderNumber(row.original)}`}
            className="h-4 w-4 rounded border-line text-brand focus:ring-brand/30"
            onClick={(event) => event.stopPropagation()}
          />
        ),
      },
      {
        id: 'orderDate',
        header: 'Order date',
        size: 116,
        minSize: 104,
        accessorFn: (order) => order.orderDate ?? '',
        cell: ({ row }) => <span className="portal-order-date-cell">{formatOrderDateTime(row.original.orderDate)}</span>,
      },
      {
        id: 'client',
        header: 'Client',
        size: 126,
        minSize: 112,
        accessorFn: (order) => storeNameForClient(clientRows(clients.data), orderClientId(order), orderClientName(order)),
        cell: ({ row }) => (
          <ClientPill label={storeNameForClient(clientRows(clients.data), orderClientId(row.original), orderClientName(row.original))} />
        ),
      },
      {
        id: 'orderNumber',
        header: 'Order #',
        size: 128,
        minSize: 116,
        accessorFn: (order) => order.orderNumber ?? order.externalOrderId ?? String(order.id),
        cell: ({ row }) => {
          const order = row.original;
          return (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                openOrder(order);
              }}
              className="portal-order-link"
            >
              {orderNumber(order)}
            </button>
          );
        },
      },
      {
        id: 'itemName',
        header: 'Item name',
        size: 258,
        minSize: 220,
        accessorFn: (order) => order.items?.map((item) => item.name ?? item.sku).filter(Boolean).join(' ') ?? '',
        cell: ({ row }) => {
          const order = row.original;
          const items = orderLineItems(order);
          return <OrderItemStack items={items} imageForItem={lineItemImage} />;
        },
      },
      {
        id: 'sku',
        header: 'SKU',
        size: 150,
        minSize: 128,
        accessorFn: (order) => order.items?.map((item) => item.sku).filter(Boolean).join(' ') ?? '',
        cell: ({ row }) => <SkuStack items={orderLineItems(row.original)} />,
      },
      {
        id: 'qty',
        header: 'Qty',
        size: 76,
        minSize: 70,
        accessorFn: (order) => orderQty(order),
        cell: ({ row }) => {
          const qty = orderQty(row.original);
          return <span className={qty > 1 ? 'portal-order-qty is-multi' : 'portal-order-qty'}>{qty}</span>;
        },
      },
      {
        id: 'orderTotal',
        header: 'Order total',
        size: 122,
        minSize: 112,
        accessorFn: (order) => orderTotalValue(order) ?? 0,
        cell: ({ row }) => {
          const total = orderTotalValue(row.original);
          return <span className="portal-order-money">{total == null ? '-' : safeMoney(total)}</span>;
        },
      },
      {
        id: 'weight',
        header: 'Weight',
        size: 106,
        minSize: 96,
        accessorFn: (order) => orderWeightOz(order) ?? 0,
        cell: ({ row }) => {
          const weight = orderWeightOz(row.original);
          return weight == null ? <MutedAction label="add dims" /> : <span className="portal-order-muted-value">{formatWeight(weight)}</span>;
        },
      },
      {
        id: 'shippingAccount',
        header: 'Shipping account',
        size: 164,
        minSize: 142,
        accessorFn: (order) => shippingAccountName(order),
        cell: ({ row }) => <ShippingAccountCell order={row.original} />,
      },
      {
        id: 'carrier',
        header: 'Carrier',
        size: 84,
        minSize: 76,
        accessorFn: (order) => carrierCode(order),
        cell: ({ row }) => <CarrierLogo carrier={carrierCode(row.original)} />,
      },
      {
        id: 'bestRate',
        header: 'Best rate',
        size: 104,
        minSize: 92,
        accessorFn: (order) => bestRateAmount(order) ?? 0,
        cell: ({ row }) => {
          const rate = bestRateAmount(row.original);
          return rate == null ? <MutedAction label="add dims" /> : <span className="portal-order-rate">{safeMoney(rate)}</span>;
        },
      },
    ],
    [clients.data, inventoryImages],
  );

  useEffect(() => {
    if (activeClientId !== 'all' && !storeBuckets.some((bucket) => bucket.clientId === activeClientId)) {
      setActiveClientId('all');
    }
  }, [activeClientId, storeBuckets]);

  return (
    <div className="portal-client-indicators-page">
      <PageHeader
        title="Orders"
        subtitle="View synced orders by date, client, items, shipping account, carrier, and best rate."
        action={<RefreshButton loading={orders.isFetching} onClick={() => void orders.refetch()} />}
      />
      {orders.error ? (
        <ErrorPanel
          message={orders.error instanceof Error ? orders.error.message : String(orders.error)}
          loading={orders.isFetching}
          onRetry={() => void orders.refetch()}
        />
      ) : null}
      <Panel
        title="Order activity"
        right={<span className="text-xs font-bold text-ink-3">{visibleTotal} orders</span>}
      >
        <div className="flex flex-col gap-4 border-b border-line bg-surface-2 p-4 sm:flex-row sm:items-center sm:justify-between">
          <StoreSelectorDropdown
            clients={clientRows(clients.data)}
            value={activeClientId}
            onChange={setActiveClientId}
            search={storeSearch}
            onSearchChange={setStoreSearch}
            label="Workspace"
          />
          <div className="flex items-center gap-6">
            <div className="h-10 w-[120px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={[{v: 12},{v: 19},{v: 15},{v: 22},{v: 18},{v: 28},{v: 24}]}>
                  <defs>
                    <linearGradient id="orderTrend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="rgb(var(--brand-rgb))" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="rgb(var(--brand-rgb))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="v" stroke="rgb(var(--brand-rgb))" fillOpacity={1} fill="url(#orderTrend)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-black uppercase tracking-widest text-ink-3">Total Orders</div>
              <div className="text-lg font-black text-ink">{visibleTotal}</div>
            </div>
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto border-b border-line px-4 pt-4 pb-0" role="tablist" aria-label="Order status">
          {orderTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={activeStatus === tab.value}
              className={`relative h-10 px-4 text-[13px] font-black transition-colors focus-visible:outline-none ${activeStatus === tab.value ? 'text-brand' : 'text-ink-2 hover:text-ink'}`}
              onClick={() => setActiveStatus(tab.value)}
            >
              {activeStatus === tab.value && (
                <motion.div
                  layoutId="orderTabActive"
                  className="absolute inset-0 rounded-t-lg bg-brand/10 border-b-2 border-brand"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <span className="relative z-10">{tab.label}</span>
            </button>
          ))}
        </div>
        <div className="p-4">
          <Table
            tableId={`orders-ledger-${activeStatus}`}
            data={filteredRows}
            columns={orderColumns}
            loading={isFirstLoad}
            skeletonRows={6}
            defaultPageSize={25}
            pageSizeOptions={[10, 25, 50, 100]}
            onRowClick={openOrder}
            emptyMessage={`No ${activeTab.label.toLowerCase()} orders found`}
            className="portal-orders-ledger-table"
            showColumnControls
          />
        </div>
        {!orders.isLoading && filteredRows.length === 0 ? <EmptyState title={`No ${activeTab.label.toLowerCase()} orders found`} body={activeTab.empty} /> : null}
      </Panel>
      <OrderDetailDrawer
        order={selectedOrder}
        imageUrl={selectedOrder ? orderImageUrl(selectedOrder) : null}
        fallback={selectedOrder ? orderInitial(selectedOrder) : 'O'}
        imageForItem={lineItemImage}
        shipment={selectedShipment}
        onClose={() => setSelectedOrder(null)}
      />
    </div>
  );
}

function orderClientId(order: PortalOrder) {
  const value = Number(order.clientId ?? order.client_id);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function orderClientName(order: PortalOrder) {
  return order.clientName ?? order.client_name ?? order.storeName ?? 'Client';
}

function shipmentForOrder(order: PortalOrder, shipments: PortalShipment[]) {
  const orderKeys = [orderNumber(order), order.externalOrderId]
    .map((value) => String(value ?? '').trim().toLowerCase())
    .filter(Boolean);
  return shipments.find((shipment) => {
    if (shipment.orderId != null && Number(shipment.orderId) === Number(order.id)) return true;
    const shipmentOrderNumber = String(shipment.orderNumber ?? '').trim().toLowerCase();
    return orderKeys.includes(shipmentOrderNumber);
  }) ?? null;
}

function orderNumber(order: PortalOrder) {
  return order.orderNumber ?? order.externalOrderId ?? String(order.id);
}

function orderLineItems(order: PortalOrder) {
  return (order.items ?? []).filter((item) => item && (item.name || item.sku));
}

function orderQty(order: PortalOrder) {
  const qty = orderLineItems(order).reduce((sum, item) => sum + (readNumber(item.quantity, 0) ?? 0), 0);
  return qty > 0 ? qty : 1;
}

function readNumber(value: unknown, fallback: number | null = null) {
  const amount = typeof value === 'number' ? value : Number(value ?? NaN);
  return Number.isFinite(amount) ? amount : fallback;
}

function orderTotalValue(order: PortalOrder) {
  const direct = readNumber(order.orderTotal ?? order.order_total ?? order.totalAmount ?? order.total_amount);
  if (direct != null) return direct;
  const itemTotal = orderLineItems(order).reduce((sum, item) => {
    const unit = readNumber(item.unitPrice ?? item.unit_price, null);
    const qty = readNumber(item.quantity, 1) ?? 1;
    return unit == null ? sum : sum + unit * qty;
  }, 0);
  return itemTotal > 0 ? itemTotal : null;
}

function orderWeightOz(order: PortalOrder) {
  const direct = readNumber(order.weightOz ?? order.weight_oz ?? order.rateWeightOz ?? order.rate_weight_oz ?? order.label?.weightOz);
  if (direct != null && direct > 0) return direct;
  const itemWeight = orderLineItems(order).reduce((sum, item) => {
    const weight = readNumber(item.weightOz ?? item.weight_oz, 0) ?? 0;
    const qty = readNumber(item.quantity, 1) ?? 1;
    return sum + weight * qty;
  }, 0);
  return itemWeight > 0 ? itemWeight : null;
}

function formatWeight(ounces: number) {
  const pounds = Math.floor(ounces / 16);
  const oz = Number((ounces % 16).toFixed(1));
  if (pounds <= 0) return `${oz} oz`;
  if (oz <= 0) return `${pounds} lb`;
  return `${pounds} lb ${oz} oz`;
}

function rateRecord(order: PortalOrder) {
  return order.selectedRateJson ?? order.selected_rate_json ?? order.bestRateJson ?? order.best_rate_json ?? null;
}

function stringFromRecord(record: Record<string, unknown> | null, keys: string[]) {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function numberFromRecord(record: Record<string, unknown> | null, keys: string[]) {
  if (!record) return null;
  for (const key of keys) {
    const amount = readNumber(record[key]);
    if (amount != null) return amount;
  }
  return null;
}

function normalizeShippingAccountName(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const label = String(value).trim();
  return label ? label : null;
}

function formatCarrierCode(value: string | null | undefined) {
  if (!value) return '';
  const key = value.trim().toLowerCase();
  return CARRIER_NAMES[key] ?? value.replace(/^custom_?/i, '').replace(/_/g, ' ').toUpperCase();
}

function formatServiceCode(value: string | null | undefined) {
  if (!value) return '';
  const clean = value.trim().replace(/®/g, '');
  if (!clean) return '';
  const key = clean.toLowerCase().replace(/\s+/g, '_');
  const mapped = SERVICE_NAMES[key];
  if (mapped) return mapped;
  return clean
    .replace(/^USPS\s+/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shippingAccountName(order: PortalOrder) {
  const record = rateRecord(order);
  return (
    normalizeShippingAccountName(stringFromRecord(record, ['providerAccountNickname', 'carrierNickname', 'carrier_nickname', 'accountNickname'])) ??
    normalizeShippingAccountName(order.shippingAccount) ??
    normalizeShippingAccountName(order.shipping_account) ??
    normalizeShippingAccountName(stringFromRecord(record, ['shippingAccount', 'accountName'])) ??
    formatCarrierCode(carrierCode(order))
  );
}

function serviceName(order: PortalOrder) {
  const record = rateRecord(order);
  return formatServiceCode(
    stringFromRecord(record, ['serviceCode', 'service_code']) ??
    order.label?.serviceCode ??
    order.serviceCode ??
    stringFromRecord(record, ['serviceName', 'service_name']) ??
    '',
  );
}

function carrierCode(order: PortalOrder) {
  const record = rateRecord(order);
  return (
    stringFromRecord(record, ['carrierCode', 'carrier_code', 'carrier']) ??
    order.label?.carrierCode ??
    order.carrierCode ??
    ''
  );
}

function bestRateAmount(order: PortalOrder) {
  const record = rateRecord(order);
  const rate = numberFromRecord(record, ['cost', 'rate', 'amount', 'shipmentCost', 'shipment_cost']);
  if (rate != null) return rate;
  return readNumber(order.label?.cost);
}

function formatOrderDateTime(value: string | null | undefined) {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function clientTone(label: string) {
  const tones = ['blue', 'green', 'amber', 'violet', 'slate'];
  const index = Math.abs([...label].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % tones.length;
  return tones[index]!;
}

function ClientPill({ label }: { label: string }) {
  return <span className={`portal-order-client-pill is-${clientTone(label)}`}>{label}</span>;
}

function OrderItemStack({ items, imageForItem }: { items: OrderItem[]; imageForItem: (item: OrderItem) => string | null }) {
  const visible = items.slice(0, 3);
  if (visible.length === 0) return <span className="portal-order-muted-value">No items</span>;
  return (
    <div className="portal-order-item-stack">
      {visible.map((item, index) => {
        const image = imageForItem(item);
        const label = item.name ?? item.sku ?? 'Unnamed item';
        return (
          <div key={`${item.sku ?? item.name ?? index}-${index}`} className="portal-order-item-line">
            <span className="portal-order-item-thumb">
              {image ? <img src={image} alt="" loading="lazy" /> : <span>{label.slice(0, 1).toUpperCase()}</span>}
            </span>
            <span className="portal-order-item-name">{label}</span>
            {readNumber(item.quantity, 1)! > 1 ? <span className="portal-order-line-count">x{readNumber(item.quantity, 1)}</span> : null}
          </div>
        );
      })}
      {items.length > visible.length ? <span className="portal-order-more-lines">+{items.length - visible.length} more</span> : null}
    </div>
  );
}

function SkuStack({ items }: { items: OrderItem[] }) {
  const visible = items.slice(0, 3);
  if (visible.length === 0) return <span className="portal-order-muted-value">-</span>;
  return (
    <div className="portal-order-sku-stack">
      {visible.map((item, index) => (
        <span key={`${item.sku ?? item.name ?? index}-${index}`}>{item.sku ?? '-'}</span>
      ))}
    </div>
  );
}

function MutedAction({ label }: { label: string }) {
  return <span className="portal-order-muted-action">- {label}</span>;
}

function ShippingAccountCell({ order }: { order: PortalOrder }) {
  const account = shippingAccountName(order);
  const service = serviceName(order);
  if (!account && !service) return <MutedAction label="add dims" />;
  return (
    <div className="portal-order-shipping-account">
      <strong>{account || carrierCode(order) || 'Carrier account'}</strong>
      {service ? <span>{service}</span> : null}
    </div>
  );
}

function CarrierLogo({ carrier }: { carrier: string }) {
  if (!carrier) return <MutedAction label="add dims" />;
  const normalized = carrier.toLowerCase();
  if (normalized.includes('ups')) {
    return <span className="portal-order-carrier-logo is-ups" aria-label="UPS"><SiUps aria-hidden="true" /></span>;
  }
  if (normalized.includes('fedex') || normalized.includes('fed_ex')) {
    return <span className="portal-order-carrier-logo is-fedex" aria-label="FedEx"><SiFedex aria-hidden="true" /></span>;
  }
  if (normalized.includes('usps') || normalized.includes('postal') || normalized.includes('stamps')) {
    return <span className="portal-order-carrier-logo is-usps" aria-label="USPS"><SiUsps aria-hidden="true" /></span>;
  }
  return <span className="portal-order-carrier-logo is-generic" aria-label={carrier}>{carrier.slice(0, 4).toUpperCase()}</span>;
}

function OrderThumb({ order, imageUrl, fallback }: { order: PortalOrder; imageUrl: string | null; fallback: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-white p-1 text-[11px] font-black text-brand ring-1 ring-line">
        {imageUrl ? (
          <img src={imageUrl} alt={primaryAlt(order)} className="absolute inset-1 h-[calc(100%-0.5rem)] w-[calc(100%-0.5rem)] object-contain" loading="lazy" />
        ) : (
          <span>{fallback}</span>
        )}
      </div>
    </div>
  );
}

function primaryAlt(order: PortalOrder) {
  const item = order.items?.[0];
  return item?.name ?? item?.sku ?? `Order ${order.orderNumber ?? order.id}`;
}

function OrderDetailDrawer({
  order,
  imageUrl,
  fallback,
  imageForItem,
  shipment,
  onClose,
}: {
  order: PortalOrder | null;
  imageUrl: string | null;
  fallback: string;
  imageForItem: (item: OrderItem) => string | null;
  shipment: PortalShipment | null;
  onClose: () => void;
}) {
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  useEffect(() => {
    setActiveImageIndex(0);
  }, [order?.id]);

  if (!order) return null;
  const items = order.items ?? [];
  const galleryItems = items.map((item, index) => ({
    key: `${item.sku ?? item.name ?? index}-${index}`,
    src: imageForItem(item),
    label: item.name ?? item.sku ?? `Item ${index + 1}`,
    fallback: (item.sku ?? item.name ?? 'IT').slice(0, 2).toUpperCase(),
  }));
  const gallery = galleryItems.length > 0 ? galleryItems : [{ key: 'order', src: imageUrl, label: primaryAlt(order), fallback }];
  const activeGalleryItem = gallery[Math.min(activeImageIndex, gallery.length - 1)] ?? gallery[0]!;
  const tracking = order.label?.trackingNumber ?? order.trackingNumber ?? order.labelTracking ?? shipment?.trackingNumber ?? shipment?.labelTracking ?? 'Not available';
  const carrier = order.label?.carrierCode ?? order.carrierCode ?? shipment?.carrierCode ?? 'Not assigned';
  const service = order.label?.serviceCode ?? order.serviceCode ?? shipment?.serviceCode ?? 'Not assigned';

  return (
    <div className="fixed inset-0 z-[90]">
      <button type="button" aria-label="Close order details" className="absolute inset-0 bg-[#142033]/35 backdrop-blur-sm" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[520px] flex-col overflow-hidden bg-surface shadow-[0_30px_90px_rgba(18,40,63,.24)] ring-1 ring-line animate-slideInRight">
        <div className="border-b border-line p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.12em] text-brand">Order details</div>
              <h2 className="mt-1 text-xl font-black text-ink">{order.orderNumber ?? order.externalOrderId ?? order.id}</h2>
              <p className="mt-1 text-xs font-semibold text-ink-2">{order.shipToName ?? 'Customer unavailable'} - {safeDate(order.orderDate)}</p>
            </div>
            <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl bg-surface-2 text-ink-2 ring-1 ring-line transition-colors hover:bg-brand-bg hover:text-brand">
              x
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="portal-order-detail-gallery mb-5">
            <div className="portal-order-detail-image-stage">
              {activeGalleryItem.src ? (
                <img src={activeGalleryItem.src} alt={activeGalleryItem.label} />
              ) : (
                <div className="portal-order-detail-image-fallback">{activeGalleryItem.fallback}</div>
              )}
            </div>
            {gallery.length > 1 ? (
              <div className="portal-order-detail-thumbs" aria-label="Order item images">
                {gallery.map((item, index) => (
                  <button
                    key={item.key}
                    type="button"
                    className={index === activeImageIndex ? 'is-active' : ''}
                    aria-label={`View ${item.label}`}
                    aria-pressed={index === activeImageIndex}
                    onClick={() => setActiveImageIndex(index)}
                  >
                    {item.src ? <img src={item.src} alt="" /> : <span>{item.fallback}</span>}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <DetailStat label="Status" value={String(order.orderStatus ?? 'Unknown').replace(/_/g, ' ')} />
            <DetailStat label="Source" value={order.sourceProvider ?? order.sourceStoreId ?? 'PrepShip'} />
            <DetailStat label="Carrier" value={carrier} />
            <DetailStat label="Service" value={service} />
            <DetailStat label="Tracking" value={tracking} wide />
            <DetailStat label="Ship to" value={[order.shipToCity, order.shipToState].filter(Boolean).join(', ') || 'No city/state'} wide />
          </div>

          <div className="mt-6 rounded-2xl bg-surface ring-1 ring-line">
            <div className="border-b border-line px-4 py-3 text-xs font-black text-ink">Items</div>
            <div className="divide-y divide-line">
              {items.map((item, index) => (
                <div key={`${item.sku ?? item.name ?? index}-${index}`} className="flex items-center gap-3 p-4">
                  <div className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-white p-1 text-[11px] font-black text-brand ring-1 ring-line">
                    {imageForItem(item) ? (
                      <img src={imageForItem(item) ?? ''} alt={item.name ?? item.sku ?? 'Order item'} className="absolute inset-1 h-[calc(100%-0.5rem)] w-[calc(100%-0.5rem)] object-contain" loading="lazy" />
                    ) : (
                      <span>{(item.sku ?? item.name ?? 'IT').slice(0, 2).toUpperCase()}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-black text-ink">{item.name ?? item.sku ?? 'Unnamed item'}</div>
                    <div className="truncate text-[11px] font-semibold text-ink-3">{item.sku ?? 'No SKU'}</div>
                  </div>
                  <div className="text-right text-xs font-black tabular-nums text-ink">x {item.quantity ?? 0}</div>
                </div>
              ))}
              {items.length === 0 ? <div className="p-4 text-xs font-semibold text-ink-3">No line items returned for this order.</div> : null}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function DetailStat({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`rounded-xl bg-surface-2 p-4 ring-1 ring-line ${wide ? 'sm:col-span-2' : ''}`}>
      <div className="text-[10px] font-black uppercase tracking-[0.12em] text-ink-3">{label}</div>
      <div className="mt-1 break-words text-xs font-black capitalize text-ink">{value}</div>
    </div>
  );
}
