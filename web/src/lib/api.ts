import type {
  BillingSummaryRow,
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

function queryString(params: Record<string, QueryValue>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const out = search.toString();
  return out ? `?${out}` : '';
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
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);
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

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function defaultRange(days = 30) {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - days);
  return { from: isoDay(from), to: isoDay(to) };
}

export const portalApi = {
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
    const dateFrom = `${range.from}T00:00:00.000Z`;
    const dateTo = `${range.to}T23:59:59.999Z`;
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
  setSetting(token: string, key: string, value: string) {
    return apiSend<PortalSetting>(token, 'PUT', `/settings/${encodeURIComponent(key)}`, { value });
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
  dailyShipments(token: string, range = defaultRange()) {
    return apiGet<Array<Record<string, unknown>> | { data: Array<Record<string, unknown>> }>(
      token,
      '/analysis/daily-shipments',
      {
        dateFrom: `${range.from}T00:00:00.000Z`,
        dateTo: `${range.to}T23:59:59.999Z`,
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
