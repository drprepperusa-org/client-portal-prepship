import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useAuth } from '@/auth';
import { portalApi, type ListOpts } from './api';
// ListOpts is re-used by useReturns below (returns filter shape mirrors it).
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
  const { dateRange, clientId } = usePortalFilters();
  return useTokenQuery(['dashboard', dateRange.dateFrom, dateRange.dateTo, clientId ?? 'scope'], (t) => portalApi.dashboard(t, dateRange, clientId));
}
export function useDailyCounts() {
  const { dateRange, clientId } = usePortalFilters();
  return useTokenQuery(['daily-counts', dateRange.dateFrom, dateRange.dateTo, clientId ?? 'scope'], (t) => portalApi.dailyCounts(t, dateRange, clientId));
}
export function useDailyShipments() {
  const { dateRange, clientId } = usePortalFilters();
  return useTokenQuery(['daily-shipments', dateRange.dateFrom, dateRange.dateTo, clientId ?? 'scope'], (t) => portalApi.dailyShipments(t, dateRange, clientId));
}
export function useAnalysis() {
  // CP-010: include the top-bar clientId in the key + request (like useDashboard)
  // so Analysis re-fetches when the client switcher changes and stays in
  // lock-step with the Dashboard's scope.
  const { dateRange, clientId } = usePortalFilters();
  return useTokenQuery(['analysis', dateRange.dateFrom, dateRange.dateTo, clientId ?? 'scope'], (t) => portalApi.analysis(t, dateRange, clientId));
}
export function useReports() {
  const { dateRange } = usePortalFilters();
  return useTokenQuery(['reports', dateRange.dateFrom, dateRange.dateTo], (t) => portalApi.reports(t, dateRange));
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
  const { dateRange, clientId } = usePortalFilters();
  return useTokenQuery(['invoice-details', dateRange.dateFrom, dateRange.dateTo, clientId ?? 'scope'], (t) => portalApi.invoiceDetails(t, dateRange, clientId));
}
/** Invoice detail for an explicit YYYY-MM-DD range (Billing page drill-in).
 *  Server-paginated — rendering thousands of rows at once made Billing lag —
 *  and auto-refetching so the view tracks billing generation. */
export function useInvoiceDetailsRange(
  dateFrom: string,
  dateTo: string,
  explicitClientId?: number | null,
  page = 1,
  pageSize = 100,
  // CP-016: whole-set header sort for the Billing line-item table.
  sortBy?: string,
  sortDir?: 'asc' | 'desc',
) {
  const { clientId: globalClientId } = usePortalFilters();
  const clientId = explicitClientId ?? globalClientId;
  return useTokenQuery(
    ['invoice-details-range', dateFrom, dateTo, clientId ?? 'scope', page, pageSize, sortBy ?? '', sortDir ?? ''],
    (t) => portalApi.invoiceDetailsRange(t, dateFrom, dateTo, clientId, { page, pageSize, sortBy, sortDir }),
    Boolean(dateFrom && dateTo) && (explicitClientId === undefined || explicitClientId != null),
    { refetchInterval: 60_000, refetchOnWindowFocus: true },
  );
}

/** Per-client billing rollup for a range — SQL-aggregated server-side, no row
 *  cap, so order counts and totals are exact regardless of range size. */
export function useInvoiceSummaryRange(dateFrom: string, dateTo: string) {
  const { clientId } = usePortalFilters();
  return useTokenQuery(
    ['invoice-summary-range', dateFrom, dateTo, clientId ?? 'scope'],
    (t) => portalApi.invoiceSummaryRange(t, dateFrom, dateTo, clientId),
    Boolean(dateFrom && dateTo),
    { refetchInterval: 60_000, refetchOnWindowFocus: true },
  );
}

/** Billing periods per client — 'half' (1st–15th / 16th–EOM) or 'month'
 *  (combined full-month rows). Pass explicitClientId for the on-page client
 *  filter; otherwise the global topbar switcher applies. */
export function useInvoicePeriodSummaryRange(
  dateFrom: string,
  dateTo: string,
  granularity: 'half' | 'month' = 'half',
  explicitClientId?: number,
) {
  const { clientId: globalClientId } = usePortalFilters();
  const clientId = explicitClientId ?? globalClientId;
  return useTokenQuery(
    ['invoice-period-summary-range', dateFrom, dateTo, granularity, clientId ?? 'scope'],
    (t) => portalApi.invoicePeriodSummaryRange(t, dateFrom, dateTo, clientId, granularity),
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
/** Shipments for one order — powers the Billing Order # shipment modal. */
export function useOrderShipments(orderId: number | null) {
  return useTokenQuery(
    ['order-shipments', orderId ?? 'none'],
    (t) => portalApi.orderShipments(t, orderId as number),
    orderId != null,
  );
}
export function useInventory(opts: ListOpts = {}) {
  const { clientId } = usePortalFilters();
  const merged: ListOpts = { ...opts, clientId: opts.clientId ?? clientId };
  return useTokenQuery(['inventory', merged.search ?? '', merged.page ?? 1, merged.lowStock ? 'low' : 'all', merged.clientId ?? 'scope'], (t) => portalApi.inventory(t, merged));
}

export function useInventoryHistory(opts: { page?: number; sku?: string; type?: string } = {}) {
  const { dateRange } = usePortalFilters();
  return useTokenQuery(
    ['inventory-history', opts.sku ?? '', opts.type ?? '', opts.page ?? 1, dateRange.dateFrom, dateRange.dateTo],
    (t) => portalApi.inventoryHistory(t, { ...opts, dateRange }),
  );
}
export const useIntegrations = () => useTokenQuery(['integrations'], portalApi.integrations);

// CP-029 — Returns list + detail. Mirrors useShipments/useOrder: the list honors
// the top-bar client switcher and the on-page status/search/order filters; the
// detail re-reads the single backend-owned return DTO.
export function useReturns(opts: ListOpts & { orderId?: number } = {}) {
  const { clientId } = usePortalFilters();
  const merged = { ...opts, clientId: opts.clientId ?? clientId };
  return useTokenQuery(
    ['returns', merged.status ?? 'all', merged.search ?? '', merged.page ?? 1, merged.orderId ?? 0, merged.clientId ?? 'scope'],
    (t) => portalApi.returns(t, merged),
  );
}
export function useReturnDetail(id: number | null) {
  return useTokenQuery(['return', id ?? 0], (t) => portalApi.returnDetail(t, id as number), id != null);
}

// CP-029 — selectable return-to locations for the create-return modal. Enabled
// only while the modal is open (locations rarely change; the cache is fine).
export function useReturnLocations(enabled = true) {
  return useTokenQuery(['return-locations'], (t) => portalApi.returnLocations(t), enabled);
}

// CP-030 — 3PL receiving queue (operator-only). Only enabled when requested, so
// non-operator pages never fire it (the backend also 403s a client user). The
// search term is debounced upstream in the page and passed in.
export function useReturnsReceiving(search: string, enabled = true) {
  return useTokenQuery(
    ['returns-receiving', search],
    (t) => portalApi.returnsReceiving(t, search || undefined),
    enabled,
    { refetchInterval: LIVE_ORDERS_MS },
  );
}

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
  const { dateRange } = usePortalFilters();
  const qc = useQueryClient();
  useEffect(() => {
    if (!accessToken) return;
    const t = accessToken;
    qc.prefetchQuery({ queryKey: ['dashboard', dateRange.dateFrom, dateRange.dateTo, 'scope', true], queryFn: () => portalApi.dashboard(t, dateRange) });
    qc.prefetchQuery({ queryKey: ['daily-counts', dateRange.dateFrom, dateRange.dateTo, 'scope', true], queryFn: () => portalApi.dailyCounts(t, dateRange) });
    // Match the Orders page's first view exactly (awaiting tab, default pageSize)
    // so the prefetch actually warms it instead of a key nothing reads.
    qc.prefetchQuery({ queryKey: ['orders', 'awaiting_shipment', '', 1, 50, 'scope', true], queryFn: () => portalApi.orders(t, { status: 'awaiting_shipment' }) });
    qc.prefetchQuery({ queryKey: ['inventory', '', 1, 'all', 'scope', true], queryFn: () => portalApi.inventory(t, {}) });
  }, [accessToken, dateRange, qc]);
}
