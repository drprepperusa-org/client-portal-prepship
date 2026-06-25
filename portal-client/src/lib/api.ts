/**
 * Client-portal API client. Talks to the Hono backend's
 * `/api/client-portal/*` routes (see src/routes/client-portal.ts).
 *
 * Auth: a Supabase JWT access token is sent as `Authorization: Bearer <token>`.
 * In dev the base URL is empty (relative) so requests go same-origin to the
 * Vite dev server, which proxies `/api` → the backend (no CORS). In prod set
 * VITE_API_URL to the absolute API origin.
 *
 * Scope correctness: the backend filters by a SINGLE clientId/storeId param, so
 * for a restricted user with multiple clientIds the frontend fans out one
 * request per client and merges (mirrors web/src/lib/api.ts). Single-client and
 * global users take the plain path with no overhead.
 */
import { portalScopeFromToken } from './portalScope';

const configured = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
export const API_BASE = import.meta.env.DEV ? '' : (configured ?? '').replace(/\/+$/, '');

const TIMEOUT_MS = 15000;

export type QueryValue = string | number | boolean | null | undefined;

export interface Paginated<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

function queryString(params: Record<string, QueryValue>) {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    search.set(k, String(v));
  }
  const out = search.toString();
  return out ? `?${out}` : '';
}

async function request(token: string, path: string, params: Record<string, QueryValue>, accept: string): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${API_BASE}${path}${queryString(params)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: accept },
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timer);
  }
}

async function fail(res: Response): Promise<never> {
  let message = `${res.status} ${res.statusText}`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    /* keep status */
  }
  throw new Error(message);
}

export async function apiGet<T>(token: string, path: string, params: Record<string, QueryValue> = {}): Promise<T> {
  const res = await request(token, path, params, 'application/json');
  if (!res.ok) await fail(res);
  return (await res.json()) as T;
}

export async function apiText(token: string, path: string, params: Record<string, QueryValue> = {}): Promise<string> {
  const res = await request(token, path, params, 'text/html,application/pdf,text/plain,*/*');
  if (!res.ok) await fail(res);
  return res.text();
}

async function apiSend<T>(method: string, token: string, path: string, body: unknown = {}): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) await fail(res);
    return (await res.json()) as T;
  } finally {
    window.clearTimeout(timer);
  }
}

export const apiPost = <T>(token: string, path: string, body: unknown = {}) => apiSend<T>('POST', token, path, body);
export const apiPatch = <T>(token: string, path: string, body: unknown = {}) => apiSend<T>('PATCH', token, path, body);
export const apiPut = <T>(token: string, path: string, body: unknown = {}) => apiSend<T>('PUT', token, path, body);
export const apiDelete = <T>(token: string, path: string, body: unknown = {}) => apiSend<T>('DELETE', token, path, body);

/* ---------- Portal DTO types (mirror src/lib/client-portal/dto.ts) ---------- */
export interface PortalOrder {
  id: number;
  clientId: number | null;
  clientName: string | null;
  storeId: number | null;
  storeName: string | null;
  orderNumber: string | null;
  externalOrderId: string | null;
  sourceProvider: string | null;
  orderStatus: string | null;
  orderDate: string | null;
  shipToName: string | null;
  shipToCity: string | null;
  shipToState: string | null;
  carrierCode: string | null;
  serviceCode: string | null;
  trackingNumber: string | null;
  weightOz: number | null;
  shippingAccount?: string | null;
  shippingService?: string | null;
  selectedRate?: {
    carrierCode: string | null;
    serviceCode: string | null;
    serviceName: string | null;
    amount: number | string | null;
    source: 'shipment' | 'selected_rate';
  } | null;
  items: Array<{ sku: string | null; name: string | null; quantity: number | null; imageUrl?: string | null }>;
  orderTotal?: number | string | null;
  shippingAmount?: number | string | null;
  bestRateJson?: Record<string, unknown> | null;
}

export interface PortalShipment {
  id: number;
  orderId: number | null;
  orderNumber: string | null;
  clientName: string | null;
  storeName: string | null;
  carrierCode: string | null;
  serviceCode: string | null;
  trackingNumber: string | null;
  labelTracking: string | null;
  shipDate: string | null;
  voided: boolean | null;
}

export interface PortalInventory {
  id: number;
  clientName: string | null;
  storeName: string | null;
  sku: string | null;
  name: string | null;
  stockQty: number | null;
  reorderLevel: number | null;
  active: boolean | null;
  imageUrl: string | null;
  soldLast30Days: number | string | null;
  effectiveStock: number | null;
  // v4 Stock-Levels parity
  weightOz: number | null;
  length: number | null;
  width: number | null;
  height: number | null;
  cuFt: number | null;
  unitsPerPack: number | null;
  baseUnitQty: number | null;
  totalUnits: number | null;
  packageName: string | null;
  packageLength: number | null;
  packageWidth: number | null;
  packageHeight: number | null;
}

export interface InventoryMovement {
  id: number;
  sku: string | null;
  name: string | null;
  clientName: string | null;
  type: string | null;
  qty: number | null;
  orderId: number | null;
  note: string | null;
  source: string | null;
  createdAt: string | null;
}

export interface PortalIntegration {
  id?: number;
  provider: string | null;
  label: string | null;
  accountIdentifier: string | null;
  source: string | null;
  active: boolean;
  type: string;
  clientName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DashboardSummary {
  revenue: number;
  units: number;
  bySku: Array<{ sku: string; units30: number; units7: number; revenue: number; avgShippingPrice: number | null }>;
  /** Per-day order + shippable-unit counts backing the cumulative bar chart. */
  daily: Array<{ day: string; orders: number; units: number }>;
  dailyRevenue: Array<{ day: string; revenue: number }>;
}

export interface DailyCount {
  day: string;
  awaiting: number;
  shipped: number;
  cancelled: number;
  total: number;
}

export interface PortalMe {
  id: string | null;
  email: string | null;
  role: string | null;
  isAdmin: boolean;
  isGlobal?: boolean;
  isRestricted?: boolean;
  clientIds?: number[];
  storeIds?: number[];
  canViewFinancials?: boolean;
}

export interface PortalClientRow {
  id: number;
  name: string | null;
  email: string | null;
  active: boolean | null;
  storeIds?: number[] | null;
}

export interface PortalAccessUser {
  id: string;
  email: string;
  name: string | null;
  role: string | null;
  permissions: string[];
  isAdmin: boolean;
  isGlobal: boolean;
  /** Hardcoded operator account — cannot be deactivated or deleted. */
  isProtected: boolean;
  /** False when the login is banned/deactivated and cannot sign in. */
  active: boolean;
  clientIds: number[];
  storeIds: number[];
  clients: PortalClientRow[];
  createdAt: string | null;
  lastSignInAt: string | null;
}

export interface AccessUserPatch {
  role?: 'admin' | 'client_user';
  clientIds?: number[];
  displayName?: string;
  active?: boolean;
}

export interface BillingSummaryRow {
  clientId?: number;
  clientName?: string;
  orderCount?: number;
  pickPackTotal?: number | string;
  pickpackTotal?: number | string;
  additionalTotal?: number | string;
  packageTotal?: number | string;
  shippingTotal?: number | string;
  storageTotal?: number | string;
  grandTotal?: number | string;
}

export interface BillingInvoiceDetailRow {
  clientId?: number;
  clientName?: string | null;
  orderId?: number | null;
  orderNumber?: string | null;
  recipientName?: string | null;
  itemNames?: string | null;
  skus?: string | null;
  carrierCode?: string | null;
  boxSize?: string | null;
  shipDate?: string | null;
  qty?: number | string | null;
  pickpackTotal?: number | string | null;
  additionalTotal?: number | string | null;
  packageTotal?: number | string | null;
  shippingTotal?: number | string | null;
  storageTotal?: number | string | null;
  rowTotal?: number | string | null;
}

export interface AnalysisSkuRow {
  sku: string;
  name?: string | null;
  image_url?: string | null;
  inv_sku_id?: number | null;
  client_id?: number | null;
  client_name?: string | null;
  orders?: number | null;
  pending?: number | null;
  ext_shipped?: number | null;
  std_orders?: number | null;
  std_total?: string | null;
  exp_orders?: number | null;
  exp_total?: string | null;
  total_qty?: number | null;
  total_shipping?: string | null;
  total_revenue?: string | null;
  total_selling_fee?: string | null;
  /** Per-day units, aligned to dateBuckets — feeds the Units Trend sparkline. */
  daily_qty?: number[];
}

export interface AnalysisBreakdown {
  data: AnalysisSkuRow[];
  dateBuckets?: string[];
  totalSkus?: number;
  totalOrders?: number;
}

export interface SkuOrderRow {
  order_id: number;
  order_number: string;
  order_date: string | null;
  order_status: string;
  ship_to_name: string | null;
  carrier_code: string | null;
  service_code: string | null;
  qty: number;
  unit_price: string | null;
  item_name: string | null;
  shipping_cost: string | null;
  standard_shipping_cost: string | null;
  is_external_shipped: boolean;
}

export interface PortalInboundItem {
  id: number;
  sku: string | null;
  name: string | null;
  expectedQty: number;
  receivedQty: number;
}
export interface PortalInbound {
  id: number;
  clientId: number | null;
  clientName: string | null;
  reference: string | null;
  supplier: string | null;
  status: string;
  carrier: string | null;
  trackingNumber: string | null;
  expectedDate: string | null;
  receivedDate: string | null;
  notes: string | null;
  createdAt: string | null;
  expectedUnits: number;
  receivedUnits: number;
  items: PortalInboundItem[];
}
export interface NewInboundInput {
  clientId?: number;
  reference?: string;
  supplier?: string;
  status?: string;
  carrier?: string;
  trackingNumber?: string;
  expectedDate?: string;
  notes?: string;
  items?: Array<{ sku?: string; name?: string; expectedQty?: number }>;
}

export interface SkuOrdersResult {
  sku: string;
  name: string | null;
  totalUnits: number;
  standardShipCount: number;
  avgStandardShippingCost: string;
  dailySales: Array<{ day: string; units: number }>;
  orders: SkuOrderRow[];
}

export interface SyncStatus {
  status?: string;
  lastSyncAt?: string | null;
  orders?: Record<string, unknown>;
  shipments?: Record<string, unknown>;
  worker?: Record<string, unknown>;
}

/** Progress of a best-rate backfill job (mirror of the scope-safe API projection). */
export interface BackfillJob {
  jobId: string;
  status: 'pending' | 'running' | 'done' | 'error';
  total: number;
  processed: number;
  updated: number;
  skipped: number;
  failed: number;
  message: string;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  failureSamples?: string[];
}

export interface ListOpts {
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  /** Explicit client filter (from the client switcher). Overrides scope fan-out. */
  clientId?: number;
  /** Inventory only: show only low/out-of-stock SKUs (server-side, all pages). */
  lowStock?: boolean;
}

function defaultRange(days = 30) {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - days);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return { from: day(from), to: day(to) };
}

function rangeToTimestamps(r = defaultRange()) {
  return { dateFrom: `${r.from}T00:00:00.000Z`, dateTo: `${r.to}T23:59:59.999Z` };
}

/** First store id when the session is scoped to exactly one store. */
function firstStoreId(token: string): number | undefined {
  const s = portalScopeFromToken(token);
  return s.isRestricted && s.storeIds.length === 1 ? s.storeIds[0] : undefined;
}

/**
 * GET a paginated list, fanning out per client when a restricted user has >1
 * client (the API filters by a single clientId), then merging data + totals.
 */
async function scopedList<T>(token: string, path: string, params: Record<string, QueryValue>): Promise<Paginated<T>> {
  // ONE request — the backend scopes every list by the caller's full JWT
  // client/store scope (order/shipment/inventoryScopePredicate all use
  // inArray(scope.clientIds)) and paginates the union server-side. Pass an
  // explicit clientId only when the top-bar switcher set one (it can only narrow,
  // never widen); a single-store session still pins its store.
  //
  // This previously fanned out one request per client and concatenated the pages
  // for restricted multi-client users — which made a single page render up to
  // N×pageSize rows while the pager reported pageSize 50 + a summed total, so
  // page counts and boundaries never lined up. Server-side pagination is correct.
  return apiGet<Paginated<T>>(token, path, {
    ...params,
    storeId: params.storeId ?? firstStoreId(token),
  });
}

async function scopedDashboard(token: string, days: number, clientId?: number): Promise<DashboardSummary> {
  const scope = portalScopeFromToken(token);
  const range = defaultRange(days);
  // Explicit client filter from the top-bar switcher → one scoped request for
  // that client. The backend re-checks the client against the caller's scope,
  // so passing it can only ever narrow, never widen, visibility.
  if (clientId !== undefined) return apiGet<DashboardSummary>(token, '/api/client-portal/dashboard', { ...range, clientId });
  if (!scope.isRestricted) return apiGet<DashboardSummary>(token, '/api/client-portal/dashboard', range);
  if (!scope.clientIds.length && !scope.storeIds.length) return { revenue: 0, units: 0, bySku: [], daily: [], dailyRevenue: [] };
  const ids = scope.clientIds.length ? scope.clientIds : [undefined];
  const pages = await Promise.all(
    ids.map((clientId) =>
      apiGet<DashboardSummary>(token, '/api/client-portal/dashboard', {
        ...range,
        clientId,
        storeId: clientId === undefined ? firstStoreId(token) : undefined,
      }),
    ),
  );
  // Restricted users with >1 client get one response per client; merge by SKU
  // and by day so a SKU shipped under two clients shows a single combined row
  // (concatenating would duplicate it and skew the Top-SKUs ranking).
  const bySku = new Map<string, DashboardSummary['bySku'][number]>();
  const daily = new Map<string, DashboardSummary['daily'][number]>();
  let revenue = 0;
  let units = 0;
  const dailyRevenueByDay = new Map<string, number>();
  for (const p of pages) {
    revenue += Number(p.revenue ?? 0);
    units += Number(p.units ?? 0);
    for (const d of p.dailyRevenue ?? []) dailyRevenueByDay.set(d.day, (dailyRevenueByDay.get(d.day) ?? 0) + Number(d.revenue ?? 0));
    for (const s of p.bySku ?? []) {
      const cur = bySku.get(s.sku);
      if (!cur) {
        bySku.set(s.sku, { ...s });
        continue;
      }
      cur.avgShippingPrice = blendAvgShipping(cur.avgShippingPrice, cur.units30, s.avgShippingPrice, s.units30);
      cur.units30 += s.units30;
      cur.units7 += s.units7;
      cur.revenue += s.revenue;
    }
    for (const d of p.daily ?? []) {
      const cur = daily.get(d.day);
      if (!cur) daily.set(d.day, { ...d });
      else {
        cur.orders += d.orders;
        cur.units += d.units;
      }
    }
  }
  return {
    revenue,
    units,
    bySku: [...bySku.values()].sort((a, b) => b.units30 - a.units30),
    daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
    dailyRevenue: [...dailyRevenueByDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, revenue]) => ({ day, revenue })),
  };
}

/**
 * Units-weighted blend of two per-unit average shipping prices when the same
 * SKU appears across multiple client responses. Exact when every unit carried
 * shipping; an acceptable approximation for the rare restricted multi-client
 * fan-out (single-client / global users take the exact single-response path and
 * never reach here). `null` on either side means "no shipping data for that
 * slice" and is skipped rather than counted as $0.
 */
function blendAvgShipping(a: number | null, aUnits: number, b: number | null, bUnits: number): number | null {
  if (a == null) return b;
  if (b == null) return a;
  const denom = aUnits + bUnits;
  return denom > 0 ? (a * aUnits + b * bUnits) / denom : null;
}

async function scopedDailyCounts(token: string, days: number, clientId?: number): Promise<{ data: DailyCount[] }> {
  const scope = portalScopeFromToken(token);
  const range = defaultRange(days);
  // Explicit client filter from the top-bar switcher → one scoped request.
  if (clientId !== undefined) return apiGet<{ data: DailyCount[] }>(token, '/api/client-portal/daily-counts', { ...range, clientId });
  if (!scope.isRestricted) return apiGet<{ data: DailyCount[] }>(token, '/api/client-portal/daily-counts', range);
  if (!scope.clientIds.length && !scope.storeIds.length) return { data: [] };
  const ids = scope.clientIds.length ? scope.clientIds : [undefined];
  const pages = await Promise.all(
    ids.map((clientId) =>
      apiGet<{ data: DailyCount[] }>(token, '/api/client-portal/daily-counts', {
        ...range,
        clientId,
        storeId: clientId === undefined ? firstStoreId(token) : undefined,
      }),
    ),
  );
  const byDay = new Map<string, DailyCount>();
  for (const p of pages) {
    for (const r of p.data ?? []) {
      const cur = byDay.get(r.day) ?? { day: r.day, awaiting: 0, shipped: 0, cancelled: 0, total: 0 };
      cur.awaiting += Number(r.awaiting ?? 0);
      cur.shipped += Number(r.shipped ?? 0);
      cur.cancelled += Number(r.cancelled ?? 0);
      cur.total += Number(r.total ?? 0);
      byDay.set(r.day, cur);
    }
  }
  return { data: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)) };
}

async function scopedReports(token: string, days: number) {
  const scope = portalScopeFromToken(token);
  const range = rangeToTimestamps(defaultRange(days));
  type Resp = { data: BillingSummaryRow[]; clients?: BillingSummaryRow[]; grandTotal?: number | string; billingVisible?: boolean };
  if (!scope.isRestricted || scope.clientIds.length <= 1) {
    return apiGet<Resp>(token, '/api/client-portal/reports', { ...range, clientId: scope.isRestricted ? scope.clientIds[0] : undefined });
  }
  const pages = await Promise.all(scope.clientIds.map((clientId) => apiGet<Resp>(token, '/api/client-portal/reports', { ...range, clientId })));
  const data = pages.flatMap((p) => p.data ?? p.clients ?? []);
  const grandTotal = data.reduce((n, r) => n + Number(r.grandTotal ?? 0), 0);
  return { data, clients: data, grandTotal, billingVisible: pages[0]?.billingVisible ?? true };
}

async function scopedReportsRange(token: string, dateFrom: string, dateTo: string) {
  const scope = portalScopeFromToken(token);
  const range = { dateFrom: `${dateFrom}T00:00:00.000Z`, dateTo: `${dateTo}T23:59:59.999Z` };
  type Resp = { data: BillingSummaryRow[]; clients?: BillingSummaryRow[]; grandTotal?: number | string; billingVisible?: boolean };
  if (!scope.isRestricted || scope.clientIds.length <= 1) {
    return apiGet<Resp>(token, '/api/client-portal/reports', { ...range, clientId: scope.isRestricted ? scope.clientIds[0] : undefined });
  }
  const pages = await Promise.all(scope.clientIds.map((clientId) => apiGet<Resp>(token, '/api/client-portal/reports', { ...range, clientId })));
  const data = pages.flatMap((p) => p.data ?? p.clients ?? []);
  const grandTotal = data.reduce((n, r) => n + Number(r.grandTotal ?? 0), 0);
  return { data, clients: data, grandTotal, billingVisible: pages[0]?.billingVisible ?? true };
}

export const portalApi = {
  me: (token: string) => apiGet<PortalMe>(token, '/api/client-portal/me'),
  clients: (token: string) => apiGet<{ data: PortalClientRow[] }>(token, '/api/client-portal/clients'),
  accessList: (token: string) => apiGet<{ data: PortalAccessUser[] }>(token, '/api/client-portal/access-list'),
  updateAccessUser: (token: string, id: string, patch: AccessUserPatch) =>
    apiPatch<{ ok: true }>(token, `/api/client-portal/access-list/${id}`, patch),
  deleteAccessUser: (token: string, id: string) =>
    apiDelete<{ ok: true }>(token, `/api/client-portal/access-list/${id}`),
  syncStatus: (token: string) => apiGet<SyncStatus>(token, '/api/client-portal/sync-status'),

  /** Trigger a best-rate backfill (rate quotes only; additive). Admin/scoped. */
  backfillRates: (token: string, opts: { clientId?: number; limit?: number; maxAgeHours?: number } = {}) =>
    apiPost<{ jobId: string; status: string; job: BackfillJob | null }>(token, '/api/client-portal/backfill', opts),
  backfillStatus: (token: string) =>
    apiGet<{ job: BackfillJob | null }>(token, '/api/client-portal/backfill/status'),

  dashboard: (token: string, days = 30, clientId?: number) => scopedDashboard(token, days, clientId),
  dailyCounts: (token: string, days = 30, clientId?: number) => scopedDailyCounts(token, days, clientId),
  dailyShipments: (token: string, days = 30, clientId?: number) =>
    apiGet<{ data: Array<{ day: string; shipments: number }> }>(token, '/api/client-portal/daily-shipments', {
      ...rangeToTimestamps(defaultRange(days)),
      // Explicit client filter overrides the single-store fallback; otherwise
      // keep restricting a single-store session to its store.
      clientId,
      storeId: clientId === undefined ? firstStoreId(token) : undefined,
    }),

  orders: (token: string, opts: ListOpts = {}) =>
    scopedList<PortalOrder>(token, '/api/client-portal/orders', {
      page: opts.page ?? 1,
      pageSize: opts.pageSize ?? 50,
      status: opts.status && opts.status !== 'all' ? opts.status : undefined,
      search: opts.search,
      clientId: opts.clientId,
    }),
  order: (token: string, id: number) => apiGet<{ data: PortalOrder }>(token, `/api/client-portal/orders/${id}`),
  skuOrders: (token: string, inventoryId: number, dateFrom?: string, dateTo?: string) =>
    apiGet<SkuOrdersResult>(token, '/api/client-portal/analysis/sku-orders', { inventoryId, dateFrom, dateTo }),
  awaitingCount: (token: string, clientId?: number) =>
    apiGet<{ count: number }>(token, '/api/client-portal/orders/awaiting-active-count', {
      // Honor the top-bar client switcher so "Open orders" (and the sidebar
      // badge) scope to the selected client; the single-store fallback only
      // applies when no explicit client is chosen.
      clientId,
      storeId: clientId === undefined ? firstStoreId(token) : undefined,
    }),

  shipments: (token: string, opts: ListOpts = {}) =>
    scopedList<PortalShipment>(token, '/api/client-portal/shipments', {
      page: opts.page ?? 1,
      pageSize: opts.pageSize ?? 50,
      search: opts.search,
      clientId: opts.clientId,
    }),

  inventory: (token: string, opts: ListOpts = {}) =>
    scopedList<PortalInventory>(token, '/api/client-portal/inventory', {
      page: opts.page ?? 1,
      pageSize: opts.pageSize ?? 100,
      search: opts.search,
      clientId: opts.clientId,
      lowStock: opts.lowStock ? 1 : undefined,
    }),

  inventoryHistory: (token: string, opts: { page?: number; sku?: string; type?: string; days?: number } = {}) => {
    const r = defaultRange(opts.days ?? 30);
    return apiGet<Paginated<InventoryMovement>>(token, '/api/client-portal/inventory-history', {
      page: opts.page ?? 1,
      pageSize: 50,
      sku: opts.sku,
      type: opts.type,
      from: `${r.from}T00:00:00.000Z`,
      to: `${r.to}T23:59:59.999Z`,
    });
  },

  integrations: (token: string) => apiGet<{ data: PortalIntegration[] }>(token, '/api/client-portal/integrations'),
  inbound: (token: string, clientId?: number) =>
    apiGet<{ data: PortalInbound[] }>(token, '/api/client-portal/inbound', { clientId }),
  createInbound: (token: string, body: NewInboundInput) =>
    apiPost<{ data: { id: number } }>(token, '/api/client-portal/inbound', body),
  receiveInbound: (token: string, id: number, body: { addToInventory?: boolean; items?: Array<{ id: number; receivedQty: number }> }) =>
    apiPatch<{ data: { id: number; status: string; bumps: Array<{ sku: string; qty: number; matched: boolean }> } }>(token, `/api/client-portal/inbound/${id}/receive`, body),
  importInbound: (token: string, shipments: NewInboundInput[]) =>
    apiPost<{ data: { created: number; itemsCreated: number; skipped: number } }>(token, '/api/client-portal/inbound/import', { shipments }),

  analysis: (token: string, days = 30) =>
    apiGet<AnalysisBreakdown>(token, '/api/client-portal/analysis', {
      ...rangeToTimestamps(defaultRange(days)),
      limit: 200,
      storeId: firstStoreId(token),
    }),

  reports: (token: string, days = 30) => scopedReports(token, days),

  invoiceDetails: (token: string, days = 30, clientId?: number) =>
    apiGet<{ data: BillingInvoiceDetailRow[]; billingVisible?: boolean }>(token, '/api/client-portal/invoice-details', {
      ...rangeToTimestamps(defaultRange(days)),
      clientId,
    }),
  /** Invoice detail for an explicit date range (YYYY-MM-DD). Powers Billing. */
  invoiceDetailsRange: (token: string, dateFrom: string, dateTo: string, clientId?: number) =>
    apiGet<{ data: BillingInvoiceDetailRow[]; billingVisible?: boolean }>(token, '/api/client-portal/invoice-details', {
      dateFrom: `${dateFrom}T00:00:00.000Z`,
      dateTo: `${dateTo}T23:59:59.999Z`,
      clientId,
    }),

  /** Returns the invoice HTML (the backend renders a printable page). */
  invoiceHtml: (token: string, clientId: number, days = 30) =>
    apiText(token, '/api/client-portal/invoice', { clientId, ...rangeToTimestamps(defaultRange(days)) }),
  invoiceHtmlRange: (token: string, clientId: number, dateFrom: string, dateTo: string) =>
    apiText(token, '/api/client-portal/invoice', { clientId, dateFrom: `${dateFrom}T00:00:00.000Z`, dateTo: `${dateTo}T23:59:59.999Z` }),

  reportsRange: (token: string, dateFrom: string, dateTo: string) => scopedReportsRange(token, dateFrom, dateTo),

  /** Generate/regenerate billing line items for a range (admin-only, idempotent). */
  generateBilling: (token: string, dateFrom: string, dateTo: string, clientId?: number) =>
    apiPost<{ generated: number; total: number; skipped: number; message: string; lastGeneratedAt?: string }>(token, '/api/client-portal/billing/generate', {
      dateFrom: `${dateFrom}T00:00:00.000Z`,
      dateTo: `${dateTo}T23:59:59.999Z`,
      clientId,
    }),
  billingStatus: (token: string) =>
    apiGet<{ lastGenerated: BillingLastGenerated | null }>(token, '/api/client-portal/billing/status'),

  /** Carrier rate markups (Settings → Markups). Admin-only. */
  markups: (token: string) =>
    apiGet<{ groups: MarkupGroup[]; markups: Record<string, MarkupValue> }>(token, '/api/client-portal/markups'),
  setMarkup: (token: string, carrierId: number | string, body: MarkupValue | { value: null }) =>
    apiPut<{ ok: boolean }>(token, '/api/client-portal/markups', { carrierId, ...body }),
};

export interface MarkupCarrier {
  id: number;
  carrierCode: string;
  nickname: string;
}
export interface MarkupGroup {
  key: string;
  label: string;
  carriers: MarkupCarrier[];
}
export interface MarkupValue {
  type: 'pct' | 'flat';
  value: number;
}

export interface BillingLastGenerated {
  at: string;
  dateFrom?: string;
  dateTo?: string;
  generated?: number;
  total?: number;
  by?: string | null;
}
