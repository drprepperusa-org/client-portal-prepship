import { db } from '../../../db/client';
import { listPortalShipments, type PortalShipmentListOptions } from './shipments';
import { shipmentCsvHeader, shipmentCsvRow, SHIPMENT_EXPORT_MAX_BYTES, SHIPMENT_EXPORT_MAX_ROWS } from '../shipment-csv';
import type { ClientPortalScope } from '../scope';

export class ShipmentExportTooLarge extends Error {}

/** One read-only snapshot: concurrent imports cannot skip/duplicate rows between pages. */
export async function exportPortalShipments(scope: ClientPortalScope, filters: Omit<PortalShipmentListOptions, 'page' | 'pageSize'>) {
  return db.transaction(async tx => {
    const lines = [shipmentCsvHeader()];
    let bytes = Buffer.byteLength(lines[0]!);
    let rows = 0;
    let snapshotTotal: number | undefined;
    const started = Date.now();
    for (let page = 1; ; page++) {
      if (Date.now() - started > 25_000) throw new ShipmentExportTooLarge('Export took too long');
      const result = await listPortalShipments(scope, { ...filters, page, pageSize: 500 }, tx, snapshotTotal);
      snapshotTotal = result.pagination.total;
      if (result.pagination.total > SHIPMENT_EXPORT_MAX_ROWS) throw new ShipmentExportTooLarge('Too many rows');
      for (const shipment of result.data) {
        const line = shipmentCsvRow(shipment);
        bytes += Buffer.byteLength(line);
        if (bytes > SHIPMENT_EXPORT_MAX_BYTES) throw new ShipmentExportTooLarge('Too many bytes');
        lines.push(line);
        rows++;
      }
      if (page >= result.pagination.totalPages) {
        if (rows !== result.pagination.total) throw new Error('Incomplete shipment export');
        return { csv: lines.join(''), rows };
      }
    }
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
