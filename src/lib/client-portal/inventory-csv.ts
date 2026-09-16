import type { PortalInventory } from './contracts/inventory';

export const INVENTORY_EXPORT_MAX_ROWS = 10_000;
export const INVENTORY_EXPORT_MAX_BYTES = 16 * 1024 * 1024;

function cell(value: string | number | null | undefined) {
  let text = String(value ?? '');
  // Quotes do not prevent spreadsheet formula execution in imported text.
  if (typeof value === 'string' && (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const line = (values: Array<string | number | null | undefined>) => values.map(cell).join(',') + '\r\n';
/** Allowlisted presentation of the canonical Inventory DTO. */
export function inventoryCsvHeader() {
  return '\uFEFF' + line(['Inventory ID', 'SKU', 'Name', 'Client', 'Current quantity', 'Stock status',
    'Reorder level', 'Warehouse shipped (30 days)', 'Units per pack',
    'Length (in)', 'Width (in)', 'Height (in)', 'Cubic feet per unit', 'Package']);
}

export function inventoryCsvRow(item: PortalInventory) {
  const status = { in: 'In stock', low: 'Low stock', out: 'Out of stock' }[item.stockStatus];
  return line([item.id, item.sku, item.name, item.clientName, item.inventoryQuantity, status,
    item.reorderLevel, item.warehouseShipped30d, item.unitsPerPack,
    item.length, item.width, item.height, item.cuFt, item.packageName]);
}
