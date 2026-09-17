import { db } from '../../../db/client';
import { listPortalInboundReceipts, type ReceiptListOptions } from './inbound-receipts';
import { inboundReceiptCsvHeader, inboundReceiptCsvRow, INBOUND_RECEIPT_EXPORT_MAX_BYTES, INBOUND_RECEIPT_EXPORT_MAX_ROWS } from '../inbound-receipt-csv';
import type { ClientPortalScope } from '../scope';

export class InboundReceiptExportTooLarge extends Error {}

/** One read-only snapshot: concurrent imports cannot skip/duplicate rows between pages. */
export async function exportPortalInboundReceipts(scope: ClientPortalScope, filters: Omit<ReceiptListOptions, 'page' | 'pageSize'>) {
  return db.transaction(async tx => {
    const lines = [inboundReceiptCsvHeader()];
    let bytes = Buffer.byteLength(lines[0]!);
    let rows = 0;
    let snapshotTotal: number | undefined;
    const started = Date.now();
    for (let page = 1; ; page++) {
      if (Date.now() - started > 25_000) throw new InboundReceiptExportTooLarge('Export took too long');
      const result = await listPortalInboundReceipts(scope, { ...filters, page, pageSize: 500 }, tx, snapshotTotal);
      snapshotTotal = result.pagination.total;
      if (result.pagination.total > INBOUND_RECEIPT_EXPORT_MAX_ROWS) throw new InboundReceiptExportTooLarge('Too many rows');
      for (const receipt of result.data) {
        const line = inboundReceiptCsvRow(receipt);
        bytes += Buffer.byteLength(line);
        if (bytes > INBOUND_RECEIPT_EXPORT_MAX_BYTES) throw new InboundReceiptExportTooLarge('Too many bytes');
        lines.push(line);
        rows++;
      }
      if (page >= result.pagination.totalPages) {
        if (rows !== result.pagination.total) throw new Error('Incomplete inbound receipt export');
        return { csv: lines.join(''), rows };
      }
    }
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
