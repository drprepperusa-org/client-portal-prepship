import { db } from '../../../db/client';
import { listPortalInventory, type PortalInventoryListOptions } from './inventory';
import { inventoryCsvHeader, inventoryCsvRow, INVENTORY_EXPORT_MAX_BYTES, INVENTORY_EXPORT_MAX_ROWS } from '../inventory-csv';
import type { ClientPortalScope } from '../scope';

export class InventoryExportTooLarge extends Error {}

/** One read-only snapshot: concurrent imports cannot skip/duplicate rows between pages. */
export async function exportPortalInventory(scope: ClientPortalScope, filters: Omit<PortalInventoryListOptions, 'page' | 'pageSize'>) {
  return db.transaction(async tx => {
    const lines = [inventoryCsvHeader()];
    let bytes = Buffer.byteLength(lines[0]!);
    let rows = 0;
    let snapshotTotal: number | undefined;
    const started = Date.now();
    for (let page = 1; ; page++) {
      if (Date.now() - started > 25_000) throw new InventoryExportTooLarge('Export took too long');
      const result = await listPortalInventory(scope, { ...filters, page, pageSize: 500 }, tx, snapshotTotal);
      snapshotTotal = result.pagination.total;
      if (result.pagination.total > INVENTORY_EXPORT_MAX_ROWS) throw new InventoryExportTooLarge('Too many rows');
      for (const inventory of result.data) {
        const line = inventoryCsvRow(inventory);
        bytes += Buffer.byteLength(line);
        if (bytes > INVENTORY_EXPORT_MAX_BYTES) throw new InventoryExportTooLarge('Too many bytes');
        lines.push(line);
        rows++;
      }
      if (page >= result.pagination.totalPages) {
        if (rows !== result.pagination.total) throw new Error('Incomplete inventory export');
        return { csv: lines.join(''), rows };
      }
    }
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
