import { inArray } from 'drizzle-orm';
import { returnItems } from '../../../db/schema/returns';
import { db } from '../../../db/client';
import { listPortalReturns, type PortalReturnListOptions } from './list';
import { returnCsvHeader, returnCsvRow, RETURN_EXPORT_MAX_BYTES, RETURN_EXPORT_MAX_ROWS } from '../../../lib/client-portal/return-csv';
import type { ClientPortalScope } from '../../../lib/client-portal/scope';

export class ReturnExportTooLarge extends Error {}

/** One read-only snapshot: concurrent imports cannot skip/duplicate rows between pages. */
export async function exportPortalReturns(scope: ClientPortalScope, filters: Omit<PortalReturnListOptions, 'page' | 'pageSize'>) {
  return db.transaction(async tx => {
    const lines = [returnCsvHeader()];
    let bytes = Buffer.byteLength(lines[0]!);
    let rows = 0;
    const started = Date.now();
    for (let page = 1; ; page++) {
      if (Date.now() - started > 25_000) throw new ReturnExportTooLarge('Export took too long');
      const result = await listPortalReturns(scope, { ...filters, page, pageSize: 500 }, tx);
      if (result.pagination.total > RETURN_EXPORT_MAX_ROWS) throw new ReturnExportTooLarge('Too many rows');
      // One page-scoped item read inside the same snapshot; no detail calls or label lookups.
      const items = result.data.length ? await tx.select({ returnId: returnItems.returnId,
        name: returnItems.name, sku: returnItems.sku, quantity: returnItems.quantity })
        .from(returnItems).where(inArray(returnItems.returnId, result.data.map(row => row.id))).orderBy(returnItems.id) : [];
      const byReturn = new Map<number, typeof items>();
      for (const item of items) {
        const group = byReturn.get(item.returnId) ?? [];
        group.push(item); byReturn.set(item.returnId, group);
      }
      for (const row of result.data) {
        const line = returnCsvRow(row, byReturn.get(row.id) ?? []);
        bytes += Buffer.byteLength(line);
        if (bytes > RETURN_EXPORT_MAX_BYTES) throw new ReturnExportTooLarge('Too many bytes');
        lines.push(line);
        rows++;
      }
      if (page >= result.pagination.totalPages) {
        if (rows !== result.pagination.total) throw new Error('Incomplete return export');
        return { csv: lines.join(''), rows };
      }
    }
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
