import type { Accent } from './accents';
import type { PortalInventory } from './api';

type StockStatusMeta = {
  label: string;
  accent: Accent;
  stockTextClass: string;
};

const STOCK_STATUS_META: Record<PortalInventory['stockStatus'], StockStatusMeta> = {
  out: { label: 'OUT', accent: 'rose', stockTextClass: 'text-rose-600' },
  low: { label: 'LOW', accent: 'amber', stockTextClass: 'text-ink' },
  in: { label: 'IN', accent: 'emerald', stockTextClass: 'text-ink' },
};

const UNAVAILABLE_STOCK_STATUS: StockStatusMeta = {
  label: 'UNAVAILABLE',
  accent: 'indigo',
  stockTextClass: 'text-ink-3',
};

/** Presentation-only mapping of the backend-owned stockStatus contract. */
export function inventoryStockStatusMeta(value: unknown): StockStatusMeta {
  if (value === 'out' || value === 'low' || value === 'in') return STOCK_STATUS_META[value];
  return UNAVAILABLE_STOCK_STATUS;
}
