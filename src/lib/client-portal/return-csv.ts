import type { PortalReturnRow } from './contracts/returns';

export const RETURN_EXPORT_MAX_ROWS = 10_000;
export const RETURN_EXPORT_MAX_BYTES = 16 * 1024 * 1024;

function cell(value: string | number | null | undefined) {
  let text = String(value ?? '');
  // Quotes do not prevent spreadsheet formula execution in imported text.
  if (typeof value === 'string' && (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const line = (values: Array<string | number | null | undefined>) => values.map(cell).join(',') + '\r\n';
/** Presentation-only projection of the same redacted DTO used by the returns table. */
export function returnCsvHeader() {
  return '\uFEFF' + line(['Return reference', 'Order #', 'Client', 'Item names', 'SKUs', 'Item quantities', 'Total quantity', 'Return status', 'Created (UTC)']);
}

export function returnCsvRow(item: PortalReturnRow, items: Array<{ name: string | null; sku: string; quantity: string | number }>) {
  return line([item.returnReference, item.orderNumber, item.clientName, items.map(row => row.name ?? '').join('\n'),
    items.map(row => row.sku).join('\n'), items.map(row => row.quantity).join('\n'), item.returnedQuantity, item.status, item.createdAt]);
}
