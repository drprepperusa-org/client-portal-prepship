import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useAuth } from '@/auth';
import { portalApi, type ListOpts } from './api';
import { usePortalFilters } from './portalContext';

type TokenQueryOpts = {
  /** Background poll interval (ms). Mirrors v4's live auto-sync. */
  refetchInterval?: number;
  refetchOnWindowFocus?: boolean;
};

/** Wraps a portal query so it only runs once we have an access token. */
function useTokenQuery<T>(key: unknown[], fn: (token: string) => Promise<T>, enabled = true, opts: TokenQueryOpts = {}) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: [...key, Boolean(accessToken)],
    queryFn: () => fn(accessToken as string),
    enabled: Boolean(accessToken) && enabled,
    refetchInterval: opts.refetchInterval,
    refetchOnWindowFocus: opts.refetchOnWindowFocus,
  });
}

// Poll orders + awaiting badge so the portal mirrors v4's continuous sync: the
// shared worker keeps filling rates/accounts in the DB; we just keep pulling.
const LIVE_ORDERS_MS = 45_000;

export const useMe = () => useTokenQuery(['me'], portalApi.me);
export const useClients = () => useTokenQuery(['clients'], portalApi.clients);
export const useAccessList = () => useTokenQuery(['access-list'], portalApi.accessList);
export const useSyncStatus = () => useTokenQuery(['sync-status'], portalApi.syncStatus);
export function useAwaitingCount() {
  const { clientId } = usePortalFilters();
  return useTokenQuery(['awaiting-count', clientId ?? 'scope'], (t) => portalApi.awaitingCount(t, clientId), true, {
    refetchInterval: LIVE_ORDERS_MS,
  });
}

export function useDashboard() {
  const { days, clientId } = usePortalFilters();
  return useTokenQuery(['dashboard', days, clientId ?? 'scope'], (t) => portalApi.dashboard(t, days, clientId));
}
export function useDailyCounts() {
  const { days, clientId } = usePortalFilters();
  return useTokenQuery(['daily-counts', days, clientId ?? 'scope'], (t) => portalApi.dailyCounts(t, days, clientId));
}
export function useDailyShipments() {
  const { days, clientId } = usePortalFilters();
  return useTokenQuery(['daily-shipments', days, clientId ?? 'scope'], (t) => portalApi.dailyShipments(t, days, clientId));
}
export function useAnalysis() {
  const { days } = usePortalFilters();
  return useTokenQuery(['analysis', days], (t) => portalApi.analysis(t, days));
}
export function useReports() {
  const { days } = usePortalFilters();
  return useTokenQuery(['reports', days], (t) => portalApi.reports(t, days));
}
/** Billing report for an explicit YYYY-MM-DD range. */
export function useReportsRange(dateFrom: string, dateTo: string) {
  return useTokenQuery(['reports-range', dateFrom, dateTo], (t) => portalApi.reportsRange(t, dateFrom, dateTo), Boolean(dateFrom && dateTo));
}
/** When billing line items were last (re)generated (manual or worker auto-run). */
export const useBillingStatus = () =>
  useTokenQuery(['billing-status'], portalApi.billingStatus, true, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

/** Carrier rate markups (Settings → Markups). */
export const useMarkups = () => useTokenQuery(['markups'], portalApi.markups);
export function useInvoiceDetails() {
  const { days, clientId } = usePortalFilters();
  return useTokenQuery(['invoice-details', days, clientId ?? 'scope'], (t) => portalApi.invoiceDetails(t, days, clientId));
}
/** Invoice detail for an explicit YYYY-MM-DD range (Billing page). Auto-refetches
 *  so the view tracks the worker's automatic billing generation by default. */
export function useInvoiceDetailsRange(dateFrom: string, dateTo: string) {
  const { clientId } = usePortalFilters();
  return useTokenQuery(
    ['invoice-details-range', dateFrom, dateTo, clientId ?? 'scope'],
    (t) => portalApi.invoiceDetailsRange(t, dateFrom, dateTo, clientId),
    Boolean(dateFrom && dateTo),
    { refetchInterval: 60_000, refetchOnWindowFocus: true },
  );
}

export function useOrders(opts: ListOpts = {}) {
  const { clientId } = usePortalFilters();
  const merged: ListOpts = { ...opts, clientId: opts.clientId ?? clientId };
  return useTokenQuery(
    // pageSize MUST be in the key: the Dashboard "Open orders" peek requests this
    // same status/page with pageSize 6, and without it that 6-row response would
    // alias the full Orders list (refetchOnMount:false → sticky truncation).
    ['orders', merged.status ?? 'all', merged.search ?? '', merged.page ?? 1, merged.pageSize ?? 50, merged.clientId ?? 'scope'],
    (t) => portalApi.orders(t, merged),
    true,
    { refetchInterval: LIVE_ORDERS_MS, refetchOnWindowFocus: true },
  );
}
export function useShipments(opts: ListOpts = {}) {
  const { clientId } = usePortalFilters();
  const merged: ListOpts = { ...opts, clientId: opts.clientId ?? clientId };
  return useTokenQuery(
    ['shipments', merged.search ?? '', merged.page ?? 1, merged.status ?? 'all', merged.clientId ?? 'scope'],
    (t) => portalApi.shipments(t, merged),
  );
}
export function useInventory(opts: ListOpts = {}) {
  const { clientId } = usePortalFilters();
  const merged: ListOpts = { ...opts, clientId: opts.clientId ?? clientId };
  return useTokenQuery(['inventory', merged.search ?? '', merged.page ?? 1, merged.lowStock ? 'low' : 'all', merged.clientId ?? 'scope'], (t) => portalApi.inventory(t, merged));
}

export function useInventoryHistory(opts: { page?: number; sku?: string; type?: string } = {}) {
  const { days } = usePortalFilters();
  return useTokenQuery(
    ['inventory-history', opts.sku ?? '', opts.type ?? '', opts.page ?? 1, days],
    (t) => portalApi.inventoryHistory(t, { ...opts, days }),
  );
}
export const useIntegrations = () => useTokenQuery(['integrations'], portalApi.integrations);

export function useInbound(clientId?: number) {
  const { clientId: globalClientId } = usePortalFilters();
  const cid = clientId ?? globalClientId;
  return useTokenQuery(['inbound', cid ?? 'scope'], (t) => portalApi.inbound(t, cid));
}

/** Orders for a single SKU (Analysis drill-down panel). */
export function useSkuOrders(inventoryId: number | null, dateFrom?: string, dateTo?: string) {
  return useTokenQuery(
    ['sku-orders', inventoryId ?? 0, dateFrom ?? '', dateTo ?? ''],
    (t) => portalApi.skuOrders(t, inventoryId as number, dateFrom, dateTo),
    inventoryId != null,
  );
}

/** A single order's full detail (drawer drill-down). */
export function useOrder(id: number | null) {
  return useTokenQuery(['order', id ?? 0], (t) => portalApi.order(t, id as number), id != null);
}

/**
 * Warms the cache for the highest-traffic pages right after the shell mounts,
 * so the first navigation to Orders/Inventory/Dashboard is instant.
 */
export function usePrefetchPortal() {
  const { accessToken } = useAuth();
  const { days } = usePortalFilters();
  const qc = useQueryClient();
  useEffect(() => {
    if (!accessToken) return;
    const t = accessToken;
    qc.prefetchQuery({ queryKey: ['dashboard', days, 'scope', true], queryFn: () => portalApi.dashboard(t, days) });
    qc.prefetchQuery({ queryKey: ['daily-counts', days, 'scope', true], queryFn: () => portalApi.dailyCounts(t, days) });
    // Match the Orders page's first view exactly (awaiting tab, default pageSize)
    // so the prefetch actually warms it instead of a key nothing reads.
    qc.prefetchQuery({ queryKey: ['orders', 'awaiting_shipment', '', 1, 50, 'scope', true], queryFn: () => portalApi.orders(t, { status: 'awaiting_shipment' }) });
    qc.prefetchQuery({ queryKey: ['inventory', '', 1, 'all', 'scope', true], queryFn: () => portalApi.inventory(t, {}) });
  }, [accessToken, days, qc]);
}
