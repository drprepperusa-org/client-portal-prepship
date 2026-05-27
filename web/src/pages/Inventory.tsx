import { useMemo, useState } from 'react';
import { DataTable, EmptyState, ErrorPanel, PageHeader, Panel, RefreshButton, TableSkeleton } from '../components/PortalPrimitives';
import { StoreBadge, StoreFilterBar, clientIdOf, storeNameForClient } from '../components/StoreScopeControls';
import { safeDate, safeNumber } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useClientsQuery, useInventoryQuery } from '../lib/portalQueries';
import type { PortalClient, PortalInventoryItem } from '../types/portal';

function clientRows(value: unknown): PortalClient[] {
  if (Array.isArray(value)) return value as PortalClient[];
  if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) return (value as { data: PortalClient[] }).data;
  return [];
}

export default function Inventory() {
  const auth = useAuth();
  const clients = useClientsQuery(auth.accessToken);
  const inventory = useInventoryQuery(auth.accessToken);
  const [activeClientId, setActiveClientId] = useState<number | 'all'>('all');
  const [search, setSearch] = useState('');
  const isFirstLoad = inventory.isLoading && !inventory.data;
  const stores = clientRows(clients.data);
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (inventory.data?.data ?? []).filter((item) => {
      const clientId = clientIdOf(item);
      if (activeClientId !== 'all' && clientId !== activeClientId) return false;
      if (!query) return true;
      const store = storeNameForClient(stores, clientId, item.storeName ?? item.clientName);
      return [store, item.sku, item.name].filter(Boolean).join(' ').toLowerCase().includes(query);
    });
  }, [activeClientId, inventory.data?.data, search, stores]);

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle="Current active SKU balances visible to your assigned client/store scope."
        action={<RefreshButton loading={inventory.isFetching} onClick={() => void inventory.refetch()} />}
      />
      {inventory.error ? (
        <ErrorPanel
          message={inventory.error instanceof Error ? inventory.error.message : String(inventory.error)}
          loading={inventory.isFetching}
          onRetry={() => void inventory.refetch()}
        />
      ) : null}
      <Panel title="Stock levels" right={<span className="text-xs font-bold text-ink-3">{inventory.data?.pagination?.total ?? 0} SKUs</span>}>
        <StoreFilterBar clients={stores} value={activeClientId} onChange={setActiveClientId} search={search} onSearchChange={setSearch} label="Inventory store" />
        {isFirstLoad ? (
          <TableSkeleton rows={7} columns={7} />
        ) : (
          <DataTable
            tableId="inventory-stock-levels"
            rows={rows}
            getRowKey={(item) => item.id}
            columns={[
              {
                key: 'image',
                header: 'Image',
                width: '76px',
                render: (item) => <InventoryThumb item={item} />,
              },
              {
                key: 'sku',
                header: 'SKU',
                render: (item) => (
                  <div className="min-w-0 space-y-1">
                    <StoreBadge name={storeNameForClient(stores, clientIdOf(item), item.storeName ?? item.clientName)} compact />
                    <div className="truncate font-black text-ink">{item.sku ?? `SKU ${item.id}`}</div>
                    <div className="truncate text-xs font-semibold text-ink-3">{item.name ?? 'Unnamed item'}</div>
                  </div>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (item) => {
                  const stock = Number(item.effectiveStock ?? item.stockQty ?? 0);
                  const reorder = Number(item.reorderLevel ?? 0);
                  const low = Number.isFinite(stock) && Number.isFinite(reorder) && reorder > 0 && stock <= reorder;
                  return (
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${low ? 'bg-warn-bg text-warn' : 'bg-ok-bg text-ok'}`}>
                      {low ? 'Low' : 'Healthy'}
                    </span>
                  );
                },
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
                key: 'sold',
                header: 'Sold 30d',
                className: 'right',
                render: (item) => <span className="font-semibold tabular-nums text-ink-2">{safeNumber(item.soldLast30Days)}</span>,
              },
              {
                key: 'updated',
                header: 'Updated',
                render: (item) => <span className="font-semibold text-ink-2">{safeDate(item.updatedAt)}</span>,
              },
            ]}
          />
        )}
        {!inventory.isLoading && rows.length === 0 ? <EmptyState title="No inventory found" body="Active SKUs for your selected store scope will appear here." /> : null}
      </Panel>
    </>
  );
}

function inventoryImageUrl(item: PortalInventoryItem) {
  return item.imageUrl ?? null;
}

function inventoryAlt(item: PortalInventoryItem) {
  return item.name ?? item.sku ?? `SKU ${item.id}`;
}

function skuInitial(item: PortalInventoryItem) {
  return (item.sku ?? item.name ?? 'SKU').slice(0, 2).toUpperCase();
}

function InventoryThumb({ item }: { item: PortalInventoryItem }) {
  const imageUrl = inventoryImageUrl(item);
  const alt = inventoryAlt(item);
  const fallback = skuInitial(item);

  return (
    <div className="group relative inline-flex">
      <div className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-white p-1 text-[10px] font-black text-brand ring-1 ring-line">
        {imageUrl ? (
          <img src={imageUrl} alt={alt} className="absolute inset-1 h-[calc(100%-0.5rem)] w-[calc(100%-0.5rem)] object-contain" loading="lazy" />
        ) : (
          <span>{fallback}</span>
        )}
      </div>
      {imageUrl ? (
        <div className="pointer-events-none absolute left-12 top-1/2 z-30 hidden -translate-y-1/2 rounded-xl bg-white p-2 shadow-[0_18px_45px_rgba(18,40,63,.22)] ring-1 ring-line group-hover:block">
          <img src={imageUrl} alt="" className="h-36 w-36 object-contain" loading="lazy" />
        </div>
      ) : null}
    </div>
  );
}
