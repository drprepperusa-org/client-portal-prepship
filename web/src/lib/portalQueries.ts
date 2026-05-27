import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { defaultRange, portalApi, type BackfillMode, type BackfillResponse, type BackfillTarget } from './api';
import {
  DEMO_TOKEN,
  demoBilling,
  demoAnalysisSkuBreakdown,
  demoDailyCounts,
  demoDashboard,
  demoInventory,
  demoOrders,
  demoShipments,
} from './demo-data';
import type { CarrierAccount, OrderStatus } from '../types/portal';

const enabled = (token: string | null) => Boolean(token);

export const portalQueryKeys = {
  root: ['portal'] as const,
  dashboard: (token?: string | null) => ['portal', portalSessionKey(token), 'dashboard'] as const,
  dailyCounts: (token?: string | null) => ['portal', portalSessionKey(token), 'daily-counts'] as const,
  orders: (token?: string | null, status?: OrderStatus | 'all') => ['portal', portalSessionKey(token), 'orders', status ?? 'all'] as const,
  shipments: (token?: string | null) => ['portal', portalSessionKey(token), 'shipments'] as const,
  inventory: (token?: string | null) => ['portal', portalSessionKey(token), 'inventory'] as const,
  billing: (token?: string | null, range?: { from: string; to: string }) =>
    ['portal', portalSessionKey(token), 'billing', range?.from ?? 'default', range?.to ?? 'default'] as const,
  invoiceDetails: (token?: string | null, range?: { from: string; to: string }) =>
    ['portal', portalSessionKey(token), 'invoice-details', range?.from ?? 'default', range?.to ?? 'default'] as const,
  clients: (token?: string | null) => ['portal', portalSessionKey(token), 'clients'] as const,
  settings: (token?: string | null) => ['portal', portalSessionKey(token), 'settings'] as const,
  me: (token?: string | null) => ['portal', portalSessionKey(token), 'me'] as const,
  syncStatus: (token?: string | null) => ['portal', portalSessionKey(token), 'sync-status'] as const,
  products: (token?: string | null) => ['portal', portalSessionKey(token), 'products'] as const,
  analysisOverview: (token?: string | null) => ['portal', portalSessionKey(token), 'analysis-overview'] as const,
  analysisSkuBreakdown: (token?: string | null) => ['portal', portalSessionKey(token), 'analysis-sku-breakdown'] as const,
  analysisSkuOrders: (token?: string | null, inventoryId?: number | null, range?: { from: string; to: string }) =>
    ['portal', portalSessionKey(token), 'analysis-sku-orders', inventoryId ?? 'none', range?.from ?? 'default', range?.to ?? 'default'] as const,
  dailyShipments: (token?: string | null) => ['portal', portalSessionKey(token), 'daily-shipments'] as const,
  carrierAccounts: (token?: string | null) => ['portal', portalSessionKey(token), 'carrier-accounts'] as const,
};

function demoAllowed(token: string) {
  return token === DEMO_TOKEN && import.meta.env.VITE_ENABLE_DEMO === 'true';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return typeof globalThis.atob === 'function' ? globalThis.atob(padded) : '';
}

function portalSessionKey(token?: string | null) {
  if (!token) return 'anonymous';
  if (token === DEMO_TOKEN) return 'demo';
  const [, payload] = token.split('.');
  if (!payload) return 'unknown';
  try {
    const parsed = JSON.parse(decodeBase64Url(payload)) as unknown;
    if (!isRecord(parsed)) return 'unknown';
    const appMetadata = isRecord(parsed.app_metadata) ? parsed.app_metadata : {};
    return [
      String(parsed.sub ?? parsed.email ?? 'unknown'),
      String(appMetadata.clientIds ?? appMetadata.client_ids ?? parsed.clientIds ?? parsed.client_ids ?? ''),
      String(appMetadata.storeIds ?? appMetadata.store_ids ?? parsed.storeIds ?? parsed.store_ids ?? ''),
    ].join(':');
  } catch {
    return 'unknown';
  }
}

function demoCarrierFromBody(input: { id?: number; body: Record<string, unknown> }, fallback?: CarrierAccount): CarrierAccount {
  const now = new Date().toISOString();
  return {
    id: input.id ?? Math.floor(Date.now() / 1000),
    provider: String(input.body.provider ?? fallback?.provider ?? 'custom_api'),
    label: String(input.body.label ?? fallback?.label ?? 'Store connection'),
    accountIdentifier: String(input.body.accountIdentifier ?? fallback?.accountIdentifier ?? fallback?.account_identifier ?? 'Demo account'),
    active: true,
    createdAt: fallback?.createdAt ?? now,
  };
}

function demoSyncStatus() {
  const now = new Date().toISOString();
  return {
    status: 'done',
    mode: 'demo',
    lastSyncAt: now,
    cadenceMinutes: {
      orders: 3,
      shipments: 3,
      inventoryFromOrders: 30,
      productCatalog: 60,
    },
    orders: { lastSyncedAt: now },
    shipments: { lastSyncedAt: now },
    queue: { enabled: true, started: true },
    worker: { stale: false },
  };
}

function demoBackfillResponse(input: { target: BackfillTarget; mode: BackfillMode }): BackfillResponse {
  const startedAt = new Date().toISOString();
  const targets =
    input.target === 'all'
      ? (['orders', 'shipments', 'inventory-from-orders', 'products'] as const)
      : ([input.target] as const);
  return {
    ok: true,
    target: input.target,
    mode: input.mode,
    startedAt,
    finishedAt: new Date(Date.now() + 450).toISOString(),
    results: targets.map((target) => ({
      target,
      ok: true,
      data: { demo: true, message: `${target} backfill queued` },
    })),
  };
}

export function useDashboardQuery(token: string | null) {
  return useQuery({
    queryKey: portalQueryKeys.dashboard(token),
    enabled: enabled(token),
    queryFn: () => (demoAllowed(token!) ? Promise.resolve(demoDashboard) : portalApi.clientPortal.dashboard(token!)),
    placeholderData: keepPreviousData,
  });
}

export function useDailyCountsQuery(token: string | null) {
  return useQuery({
    queryKey: portalQueryKeys.dailyCounts(token),
    enabled: enabled(token),
    queryFn: () => (demoAllowed(token!) ? Promise.resolve(demoDailyCounts) : portalApi.clientPortal.dailyCounts(token!)),
    placeholderData: keepPreviousData,
  });
}

function demoOrdersForStatus(status: OrderStatus | 'all') {
  if (status === 'all') return demoOrders;
  const data = demoOrders.data.filter((order) => order.orderStatus === status);
  return {
    ...demoOrders,
    data,
    pagination: demoOrders.pagination
      ? { ...demoOrders.pagination, total: data.length, totalPages: data.length > 0 ? 1 : 0 }
      : undefined,
  };
}

function demoInvoiceDetails() {
  const firstClient = demoBilling.data[0];
  return {
    data: demoOrders.data.map((order, index) => ({
      clientId: firstClient?.clientId ?? order.clientId ?? 1,
      clientName: firstClient?.clientName ?? order.clientName ?? 'DrPrepperUSA',
      orderId: order.id,
      orderNumber: order.orderNumber,
      recipientName: order.shipToName ?? null,
      itemNames: order.items?.map((item) => item.name ?? item.sku).filter(Boolean).join(' | ') ?? null,
      shipDate: order.orderDate,
      qty: order.items?.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0) ?? 1,
      pickpackTotal: index === 0 ? '4.00' : '3.50',
      additionalTotal: '0.00',
      packageTotal: index === 0 ? '1.25' : '0.00',
      shippingTotal: index === 0 ? '7.80' : '6.40',
      storageTotal: '0.00',
      rowTotal: index === 0 ? '13.05' : '9.90',
    })),
  };
}

export function useOrdersQuery(token: string | null, status: OrderStatus | 'all' = 'all') {
  return useQuery({
    queryKey: portalQueryKeys.orders(token, status),
    enabled: enabled(token),
    queryFn: () => (demoAllowed(token!) ? Promise.resolve(demoOrdersForStatus(status)) : portalApi.clientPortal.orders(token!, { status })),
  });
}

export function useShipmentsQuery(token: string | null) {
  return useQuery({
    queryKey: portalQueryKeys.shipments(token),
    enabled: enabled(token),
    queryFn: () => (demoAllowed(token!) ? Promise.resolve(demoShipments) : portalApi.clientPortal.shipments(token!)),
    placeholderData: keepPreviousData,
  });
}

export function useInventoryQuery(token: string | null) {
  return useQuery({
    queryKey: portalQueryKeys.inventory(token),
    enabled: enabled(token),
    queryFn: () => (demoAllowed(token!) ? Promise.resolve(demoInventory) : portalApi.clientPortal.inventory(token!)),
    placeholderData: keepPreviousData,
  });
}

export function useBillingQuery(token: string | null, range = defaultRange()) {
  return useQuery({
    queryKey: portalQueryKeys.billing(token, range),
    enabled: enabled(token),
    queryFn: () => (demoAllowed(token!) ? Promise.resolve(demoBilling) : portalApi.clientPortal.billingSummary(token!, range)),
    placeholderData: keepPreviousData,
  });
}

export function useInvoiceDetailsQuery(token: string | null, range = defaultRange()) {
  return useQuery({
    queryKey: portalQueryKeys.invoiceDetails(token, range),
    enabled: enabled(token),
    queryFn: () =>
      demoAllowed(token!)
        ? Promise.resolve(demoInvoiceDetails())
        : portalApi.clientPortal.invoiceDetails(token!, {
          dateFrom: `${range.from}T00:00:00.000Z`,
          dateTo: `${range.to}T23:59:59.999Z`,
        }),
    placeholderData: keepPreviousData,
  });
}

export function useClientsQuery(token: string | null) {
  return useQuery({
    queryKey: portalQueryKeys.clients(token),
    enabled: enabled(token),
    queryFn: () =>
      demoAllowed(token!)
        ? Promise.resolve({ data: [{ id: 1, name: 'DrPrepperUSA', active: true }] })
        : portalApi.clientPortal.clients(token!),
    placeholderData: keepPreviousData,
  });
}

export function useSettingsQuery(token: string | null) {
  return useQuery({
    queryKey: portalQueryKeys.settings(token),
    enabled: enabled(token),
    queryFn: () =>
      demoAllowed(token!)
        ? Promise.resolve({ data: [{ key: 'defaultView', value: 'dashboard' }, { key: 'pageSize', value: '25' }] })
        : portalApi.clientPortal.settings(token!),
    placeholderData: keepPreviousData,
  });
}

export function useMeQuery(token: string | null) {
  return useQuery({
    queryKey: portalQueryKeys.me(token),
    enabled: enabled(token),
    queryFn: () =>
      demoAllowed(token!)
        ? Promise.resolve({ id: 'demo-client-user', email: 'client@drprepperusa.org', isAdmin: true })
        : portalApi.clientPortal.me(token!),
    placeholderData: keepPreviousData,
  });
}

export function useSyncStatusQuery(token: string | null) {
  return useQuery({
    queryKey: portalQueryKeys.syncStatus(token),
    enabled: enabled(token),
    queryFn: () => (demoAllowed(token!) ? Promise.resolve(demoSyncStatus()) : portalApi.clientPortal.syncStatus(token!)),
    placeholderData: keepPreviousData,
  });
}

export function useProductsQuery(token: string | null) {
  return useQuery({
    queryKey: portalQueryKeys.products(token),
    enabled: enabled(token),
    queryFn: () =>
      demoAllowed(token!)
        ? Promise.resolve({ data: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 } })
        : portalApi.products(token!),
    placeholderData: keepPreviousData,
  });
}

export function useAnalysisOverviewQuery(token: string | null) {
  return useQuery({
    queryKey: portalQueryKeys.analysisOverview(token),
    enabled: enabled(token),
    queryFn: () =>
      demoAllowed(token!)
        ? Promise.resolve({ ordersToday: 2, ordersWeek: 18, shippedToday: 3, shippedWeek: 25 })
        : portalApi.clientPortal.analysisOverview(token!),
    placeholderData: keepPreviousData,
  });
}

export function useAnalysisSkuBreakdownQuery(token: string | null, range?: { from: string; to: string }) {
  return useQuery({
    queryKey: [...portalQueryKeys.analysisSkuBreakdown(token), range?.from ?? 'default', range?.to ?? 'default'] as const,
    enabled: enabled(token),
    queryFn: () =>
      demoAllowed(token!)
        ? Promise.resolve(demoAnalysisSkuBreakdown)
        : portalApi.clientPortal.skuBreakdown(token!, range),
    placeholderData: keepPreviousData,
  });
}

export function useAnalysisSkuOrdersQuery(token: string | null, inventoryId: number | null, range?: { from: string; to: string }) {
  return useQuery({
    queryKey: portalQueryKeys.analysisSkuOrders(token, inventoryId, range),
    enabled: enabled(token) && inventoryId !== null,
    queryFn: () =>
      demoAllowed(token!)
        ? Promise.resolve({ sku: '', totalUnits: 0, standardShipCount: 0, standardShippingTotal: 0, avgStandardShippingCost: 0, dailySales: [], orders: [] })
        : portalApi.skuOrders(token!, inventoryId!, range),
    placeholderData: keepPreviousData,
  });
}

export function useDailyShipmentsQuery(token: string | null) {
  return useQuery({
    queryKey: portalQueryKeys.dailyShipments(token),
    enabled: enabled(token),
    queryFn: () =>
      demoAllowed(token!)
        ? Promise.resolve({ data: [{ day: '2026-05-25', shipments: 3 }, { day: '2026-05-24', shipments: 5 }] })
        : portalApi.clientPortal.dailyShipments(token!),
    placeholderData: keepPreviousData,
  });
}

export function useCarrierAccountsQuery(token: string | null) {
  return useQuery({
    queryKey: portalQueryKeys.carrierAccounts(token),
    enabled: enabled(token),
    queryFn: () =>
      demoAllowed(token!)
        ? Promise.resolve({ data: [{ id: 1, provider: 'walmart', label: 'Walmart Marketplace', accountIdentifier: 'Walmart Seller (b05d64...)', active: true, createdAt: '2026-05-06T00:00:00.000Z' }] })
        : portalApi.clientPortal.integrations(token!),
    placeholderData: keepPreviousData,
  });
}

export function useSaveCarrierAccountMutation(token: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: number; body: Record<string, unknown> }) => {
      if (!token) throw new Error('Missing portal session');
      if (demoAllowed(token)) {
        const existing = client
          .getQueryData<{ data: CarrierAccount[] }>(portalQueryKeys.carrierAccounts(token))
          ?.data.find((account: CarrierAccount) => account.id === input.id);
        return { data: demoCarrierFromBody(input, existing) };
      }
      if (input.id) return portalApi.updateCarrierAccount(token, input.id, input.body);
      return portalApi.addCarrierAccount(token, input.body);
    },
    onSuccess: (result, input) => {
      const saved = result.data;
      if (token && demoAllowed(token) && saved) {
        client.setQueryData<{ data: CarrierAccount[] }>(portalQueryKeys.carrierAccounts(token), (previous) => {
          const rows = previous?.data ?? [];
          if (input.id) {
            return { data: rows.map((account) => (account.id === input.id ? { ...account, ...saved } : account)) };
          }
          return { data: [...rows, saved] };
        });
        return;
      }
      void client.invalidateQueries({ queryKey: portalQueryKeys.carrierAccounts(token) });
      void client.invalidateQueries({ queryKey: portalQueryKeys.dashboard(token) });
    },
  });
}

export function useDeleteCarrierAccountMutation(token: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      if (!token) throw new Error('Missing portal session');
      if (demoAllowed(token)) return { data: { id, deleted: true } };
      return portalApi.deleteCarrierAccount(token, id);
    },
    onSuccess: (_result, id) => {
      if (token && demoAllowed(token)) {
        client.setQueryData<{ data: CarrierAccount[] }>(portalQueryKeys.carrierAccounts(token), (previous) => ({
          data: (previous?.data ?? []).filter((account) => account.id !== id),
        }));
        return;
      }
      void client.invalidateQueries({ queryKey: portalQueryKeys.carrierAccounts(token) });
      void client.invalidateQueries({ queryKey: portalQueryKeys.dashboard(token) });
    },
  });
}

export function useSetSettingMutation(token: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { key: string; value: string }) => {
      if (!token) throw new Error('Missing portal session');
      if (demoAllowed(token)) return { key: input.key, value: input.value };
      return portalApi.setSetting(token, input.key, input.value);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: portalQueryKeys.settings(token) });
    },
  });
}

export function useBackfillMutation(token: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { target: BackfillTarget; mode: BackfillMode; pageSize?: number }) => {
      if (!token) throw new Error('Missing portal session');
      if (demoAllowed(token)) return demoBackfillResponse(input);
      return portalApi.clientPortal.backfill(token, input);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: portalQueryKeys.syncStatus(token) });
      void client.invalidateQueries({ queryKey: portalQueryKeys.dashboard(token) });
      void client.invalidateQueries({ queryKey: portalQueryKeys.dailyCounts(token) });
      void client.invalidateQueries({ queryKey: portalQueryKeys.orders(token, 'all') });
      void client.invalidateQueries({ queryKey: portalQueryKeys.shipments(token) });
      void client.invalidateQueries({ queryKey: portalQueryKeys.inventory(token) });
      void client.invalidateQueries({ queryKey: portalQueryKeys.products(token) });
      void client.invalidateQueries({ queryKey: portalQueryKeys.analysisOverview(token) });
      void client.invalidateQueries({ queryKey: portalQueryKeys.dailyShipments(token) });
    },
  });
}
