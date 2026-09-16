import type { PortalOrder } from './contracts/orders';
import type { ClientPortalScope } from './scope';

export const ORDER_EXPORT_MAX_ROWS = 10_000;
export const ORDER_EXPORT_MAX_BYTES = 16 * 1024 * 1024;

function cell(value: string | number | null | undefined) {
  let text = String(value ?? '');
  // Quotes do not prevent spreadsheet formula execution in imported text.
  if (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const line = (values: Array<string | number | null | undefined>) => values.map(cell).join(',') + '\r\n';
type ExportAccess = Pick<ClientPortalScope, 'canViewFinancials' | 'isGlobal'>;

/** Presentation of the same safe Orders DTO; no internal pricing or raw payloads. */
export function orderCsvHeader(access: ExportAccess) {
  return '\uFEFF' + line(['Order ID', 'Order #', 'Order date (UTC)', 'Client', 'Status',
    'Item names', 'SKUs', 'Item quantities', 'Ordered units', 'Tracking number',
    ...(access.isGlobal ? ['Weight (oz)'] : []),
    ...(access.canViewFinancials ? ['Order total', 'Customer shipping rate', 'Shipping rate pending'] : [])]);
}

export function orderCsvRow(order: PortalOrder, access: ExportAccess) {
  return line([order.id, order.orderNumber, order.orderDate, order.clientName, order.fulfillmentStatus,
    order.items.map(item => item.name ?? '').join('\n'), order.items.map(item => item.sku ?? '').join('\n'),
    order.items.map(item => item.quantity ?? '').join('\n'), order.orderedUnits, order.displayTrackingNumber,
    ...(access.isGlobal ? [order.weightOz] : []),
    ...(access.canViewFinancials ? [order.orderTotal, order.customerShippingRate,
      order.customerShippingRatePending ? 'Yes' : 'No'] : [])]);
}
