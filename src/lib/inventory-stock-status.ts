export type StockStatus = 'in' | 'low' | 'out';

/** Backend-owned status policy over the canonical signed inventory quantity. */
export function classifyStockStatus(inventoryQuantity: number, reorderLevel: number): StockStatus {
  if (inventoryQuantity <= 0) return 'out';
  if (inventoryQuantity <= reorderLevel) return 'low';
  return 'in';
}
