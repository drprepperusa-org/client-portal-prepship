import { portalQueryKey, portalReadKeys } from './query-keys';
import type { RequestAuth } from './api/transport';
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
function useTokenQuery<T>(key: unknown[], fn: (token: RequestAuth) => Promise<T>, enabled = true, opts: TokenQueryOpts = {}) {
  const { accessToken, userId } = useAuth();
  return useQuery({
    queryKey: portalQueryKey(userId, key),
    queryFn: ({ signal }) => fn({ accessToken: accessToken as string, signal }),
    enabled: Boolean(accessToken) && enabled,
    refetchInterval: opts.refetchInterval,
    refetchOnWindowFocus: opts.refetchOnWindowFocus,
  });
}

// CP-037: Client Portal live order/return polling runs every 10 MINUTES — NOT
// the backend sync cadence (order/shipment sync is 3 min in
// src/services/sync-scheduler.ts, which stays unchanged). A 45s interval made
// the customer portal re-render constantly; the DB is kept fresh by the shared
// worker regardless, and the Orders "Sync" button forces an immediate refresh
// on demand, so a slow background poll is all the passive views need.
const LIVE_ORDERS_MS = 10 * 60 * 1000;

export const useMe = () => useTokenQuery(['me'], portalApi.me);
export function useCanCustomizeTables(): boolean {
  const me = useMe().data;
  return Boolean(me?.isAdmin || me?.isGlobal);
}
export function useAuditLog(search = '', limit = 100, storeId?: number | null) {
  return useTokenQuery(['audit-log', search, limit, storeId ?? 'all-stores'], (t) => portalApi.auditLog(t, { search, limit, storeId }), true, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}
export const useClients = () => useTokenQuery(['clients'], portalApi.clients);
export const useAccessList = () => useTokenQuery(['access-list'], portalApi.accessList);
export const useSyncStatus = () => useTokenQuery(['sync-status'], portalApi.syncStatus);
export function useAwaitingCount() {
  const { clientId } = usePortalFilters();
  return useTokenQuery(['awaiting-count', clientId ?? 'scope'], (t) => portalApi.awaitingCount(t, clientId), true, {
    refetchInterval: LIVE_ORDERS_MS,
    // CP-037: false so window focus can't refetch the badge (which is on every
    // page) outside the 10-minute cadence — React Query defaults this to true.
    refetchOnWindowFocus: false,
  });
}

export function useDashboard() {
  const { dateRange, clientId } = usePortalFilters();
  return useTokenQuery(portalReadKeys.dashboard(dateRange.dateFrom, dateRange.dateTo, clientId), (t) => portalApi.dashboard(t, dateRange, clientId));
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
  const { userId } = useAuth();
  const qc = useQueryClient();
  const merged: ListOpts = { ...opts, clientId: opts.clientId ?? clientId };
  const query = useTokenQuery(
    // pageSize MUST be in the key: the Dashboard "Open orders" peek requests this
    // same status/page with pageSize 6, and without it that 6-row response would
    // alias the full Orders list (refetchOnMount:false → sticky truncation).
    portalReadKeys.orders(merged.clientId, merged.status ?? 'all', merged.search, merged.page, merged.pageSize, merged.sortBy, merged.sortDir),
    (t) => portalApi.orders(t, merged),
    true,
    // CP-037: refetchOnWindowFocus false so returning to the tab can't trigger an
    // Orders refetch/render burst outside the 10-minute cadence. The Orders page
    // Sync button still invalidates + refetches immediately on click.
    { refetchInterval: LIVE_ORDERS_MS, refetchOnWindowFocus: false },
  );

  useEffect(() => {
    if (merged.status !== 'awaiting_shipment' || merged.search) return;
    if (!query.data?.pagination) return;
    qc.setQueryData(portalQueryKey(userId, ['awaiting-count', merged.clientId ?? 'scope']), {
      count: query.data.pagination.total,
    });
  }, [userId, merged.clientId, merged.search, merged.status, qc, query.data?.pagination]);

  return query;
}
export function useShipments(opts: ListOpts = {}) {
  const { clientId } = usePortalFilters();
  const merged: ListOpts = { ...opts, clientId: opts.clientId ?? clientId };
  return useTokenQuery(
    ['shipments', merged.search ?? '', merged.page ?? 1, merged.pageSize ?? 50, merged.status ?? 'all', merged.clientId ?? 'scope', merged.sortBy, merged.sortDir],
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
  return useTokenQuery(portalReadKeys.inventory(merged.clientId, merged.search, merged.page, merged.pageSize, merged.lowStock, merged.sortBy, merged.sortDir), (t) => portalApi.inventory(t, merged));
}

export function useInventoryHistory(opts: { sortBy?: string; sortDir?: 'asc' | 'desc'; page?: number; pageSize?: number; sku?: string; type?: string } = {}) {
  const { dateRange } = usePortalFilters();
  return useTokenQuery(
    ['inventory-history', opts.sku ?? '', opts.type ?? '', opts.page ?? 1, opts.pageSize ?? 50, dateRange.dateFrom, dateRange.dateTo, opts.sortBy, opts.sortDir],
    (t) => portalApi.inventoryHistory(t, { ...opts, dateRange }),
  );
}
export const useIntegrations = () => useTokenQuery(['integrations'], portalApi.integrations);

// CP-061 — Replace list + detail. Reads are scoped server-side; the list honors
// the top-bar client switcher. All replacement truth is backend-derived.
export function useReplacements() {
  const { clientId } = usePortalFilters();
  return useTokenQuery(['replacements', clientId ?? 'scope'], (t) =>
    portalApi.replacements(t, clientId ?? undefined),
  );
}
export const useReplacement = (id: number | null) =>
  useTokenQuery(['replacement', id ?? 0], (t) => portalApi.replacement(t, id as number), id != null);
// CP-061 — the customer-safe reason contract (codes + labels). The CP proxy validates it; the UI
// renders only these labels and never a local map.
export const useReplacementReasonContract = () =>
  useTokenQuery(['replacement-reason-contract'], (t) => portalApi.replacementReasonContract(t));

// CP-029 — Returns list + detail. Mirrors useShipments/useOrder: the list honors
// the top-bar client switcher and the on-page status/search/order filters; the
// detail re-reads the single backend-owned return DTO.
export function useReturns(opts: ListOpts & { orderId?: number } = {}) {
  const { clientId } = usePortalFilters();
  const merged = { ...opts, clientId: opts.clientId ?? clientId };
  return useTokenQuery(
    ['returns', merged.status ?? 'all', merged.search ?? '', merged.page ?? 1, merged.pageSize ?? 50, merged.orderId ?? 0, merged.clientId ?? 'scope', merged.sortBy, merged.sortDir],
    (t) => portalApi.returns(t, merged),
  );
}
export function useReturnDetail(id: number | null) {
  return useTokenQuery(['return', id ?? 0], (t) => portalApi.returnDetail(t, id as number), id != null);
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
 * Warms the highest-traffic pages after foreground work, one visible-tab
 * request at a time. Navigation can reuse the same user-scoped query.
 */
export function usePrefetchPortal() {
  const { accessToken, userId } = useAuth();
  const { dateRange, clientId } = usePortalFilters();
  const qc = useQueryClient();
  useEffect(() => {
    if (!accessToken || !userId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wake: (() => void) | undefined;
    let activeKey: unknown[] | undefined;
    const cancelSpeculation = () => {
      if (!activeKey) return;
      const query = qc.getQueryCache().find({ queryKey: activeKey, exact: true });
      // Navigation may have promoted this request to a visible query.
      if (query && query.getObserversCount() === 0) void qc.cancelQueries({ queryKey: activeKey, exact: true });
    };
    const onVisibility = () => { if (document.hidden) cancelSpeculation(); };
    document.addEventListener('visibilitychange', onVisibility);
    const pause = () => new Promise<void>(resolve => { wake = resolve; timer = setTimeout(resolve, 250); });
    const prefetch = async () => {
      await pause();
      const reads = [
        { key: portalReadKeys.dashboard(dateRange.dateFrom, dateRange.dateTo, clientId), read: (auth: RequestAuth) => portalApi.backgroundDashboard(auth, dateRange, clientId) },
        { key: portalReadKeys.orders(clientId), read: (auth: RequestAuth) => portalApi.backgroundOrders(auth, { status: 'awaiting_shipment', clientId }) },
        { key: portalReadKeys.inventory(clientId), read: (auth: RequestAuth) => portalApi.backgroundInventory(auth, { clientId }) },
      ];
      for (const { key, read } of reads) {
        while (!cancelled && (document.hidden || qc.isFetching() > 0)) await pause();
        if (cancelled) return;
        activeKey = portalQueryKey(userId, key);
        await qc.prefetchQuery<unknown>({
          queryKey: activeKey,
          queryFn: ({ signal }) => read({ accessToken, signal }),
        });
        activeKey = undefined;
      }
    };
    void prefetch();
    return () => {
      cancelled = true; clearTimeout(timer); wake?.(); cancelSpeculation();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [accessToken, userId, dateRange.dateFrom, dateRange.dateTo, clientId, qc]);
}
