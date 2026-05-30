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
export const useSyncStatus = () => useTokenQuery(['sync-status'], portalApi.syncStatus);
export const useAwaitingCount = () =>
  useTokenQuery(['awaiting-count'], portalApi.awaitingCount, true, { refetchInterval: LIVE_ORDERS_MS });

export function useDashboard() {
  const { days, clientId } = usePortalFilters();
  return useTokenQuery(['dashboard', days, clientId ?? 'scope'], (t) => portalApi.dashboard(t, days));
}
export function useDailyCounts() {
  const { days } = usePortalFilters();
  return useTokenQuery(['daily-counts', days], (t) => portalApi.dailyCounts(t, days));
}
export function useDailyShipments() {
  const { days } = usePortalFilters();
  return useTokenQuery(['daily-shipments', days], (t) => portalApi.dailyShipments(t, days));
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
/** When billing line items were last (re)generated via the portal. */
export const useBillingStatus = () => useTokenQuery(['billing-status'], portalApi.billingStatus);

/** Carrier rate markups (Settings → Markups). */
export const useMarkups = () => useTokenQuery(['markups'], portalApi.markups);
export function useInvoiceDetails() {
  const { days, clientId } = usePortalFilters();
  return useTokenQuery(['invoice-details', days, clientId ?? 'scope'], (t) => portalApi.invoiceDetails(t, days, clientId));
}
/** Invoice detail for an explicit YYYY-MM-DD range (Billing page). */
export function useInvoiceDetailsRange(dateFrom: string, dateTo: string) {
  const { clientId } = usePortalFilters();
  return useTokenQuery(
    ['invoice-details-range', dateFrom, dateTo, clientId ?? 'scope'],
    (t) => portalApi.invoiceDetailsRange(t, dateFrom, dateTo, clientId),
    Boolean(dateFrom && dateTo),
  );
}

export function useOrders(opts: ListOpts = {}) {
  const { clientId } = usePortalFilters();
  const merged: ListOpts = { ...opts, clientId: opts.clientId ?? clientId };
  return useTokenQuery(
    ['orders', merged.status ?? 'all', merged.search ?? '', merged.page ?? 1, merged.clientId ?? 'scope'],
    (t) => portalApi.orders(t, merged),
    true,
    { refetchInterval: LIVE_ORDERS_MS, refetchOnWindowFocus: true },
  );
}
export function useShipments(opts: ListOpts = {}) {
  const { clientId } = usePortalFilters();
  const merged: ListOpts = { ...opts, clientId: opts.clientId ?? clientId };
  return useTokenQuery(['shipments', merged.search ?? '', merged.page ?? 1, merged.clientId ?? 'scope'], (t) => portalApi.shipments(t, merged));
}
export function useInventory(opts: ListOpts = {}) {
  const { clientId } = usePortalFilters();
  const merged: ListOpts = { ...opts, clientId: opts.clientId ?? clientId };
  return useTokenQuery(['inventory', merged.search ?? '', merged.page ?? 1, merged.clientId ?? 'scope'], (t) => portalApi.inventory(t, merged));
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
    qc.prefetchQuery({ queryKey: ['daily-counts', days, true], queryFn: () => portalApi.dailyCounts(t, days) });
    qc.prefetchQuery({ queryKey: ['orders', 'all', '', 1, 'scope', true], queryFn: () => portalApi.orders(t, {}) });
    qc.prefetchQuery({ queryKey: ['inventory', '', 1, 'scope', true], queryFn: () => portalApi.inventory(t, {}) });
  }, [accessToken, days, qc]);
}
