import type { PortalShipment } from './contracts/shipments';

export const SHIPMENT_EXPORT_MAX_ROWS = 10_000;
export const SHIPMENT_EXPORT_MAX_BYTES = 16 * 1024 * 1024;

function cell(value: string | number | null | undefined) {
  let text = String(value ?? '');
  // Quotes do not prevent spreadsheet formula execution in imported text.
  if (typeof value === 'string' && (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const line = (values: Array<string | number | null | undefined>) => values.map(cell).join(',') + '\r\n';
/** Presentation-only projection of the same redacted DTO used by the shipment table. */
export function shipmentCsvHeader() {
  return '\uFEFF' + line(['Shipment ID', 'Order #', 'Client', 'Tracking number', 'Ship date (UTC)', 'Status']);
}

export function shipmentCsvRow(item: PortalShipment) {
  return line([item.id, item.orderNumber, item.clientName, item.displayTrackingNumber, item.shipDate, item.shipmentStatus]);
}
