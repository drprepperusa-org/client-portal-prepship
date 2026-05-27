import type {
  BillingInvoiceDetailRow,
  BillingSummaryRow,
  AnalysisSkuBreakdown,
  AnalysisSkuOrdersResponse,
  CarrierAccount,
  DashboardSummary,
  OrderStatus,
  Paginated,
  PortalClient,
  PortalInventoryItem,
  PortalOrder,
  PortalSetting,
  PortalShipment,
} from '../types/portal';
import { portalScopeFromToken } from './portalScope';

const PRODUCTION_API_BASE = 'https://prepshipv4-api-l5xc.onrender.com';
const DEV_API_PORT = 3000;

const configuredApiBase = (
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (import.meta.env.VITE_API_BASE_URL as string | undefined)
)?.trim();

const appHostname =
  typeof globalThis.location?.hostname === 'string'
    ? globalThis.location.hostname
    : 'localhost';
const appProtocol =
  typeof globalThis.location?.protocol === 'string'
    ? globalThis.location.protocol
    : 'http:';
const appOrigin =
  typeof globalThis.location?.origin === 'string' ? globalThis.location.origin : '';

const configuredIsLocal =
  configuredApiBase != null &&
  /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(configuredApiBase);
const configuredIsAppOrigin =
  configuredApiBase != null &&
  appOrigin !== '' &&
  configuredApiBase.replace(/\/+$/, '') === appOrigin.replace(/\/+$/, '');

const resolvedApiBase =
  configuredApiBase &&
  !(import.meta.env.PROD && configuredIsLocal) &&
  !(import.meta.env.PROD && configuredIsAppOrigin)
    ? configuredApiBase
    : import.meta.env.PROD
      ? PRODUCTION_API_BASE
      : `${appProtocol}//${appHostname}:${DEV_API_PORT}`;

export const API_BASE = resolvedApiBase.replace(/\/+$/, '');

type QueryValue = string | number | boolean | null | undefined;
const API_TIMEOUT_MS = 15000;
const BACKFILL_TIMEOUT_MS = 120000;

export type BackfillTarget = 'orders' | 'shipments' | 'inventory-from-orders' | 'products' | 'all';
export type BackfillMode = 'incremental' | 'full';

export type BackfillStepResult = {
  target: Exclude<BackfillTarget, 'all'>;
  ok: boolean;
  data?: unknown;
  error?: string;
};

export type BackfillResponse = {
  ok: boolean;
  target: BackfillTarget;
  mode: BackfillMode;
  startedAt: string;
  finishedAt: string;
  results: BackfillStepResult[];
};

export type PortalMe = {
  id: string | null;
  email: string | null;
  isAdmin: boolean;
  isGlobal?: boolean;
  isRestricted?: boolean;
  role?: string | null;
  clientIds?: number[];
  storeIds?: number[];
  permissions?: string[];
  canViewFinancials?: boolean;
  canViewCredentials?: boolean;
};

function queryString(params: Record<string, QueryValue>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const out = search.toString();
  return out ? `?${out}` : '';
}

function firstScopedStoreId(token: string) {
  const scope = portalScopeFromToken(token);
  return scope.isRestricted && scope.storeIds.length === 1 ? scope.storeIds[0] : undefined;
}

async function apiGetScopedByClient<T extends { data: unknown[]; pagination?: { page: number; pageSize: number; total: number; totalPages: number } }>(
  token: string,
  path: string,
  params: Record<string, QueryValue>,
): Promise<T> {
  const scope = portalScopeFromToken(token);
  if (!scope.isRestricted || scope.clientIds.length <= 1) {
    return apiGet<T>(token, path, {
      ...params,
      clientId: scope.isRestricted ? scope.clientIds[0] : params.clientId,
    });
  }

  const pages = await Promise.all(
    scope.clientIds.map((clientId) => apiGet<T>(token, path, { ...params, clientId })),
  );
  const data = pages.flatMap((page) => page.data);
  const first = pages[0];
  const pageSize = first?.pagination?.pageSize ?? Number(params.pageSize ?? 25);
  const clientTotals = pages.map((page, index) => ({
    clientId: scope.clientIds[index]!,
    total: Number(page.pagination?.total ?? page.data.length ?? 0),
  }));
  const total = clientTotals.reduce((sum, row) => sum + row.total, 0);
  return {
    ...first,
    data,
    pagination: first?.pagination
      ? {
          ...first.pagination,
          total,
          totalPages: total > 0 ? Math.ceil(total / pageSize) : 0,
          clientTotals,
        }
      : first?.pagination,
  } as T;
}

async function apiGetScopedDashboard(token: string, path: string, params: Record<string, QueryValue>) {
  const scope = portalScopeFromToken(token);
  if (!scope.isRestricted) return apiGet<DashboardSummary>(token, path, params);
  if (!scope.clientIds.length && !scope.storeIds.length) {
    return { revenue: 0, units: 0, bySku: [], dailyRevenue: [] };
  }

  const scopedIds = scope.clientIds.length ? scope.clientIds : [undefined];
  const pages = await Promise.all(
    scopedIds.map((clientId) =>
      apiGet<DashboardSummary>(token, path, {
        ...params,
        clientId,
        storeId: clientId === undefined ? firstScopedStoreId(token) : undefined,
      }),
    ),
  );

  return pages.reduce<DashboardSummary>(
    (total, page) => ({
      revenue: Number(total.revenue ?? 0) + Number(page.revenue ?? 0),
      units: Number(total.units ?? 0) + Number(page.units ?? 0),
      bySku: [...(total.bySku ?? []), ...(page.bySku ?? [])],
      dailyRevenue: [...(total.dailyRevenue ?? []), ...(page.dailyRevenue ?? [])],
    }),
    { revenue: 0, units: 0, bySku: [], dailyRevenue: [] },
  );
}

async function apiGetScopedDailyCounts(token: string, path: string, params: Record<string, QueryValue>) {
  const scope = portalScopeFromToken(token);
  if (!scope.isRestricted) {
    return apiGet<{ data: Array<{ day: string; awaiting: number; shipped: number; cancelled: number; total: number }> }>(
      token,
      path,
      params,
    );
  }
  if (!scope.clientIds.length && !scope.storeIds.length) return { data: [] };

  const scopedIds = scope.clientIds.length ? scope.clientIds : [undefined];
  const pages = await Promise.all(
    scopedIds.map((clientId) =>
      apiGet<{ data: Array<{ day: string; awaiting: number; shipped: number; cancelled: number; total: number }> }>(
        token,
        path,
        {
          ...params,
          clientId,
          storeId: clientId === undefined ? firstScopedStoreId(token) : undefined,
        },
      ),
    ),
  );
  const byDay = new Map<string, { day: string; awaiting: number; shipped: number; cancelled: number; total: number }>();
  for (const page of pages) {
    for (const row of page.data ?? []) {
      const current = byDay.get(row.day) ?? { day: row.day, awaiting: 0, shipped: 0, cancelled: 0, total: 0 };
      current.awaiting += Number(row.awaiting ?? 0);
      current.shipped += Number(row.shipped ?? 0);
      current.cancelled += Number(row.cancelled ?? 0);
      current.total += Number(row.total ?? 0);
      byDay.set(row.day, current);
    }
  }
  return { data: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)) };
}

async function apiGetScopedBillingSummary(token: string, path: string, params: Record<string, QueryValue>) {
  const scope = portalScopeFromToken(token);
  if (!scope.isRestricted || scope.clientIds.length <= 1) {
    return apiGet<{ data: BillingSummaryRow[]; grandTotal?: number | string }>(token, path, {
      ...params,
      clientId: scope.isRestricted ? scope.clientIds[0] : params.clientId,
    });
  }
  const pages = await Promise.all(
    scope.clientIds.map((clientId) =>
      apiGet<{ data: BillingSummaryRow[]; grandTotal?: number | string }>(token, path, { ...params, clientId }),
    ),
  );
  const data = pages.flatMap((page) => page.data ?? []);
  const grandTotal = data.reduce((sum, row) => sum + Number(row.grandTotal ?? 0), 0);
  return { data, grandTotal };
}

export async function apiGet<T>(
  token: string,
  path: string,
  params: Record<string, QueryValue> = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}${queryString(params)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep the HTTP status message.
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export async function apiSend<T>(
  token: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  params: Record<string, QueryValue> = {},
  timeoutMs = API_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}${queryString(params)}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // Keep the HTTP status message.
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export async function apiText(
  token: string,
  path: string,
  params: Record<string, QueryValue> = {},
): Promise<string> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}${queryString(params)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'text/html,application/pdf,text/plain,*/*',
      },
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // Keep the HTTP status message.
    }
    throw new Error(message);
  }

  return response.text();
}

function localIsoDay(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localDateParts(day: string) {
  const [year, month, date] = day.split('-').map(Number);
  if (!year || !month || !date) return null;
  return { year, month, date };
}

export function defaultRange(days = 30) {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - days);
  return { from: localIsoDay(from), to: localIsoDay(to) };
}

export function localDateTimeRange(range = defaultRange()) {
  const from = localDateParts(range.from);
  const to = localDateParts(range.to);
  if (!from || !to) {
    return {
      dateFrom: `${range.from}T00:00:00.000Z`,
      dateTo: `${range.to}T23:59:59.999Z`,
    };
  }

  return {
    dateFrom: new Date(from.year, from.month - 1, from.date, 0, 0, 0, 0).toISOString(),
    dateTo: new Date(to.year, to.month - 1, to.date, 23, 59, 59, 999).toISOString(),
  };
}

export const portalApi = {
  clientPortal: {
    me(token: string) {
      return apiGet<PortalMe>(token, '/api/client-portal/me');
    },
    clients(token: string) {
      return apiGet<Array<PortalClient> | { data: PortalClient[] }>(token, '/api/client-portal/clients');
    },
    settings(token: string) {
      return apiGet<{ data: PortalSetting[] }>(token, '/api/client-portal/settings');
    },
    syncStatus(token: string) {
      return apiGet<Record<string, unknown>>(token, '/api/client-portal/sync-status');
    },
    backfill(token: string, body: { target: BackfillTarget; mode: BackfillMode; pageSize?: number }) {
      return apiSend<BackfillResponse>(token, 'POST', '/api/client-portal/backfill', body, {}, BACKFILL_TIMEOUT_MS);
    },
    dashboard(token: string, range = defaultRange()) {
      return apiGetScopedDashboard(token, '/api/client-portal/dashboard', range);
    },
    dailyCounts(token: string, range = defaultRange()) {
      return apiGetScopedDailyCounts(
        token,
        '/api/client-portal/daily-counts',
        range,
      );
    },
    orders(token: string, options: { status?: OrderStatus | 'all'; search?: string; page?: number } = {}) {
      return apiGetScopedByClient<Paginated<PortalOrder>>(token, '/api/client-portal/orders', {
        page: options.page ?? 1,
        pageSize: 25,
        includeTotal: true,
        status: options.status === 'all' ? undefined : options.status,
        search: options.search,
        storeId: firstScopedStoreId(token),
      });
    },
    shipments(token: string, options: { page?: number } = {}) {
      return apiGetScopedByClient<Paginated<PortalShipment>>(token, '/api/client-portal/shipments', {
        page: options.page ?? 1,
        pageSize: 25,
        voided: false,
      });
    },
    inventory(token: string, options: { search?: string; lowStock?: boolean; page?: number } = {}) {
      return apiGetScopedByClient<Paginated<PortalInventoryItem>>(token, '/api/client-portal/inventory', {
        page: options.page ?? 1,
        pageSize: 25,
        search: options.search,
        lowStock: options.lowStock,
        active: true,
      });
    },
    billingSummary(token: string, range = defaultRange()) {
      const { dateFrom, dateTo } = localDateTimeRange(range);
      return apiGetScopedBillingSummary(
        token,
        '/api/client-portal/reports',
        { dateFrom, dateTo },
      );
    },
    analysisOverview(token: string) {
      return apiGet<Record<string, unknown>>(token, '/api/client-portal/analysis');
    },
    skuBreakdown(token: string, range = defaultRange()) {
      const { dateFrom, dateTo } = localDateTimeRange(range);
      return apiGetScopedByClient<AnalysisSkuBreakdown>(token, '/api/client-portal/analysis', {
        dateFrom,
        dateTo,
        limit: 200,
        storeId: firstScopedStoreId(token),
      });
    },
    dailyShipments(token: string, range = defaultRange()) {
      const { dateFrom, dateTo } = localDateTimeRange(range);
      return apiGet<Array<Record<string, unknown>> | { data: Array<Record<string, unknown>> }>(
        token,
        '/api/client-portal/daily-shipments',
        {
          dateFrom,
          dateTo,
        },
      );
    },
    integrations(token: string) {
      return apiGetScopedByClient<{ data: CarrierAccount[] }>(token, '/api/client-portal/integrations', {});
    },
    activity(token: string) {
      return apiGet<{ data: Array<Record<string, unknown>> }>(token, '/api/client-portal/activity');
    },
    invoice(token: string, params: { clientId: number; dateFrom: string; dateTo: string }) {
      return apiText(token, '/api/client-portal/invoice', params);
    },
    invoiceDetails(token: string, params: { dateFrom: string; dateTo: string; clientId?: number }) {
      return apiGet<{ data: BillingInvoiceDetailRow[] }>(
        token,
        '/api/client-portal/invoice-details',
        params,
      );
    },
    updateInvoiceDetail(
      token: string,
      orderId: number,
      body: {
        clientId: number;
        pickPack?: number;
        additional?: number;
        packageCost?: number;
        shipping?: number;
        dateFrom?: string;
        dateTo?: string;
      },
    ) {
      return apiSend<{ ok: boolean; orderId: number; clientId: number; updated: number; inserted: number }>(
        token,
        'PATCH',
        `/billing/details/${orderId}`,
        body,
      );
    },
  },
  dashboard(token: string, range = defaultRange()) {
    return apiGet<DashboardSummary>(token, '/dashboard/summary', range);
  },
  dailyCounts(token: string, range = defaultRange()) {
    return apiGet<{ data: Array<{ day: string; awaiting: number; shipped: number; cancelled: number; total: number }> }>(
      token,
      '/dashboard/daily-counts',
      range,
    );
  },
  orders(token: string, options: { status?: OrderStatus | 'all'; search?: string; page?: number } = {}) {
    return apiGet<Paginated<PortalOrder>>(token, '/orders', {
      page: options.page ?? 1,
      pageSize: 25,
      includeTotal: true,
      status: options.status === 'all' ? undefined : options.status,
      search: options.search,
    });
  },
  shipments(token: string, options: { page?: number } = {}) {
    return apiGet<Paginated<PortalShipment>>(token, '/shipments', {
      page: options.page ?? 1,
      pageSize: 25,
      voided: false,
    });
  },
  inventory(token: string, options: { search?: string; lowStock?: boolean; page?: number } = {}) {
    return apiGet<Paginated<PortalInventoryItem>>(token, '/inventory', {
      page: options.page ?? 1,
      pageSize: 25,
      search: options.search,
      lowStock: options.lowStock,
      active: true,
    });
  },
  billingSummary(token: string, range = defaultRange()) {
    const { dateFrom, dateTo } = localDateTimeRange(range);
    return apiGet<{ data: BillingSummaryRow[]; clients?: BillingSummaryRow[]; grandTotal?: number | string }>(
      token,
      '/billing/summary',
      { dateFrom, dateTo },
    );
  },
  clients(token: string) {
    return apiGet<Array<PortalClient> | { data: PortalClient[] }>(token, '/clients', {
      activeOnly: true,
      page: 1,
      pageSize: 200,
      lightweight: true,
    });
  },
  settings(token: string) {
    return apiGet<{ data: PortalSetting[] }>(token, '/settings');
  },
  me(token: string) {
    return apiGet<PortalMe>(token, '/users/me');
  },
  setSetting(token: string, key: string, value: string) {
    return apiSend<PortalSetting>(token, 'PUT', `/settings/${encodeURIComponent(key)}`, { value });
  },
  syncStatus(token: string) {
    return apiGet<Record<string, unknown>>(token, '/sync/status');
  },
  backfill(token: string, body: { target: BackfillTarget; mode: BackfillMode; pageSize?: number }) {
    return apiSend<BackfillResponse>(token, 'POST', '/sync/backfill', body, {}, BACKFILL_TIMEOUT_MS);
  },
  products(token: string) {
    return apiGet<Paginated<Record<string, unknown>>>(token, '/products', {
      page: 1,
      pageSize: 50,
    });
  },
  analysisOverview(token: string) {
    return apiGet<Record<string, unknown>>(token, '/analysis/overview');
  },
  skuBreakdown(token: string, range = defaultRange()) {
    const { dateFrom, dateTo } = localDateTimeRange(range);
    return apiGet<AnalysisSkuBreakdown>(token, '/analysis/sku-breakdown', {
      dateFrom,
      dateTo,
      limit: 200,
    });
  },
  skuOrders(token: string, inventoryId: number, range = defaultRange()) {
    const { dateFrom, dateTo } = localDateTimeRange(range);
    return apiGet<AnalysisSkuOrdersResponse>(token, `/inventory/${inventoryId}/sku-orders`, {
      dateFrom,
      dateTo,
    });
  },
  dailyShipments(token: string, range = defaultRange()) {
    const { dateFrom, dateTo } = localDateTimeRange(range);
    return apiGet<Array<Record<string, unknown>> | { data: Array<Record<string, unknown>> }>(
      token,
      '/analysis/daily-shipments',
      {
        dateFrom,
        dateTo,
      },
    );
  },
  carrierAccounts(token: string) {
    return apiGet<{ data: CarrierAccount[] }>(token, '/carrier-accounts');
  },
  addCarrierAccount(token: string, body: Record<string, unknown>) {
    return apiSend<{ data: CarrierAccount | null }>(token, 'POST', '/carrier-accounts', body);
  },
  updateCarrierAccount(token: string, id: number, body: Record<string, unknown>) {
    return apiSend<{ data: CarrierAccount | null }>(token, 'PATCH', '/carrier-accounts', body, { id });
  },
  deleteCarrierAccount(token: string, id: number) {
    return apiSend<{ data?: unknown; deleted?: boolean }>(token, 'DELETE', '/carrier-accounts', undefined, { id });
  },
};

export function safeMoney(value: unknown) {
  const amount = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isFinite(amount)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

export function safeNumber(value: unknown) {
  const amount = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isFinite(amount)) return '0';
  return new Intl.NumberFormat('en-US').format(amount);
}

export function safeDate(value: string | null | undefined) {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}
