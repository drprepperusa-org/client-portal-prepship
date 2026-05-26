import { useMemo, useState } from 'react';
import { DataTable, EmptyState, ErrorPanel, PageHeader, Panel, RefreshButton, StatusBadge, TableSkeleton } from '../components/PortalPrimitives';
import { safeDate } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useInventoryQuery, useOrdersQuery } from '../lib/portalQueries';
import type { OrderItem, OrderStatus, PortalInventoryItem, PortalOrder } from '../types/portal';

const orderTabs: Array<{ value: OrderStatus; label: string; empty: string }> = [
  { value: 'awaiting_shipment', label: 'Awaiting shipment', empty: 'Awaiting shipment orders will appear here after they sync into PrepShip.' },
  { value: 'shipped', label: 'Shipped', empty: 'Shipped orders will appear here after fulfillment.' },
  { value: 'cancelled', label: 'Cancelled', empty: 'Cancelled orders will appear here when available in your scoped account.' },
];

export default function Orders() {
  const auth = useAuth();
  const [activeStatus, setActiveStatus] = useState<OrderStatus>('awaiting_shipment');
  const [selectedOrder, setSelectedOrder] = useState<PortalOrder | null>(null);
  const orders = useOrdersQuery(auth.accessToken, activeStatus);
  const inventory = useInventoryQuery(auth.accessToken);
  const isFirstLoad = orders.isLoading && !orders.data;
  const activeTab = useMemo(() => orderTabs.find((tab) => tab.value === activeStatus) ?? orderTabs[0]!, [activeStatus]);
  const inventoryImages = useMemo(() => {
    const map = new Map<string, PortalInventoryItem>();
    for (const item of inventory.data?.data ?? []) {
      if (item.sku) map.set(item.sku.toLowerCase(), item);
    }
    return map;
  }, [inventory.data]);

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

  function orderInitial(order: PortalOrder) {
    const item = primaryItem(order);
    return (item?.sku ?? item?.name ?? order.orderNumber ?? 'O').slice(0, 2).toUpperCase();
  }

  function openOrder(order: PortalOrder) {
    setSelectedOrder(order);
  }

  return (
    <>
      <PageHeader
        title="Orders"
        subtitle="Read-only order visibility for your assigned client/store scope."
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
        right={<span className="text-xs font-bold text-ink-3">{orders.data?.pagination?.total ?? orders.data?.data.length ?? 0} orders</span>}
      >
        <div className="flex gap-2 overflow-x-auto border-b border-line px-4 pt-2" role="tablist" aria-label="Order status">
          {orderTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={activeStatus === tab.value}
              className={`relative h-9 shrink-0 rounded-t-lg px-3 text-xs font-black transition-all duration-200 ease-out after:absolute after:inset-x-3 after:bottom-1 after:h-0.5 after:rounded-full after:bg-brand after:transition-transform after:duration-200 hover:bg-brand-bg/60 active:scale-[0.985] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/35 motion-reduce:transform-none motion-reduce:transition-none ${activeStatus === tab.value ? 'bg-brand-bg text-brand after:scale-x-100' : 'text-ink-2 after:scale-x-0'}`}
              onClick={() => setActiveStatus(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {isFirstLoad ? (
          <TableSkeleton rows={6} columns={6} />
        ) : (
          <DataTable
            tableId={`orders-${activeStatus}`}
            rows={orders.data?.data ?? []}
            getRowKey={(order) => order.id}
            onRowClick={openOrder}
            columns={[
              {
                key: 'image',
                header: 'Image',
                width: '92px',
                render: (order) => <OrderThumb order={order} imageUrl={orderImageUrl(order)} fallback={orderInitial(order)} />,
              },
              {
                key: 'order',
                header: 'Order',
                render: (order) => (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openOrder(order);
                    }}
                    className="text-left text-xs font-black text-ink transition-colors hover:text-brand"
                  >
                    {order.orderNumber ?? order.externalOrderId ?? order.id}
                    <span className="mt-0.5 block text-[11px] font-bold text-ink-3">Click for full details</span>
                  </button>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (order) => <StatusBadge value={order.orderStatus} />,
              },
              {
                key: 'recipient',
                header: 'Recipient',
                render: (order) => (
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-ink-2">{order.shipToName ?? 'Not available'}</div>
                    <div className="truncate text-[11px] text-ink-3">{[order.shipToCity, order.shipToState].filter(Boolean).join(', ') || 'No city/state'}</div>
                  </div>
                ),
              },
              {
                key: 'items',
                header: 'Items',
                render: (order) => (
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-ink-2">{order.items?.[0]?.sku ?? 'Mixed items'}</div>
                    <div className="text-[11px] text-ink-3">{order.items?.length ?? 0} line(s)</div>
                  </div>
                ),
              },
              {
                key: 'carrier',
                header: 'Carrier',
                render: (order) => (
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-ink-2">{order.label?.carrierCode ?? order.carrierCode ?? '-'}</div>
                    <div className="truncate text-[11px] text-ink-3">{order.label?.serviceCode ?? order.serviceCode ?? ''}</div>
                  </div>
                ),
              },
              {
                key: 'date',
                header: 'Date',
                render: (order) => <span className="text-xs font-semibold text-ink-2">{safeDate(order.orderDate)}</span>,
              },
            ]}
          />
        )}
        {!orders.isLoading && (orders.data?.data.length ?? 0) === 0 ? <EmptyState title={`No ${activeTab.label.toLowerCase()} orders found`} body={activeTab.empty} /> : null}
      </Panel>
      <OrderDetailDrawer
        order={selectedOrder}
        imageUrl={selectedOrder ? orderImageUrl(selectedOrder) : null}
        fallback={selectedOrder ? orderInitial(selectedOrder) : 'O'}
        onClose={() => setSelectedOrder(null)}
      />
    </>
  );
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
  onClose,
}: {
  order: PortalOrder | null;
  imageUrl: string | null;
  fallback: string;
  onClose: () => void;
}) {
  if (!order) return null;
  const items = order.items ?? [];
  const tracking = order.label?.trackingNumber ?? order.trackingNumber ?? order.labelTracking ?? 'Not available';
  const carrier = order.label?.carrierCode ?? order.carrierCode ?? 'Not assigned';
  const service = order.label?.serviceCode ?? order.serviceCode ?? 'Not assigned';

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
          <div className="mb-5 overflow-hidden rounded-2xl bg-white ring-1 ring-line">
            <div className="relative grid h-56 place-items-center bg-white">
              {imageUrl ? (
                <img src={imageUrl} alt={primaryAlt(order)} className="absolute inset-3 h-[calc(100%-1.5rem)] w-[calc(100%-1.5rem)] object-contain" />
              ) : (
                <div className="grid h-24 w-24 place-items-center rounded-2xl bg-surface text-2xl font-black text-brand shadow-sm ring-1 ring-line">{fallback}</div>
              )}
            </div>
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
                    {item.imageUrl ?? item.image_url ?? item.thumbnailUrl ?? item.productImageUrl ? (
                      <img src={item.imageUrl ?? item.image_url ?? item.thumbnailUrl ?? item.productImageUrl ?? ''} alt={item.name ?? item.sku ?? 'Order item'} className="absolute inset-1 h-[calc(100%-0.5rem)] w-[calc(100%-0.5rem)] object-contain" loading="lazy" />
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
