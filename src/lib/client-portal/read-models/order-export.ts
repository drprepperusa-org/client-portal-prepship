import { replacementsSchemaReady } from '../replacements-schema-readiness';
import { db } from '../../../db/client';
import { listPortalOrders, type PortalOrderListOptions } from './orders';
import { orderCsvHeader, orderCsvRow, ORDER_EXPORT_MAX_BYTES, ORDER_EXPORT_MAX_ROWS } from '../order-csv';
import type { ClientPortalScope } from '../scope';

export class OrderExportTooLarge extends Error {}

/** One read-only snapshot: concurrent imports cannot skip/duplicate rows between pages. */
export async function exportPortalOrders(scope: ClientPortalScope, filters: Omit<PortalOrderListOptions, 'page' | 'pageSize'>) {
  // Probe before reserving a connection, including on a one-connection pool.
  const schemaReady = await replacementsSchemaReady();
  return db.transaction(async tx => {
    const lines = [orderCsvHeader(scope)];
    let bytes = Buffer.byteLength(lines[0]!);
    let rows = 0;
    const started = Date.now();
    for (let page = 1; ; page++) {
      if (Date.now() - started > 25_000) throw new OrderExportTooLarge('Export took too long');
      const result = await listPortalOrders(scope, { ...filters, page, pageSize: 500 }, tx, schemaReady);
      if (result.pagination.total > ORDER_EXPORT_MAX_ROWS) throw new OrderExportTooLarge('Too many rows');
      for (const order of result.data) {
        const line = orderCsvRow(order, scope);
        bytes += Buffer.byteLength(line);
        if (bytes > ORDER_EXPORT_MAX_BYTES) throw new OrderExportTooLarge('Too many bytes');
        lines.push(line);
        rows++;
      }
      if (page >= result.pagination.totalPages) {
        if (rows !== result.pagination.total) throw new Error('Incomplete order export');
        return { csv: lines.join(''), rows };
      }
    }
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
