import type { SortState } from '@/components/ui/data-table/types';

type CommonFilters = { search: string; sort: SortState; pageSize: number };
export type OrderViewStatus = 'all' | 'awaiting_shipment' | 'shipped' | 'cancelled';
export type SavedFilters = CommonFilters & (
  | { page: 'orders'; status: OrderViewStatus }
  | { page: 'inventory'; lowStock: boolean }
);
export type SavedView = { id: string; name: string; filters: SavedFilters };
export const MAX_SAVED_VIEWS = 20;
const SORT_KEYS = {
  orders: ['date', 'client', 'status', 'order', 'items', 'sku', 'qty', 'weight', 'total', 'customerShipping'],
  inventory: ['sku', 'name', 'client', 'dims', 'cuft', 'stock', 'whseShipped30', 'unitsPack', 'min', 'status'],
};
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Allowlisted presentation intent only: never restore scope, rows, totals or arbitrary API fields. */
export function parseSavedFilters(value: unknown, page: SavedFilters['page']): SavedFilters | null {
  if (!record(value) || value.page !== page || typeof value.search !== 'string' || value.search.length > 120
    || ![50, 100, 200, 300, 500].includes(value.pageSize as number)) return null;
  const allowed = ['page', 'search', 'sort', 'pageSize', page === 'orders' ? 'status' : 'lowStock'];
  if (Object.keys(value).some((key) => !allowed.includes(key))) return null;
  let sort: SortState = null;
  if (value.sort !== null) {
    if (!record(value.sort) || typeof value.sort.key !== 'string' || !SORT_KEYS[page].includes(value.sort.key)
      || !['asc', 'desc'].includes(value.sort.dir as string)
      || Object.keys(value.sort).some((key) => !['key', 'dir'].includes(key))) return null;
    sort = { key: value.sort.key, dir: value.sort.dir as 'asc' | 'desc' };
  }
  const common = { search: value.search, sort, pageSize: value.pageSize as number };
  if (page === 'orders' && ['all', 'awaiting_shipment', 'shipped', 'cancelled'].includes(value.status as string)) {
    return { ...common, page, status: value.status as OrderViewStatus };
  }
  if (page === 'inventory' && typeof value.lowStock === 'boolean') return { ...common, page, lowStock: value.lowStock };
  return null;
}

export function readSavedViews(storageKey: string, page: SavedFilters['page']): SavedView[] {
  const raw = localStorage.getItem(storageKey);
  if (raw === null) return [];
  const saved: unknown = JSON.parse(raw);
  if (!record(saved) || saved.version !== 1 || !Array.isArray(saved.views) || saved.views.length > MAX_SAVED_VIEWS) {
    throw new Error('Invalid saved views');
  }
  const ids = new Set<string>();
  const names = new Set<string>();
  return saved.views.map((entry: unknown) => {
    if (!record(entry) || typeof entry.id !== 'string' || !/^[\w-]{1,80}$/.test(entry.id)
      || typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 40) throw new Error('Invalid saved view');
    const filters = parseSavedFilters(entry.filters, page);
    const name = entry.name.trim();
    if (!filters || ids.has(entry.id) || names.has(name.toLowerCase())) throw new Error('Invalid saved view');
    ids.add(entry.id); names.add(name.toLowerCase());
    return { id: entry.id, name, filters };
  });
}
