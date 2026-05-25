import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { portalApi } from './api';
import {
  DEMO_TOKEN,
  demoBilling,
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
  dashboard: ['portal', 'dashboard'] as const,
  dailyCounts: ['portal', 'daily-counts'] as const,
  orders: (status?: OrderStatus | 'all') => ['portal', 'orders', status ?? 'all'] as const,
  shipments: ['portal', 'shipments'] as const,
  inventory: ['portal', 'inventory'] as const,
  billing: ['portal', 'billing'] as const,
  clients: ['portal', 'clients'] as const,
  settings: ['portal', 'settings'] as const,
  products: ['portal', 'products'] as const,
  analysisOverview: ['portal', 'analysis-overview'] as const,
  dailyShipments: ['portal', 'daily-shipments'] as const,
  carrierAccounts: ['portal', 'carrier-accounts'] as const,
};

function demoAllowed(token: string) {
  return token === DEMO_TOKEN && import.meta.env.VITE_ENABLE_DEMO === 'true';
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

export function useDashboardQuery(token: string | null) {
  return useQuery({
    queryKey: portalQueryKeys.dashboard,
    enabled: enabled(token),
    queryFn: () => (demoAllowed(token!) ? Promise.resolve(demoDashboard) : portalApi.dashboard(token!)),
    placeholderData: keepPreviousData,
  });
}

export function useDailyCountsQuery(token: string | null) {
  return useQuery({
    queryKey: portalQueryKeys.dailyCounts,
    enabled: enabled(token),
    queryFn: () => (demoAllowed(token!) ? Promise.resolve(demoDailyCounts) : portalApi.dailyCounts(token!)),
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

export function useOrdersQuery(token: string | null, status: OrderStatus | 'all' = 'all') {
  return useQuery({
    queryKey: portalQueryKeys.orders(status),
    enabled: enabled(token),
    queryFn: () => (demoAllowed(token!) ? Promise.resolve(demoOrdersForStatus(status)) : portalApi.orders(token!, { status })),
  });
}

export function useShipmentsQuery(token: string | null) {
  return useQuery({
    queryKey: portalQueryKeys.shipments,
    enabled: enabled(token),
    queryFn: () => (demoAllowed(token!) ? Promise.resolve(demoShipments) : portalApi.shipments(token!)),
    placeholderData: keepPreviousData,
  });
}

export function useInventoryQuery(token: string | null) {
  return useQuery({
    queryKey: portalQueryKeys.inventory,
    enabled: enabled(token),
    queryFn: () => (demoAllowed(token!) ? Promise.resolve(demoInventory) : portalApi.inventory(token!)),
    placeholderData: keepPreviousData,
  });
}

export function useBillingQuery(token: string | null) {
  return useQuery({
    queryKey: portalQueryKeys.billing,
    enabled: enabled(token),
    queryFn: () => (demoAllowed(token!) ? Promise.resolve(demoBilling) : portalApi.billingSummary(token!)),
    placeholderData: keepPreviousData,
  });
}

export function useClientsQuery(token: string | null) {
  return useQuery({
    queryKey: portalQueryKeys.clients,
    enabled: enabled(token),
    queryFn: () =>
      demoAllowed(token!)
        ? Promise.resolve({ data: [{ id: 1, name: 'DrPrepperUSA', active: true }] })
        : portalApi.clients(token!),
    placeholderData: keepPreviousData,
  });
}

export function useSettingsQuery(token: string | null) {
  return useQuery({
    queryKey: portalQueryKeys.settings,
    enabled: enabled(token),
    queryFn: () =>
      demoAllowed(token!)
        ? Promise.resolve({ data: [{ key: 'defaultView', value: 'dashboard' }, { key: 'pageSize', value: '25' }] })
        : portalApi.settings(token!),
    placeholderData: keepPreviousData,
  });
}

export function useProductsQuery(token: string | null) {
  return useQuery({
    queryKey: portalQueryKeys.products,
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
    queryKey: portalQueryKeys.analysisOverview,
    enabled: enabled(token),
    queryFn: () =>
      demoAllowed(token!)
        ? Promise.resolve({ ordersToday: 2, ordersWeek: 18, shippedToday: 3, shippedWeek: 25 })
        : portalApi.analysisOverview(token!),
    placeholderData: keepPreviousData,
  });
}

export function useDailyShipmentsQuery(token: string | null) {
  return useQuery({
    queryKey: portalQueryKeys.dailyShipments,
    enabled: enabled(token),
    queryFn: () =>
      demoAllowed(token!)
        ? Promise.resolve({ data: [{ day: '2026-05-25', shipments: 3 }, { day: '2026-05-24', shipments: 5 }] })
        : portalApi.dailyShipments(token!),
    placeholderData: keepPreviousData,
  });
}

export function useCarrierAccountsQuery(token: string | null) {
  return useQuery({
    queryKey: portalQueryKeys.carrierAccounts,
    enabled: enabled(token),
    queryFn: () =>
      demoAllowed(token!)
        ? Promise.resolve({ data: [{ id: 1, provider: 'walmart', label: 'Walmart Marketplace', accountIdentifier: 'Walmart Seller (b05d64...)', active: true, createdAt: '2026-05-06T00:00:00.000Z' }] })
        : portalApi.carrierAccounts(token!),
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
          .getQueryData<{ data: CarrierAccount[] }>(portalQueryKeys.carrierAccounts)
          ?.data.find((account) => account.id === input.id);
        return { data: demoCarrierFromBody(input, existing) };
      }
      if (input.id) return portalApi.updateCarrierAccount(token, input.id, input.body);
      return portalApi.addCarrierAccount(token, input.body);
    },
    onSuccess: (result, input) => {
      const saved = result.data;
      if (token && demoAllowed(token) && saved) {
        client.setQueryData<{ data: CarrierAccount[] }>(portalQueryKeys.carrierAccounts, (previous) => {
          const rows = previous?.data ?? [];
          if (input.id) {
            return { data: rows.map((account) => (account.id === input.id ? { ...account, ...saved } : account)) };
          }
          return { data: [...rows, saved] };
        });
        return;
      }
      void client.invalidateQueries({ queryKey: portalQueryKeys.carrierAccounts });
      void client.invalidateQueries({ queryKey: portalQueryKeys.dashboard });
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
        client.setQueryData<{ data: CarrierAccount[] }>(portalQueryKeys.carrierAccounts, (previous) => ({
          data: (previous?.data ?? []).filter((account) => account.id !== id),
        }));
        return;
      }
      void client.invalidateQueries({ queryKey: portalQueryKeys.carrierAccounts });
      void client.invalidateQueries({ queryKey: portalQueryKeys.dashboard });
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
      void client.invalidateQueries({ queryKey: portalQueryKeys.settings });
    },
  });
}
