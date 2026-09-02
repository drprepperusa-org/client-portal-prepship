import type { ApiFile } from './api';

export type WorkbookFetcher = (
  token: string,
  clientId: number,
  dateFrom: string,
  dateTo: string,
) => Promise<ApiFile>;

export type FileSink = (file: { bytes: Blob; filename: string }) => void;

/**
 * CP-068 — hand PrepShip's invoice workbook to the browser.
 *
 * ONE responsibility, deliberately isolated from React so a guard can EXECUTE it: the Blob
 * that arrives from the API is the Blob that leaves to the download manager — the same
 * object, untouched. No cells, no rows, no re-encoding, no second file. The guard calls this
 * with a sentinel Blob and asserts identity on what reaches the sink; a version that built
 * anything locally would hand the sink a different object and go red.
 *
 * The filename is PrepShip's when the API exposed it, else a portal-built safe fallback —
 * a NAME, never content.
 */
export async function downloadInvoiceWorkbook(
  deps: { fetchWorkbook: WorkbookFetcher; sink: FileSink },
  token: string,
  clientId: number,
  dateFrom: string,
  dateTo: string,
): Promise<{ filename: string }> {
  const file = await deps.fetchWorkbook(token, clientId, dateFrom, dateTo);
  const filename = file.filename ?? `invoice-${clientId}-${dateFrom}-${dateTo}.xlsx`;
  deps.sink({ bytes: file.bytes, filename });
  return { filename };
}
