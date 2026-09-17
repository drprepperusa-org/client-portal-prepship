import type { PortalInboundReceipt } from './contracts/inbound';

export const INBOUND_RECEIPT_EXPORT_MAX_ROWS = 10_000;
export const INBOUND_RECEIPT_EXPORT_MAX_BYTES = 16 * 1024 * 1024;

function cell(value: string | number | null | undefined) {
  let text = String(value ?? '');
  // Quotes do not prevent spreadsheet formula execution in imported text.
  if (typeof value === 'string' && (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const line = (values: Array<string | number | null | undefined>) => values.map(cell).join(',') + '\r\n';
/** Presentation-only projection of the same redacted DTO used by the receiving history table. */
export function inboundReceiptCsvHeader() {
  return '\uFEFF' + line(['Receipt ID', 'Client', 'SKU', 'Item name', 'Received quantity', 'Received date (UTC)']);
}

export function inboundReceiptCsvRow(item: PortalInboundReceipt) {
  return line([item.id, item.clientName, item.sku, item.name, item.receivedUnits, item.receivedAt]);
}
