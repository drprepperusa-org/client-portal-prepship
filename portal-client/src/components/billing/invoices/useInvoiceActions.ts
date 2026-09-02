import { useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { portalApi } from '@/lib/api';
import { downloadFile } from '@/lib/downloadFile';
import { downloadInvoiceWorkbook } from '@/lib/invoiceWorkbookDownload';
import type { PeriodSummary } from '../invoiceColumns';

interface InvoiceActionsOptions {
  accessToken: string | null;
  summary: PeriodSummary[];
  clientFilter: number | undefined;
  from: string;
  to: string;
}

export function useInvoiceActions({
  accessToken,
  summary,
  clientFilter,
  from,
  to,
}: InvoiceActionsOptions) {
  const toast = useToast();
  const [opening, setOpening] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  async function viewInvoice(
    clientId: number | undefined,
    rangeFrom: string,
    rangeTo: string,
    busyKey: string,
  ) {
    if (!clientId || !accessToken) {
      toast.error('Cannot open invoice', 'Missing client id.');
      return;
    }
    setOpening(busyKey);
    try {
      const html = await portalApi.invoiceHtmlRange(accessToken, clientId, rangeFrom, rangeTo);
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      if (!window.open(url, '_blank')) {
        toast.warning('Pop-up blocked', 'Allow pop-ups to view the invoice.');
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast.error('Invoice failed', error instanceof Error ? error.message : 'Could not load the invoice.');
    } finally {
      setOpening(null);
    }
  }

  /**
   * CP-068 — the Excel export IS PrepShip's workbook.
   *
   * The portal used to page every /invoice-details row into the browser and build its own
   * sheet — its own columns, its own totals row. That was a second serializer of invoice
   * money beside the printable invoice, which already renders PrepShip's canonical totals.
   * Now the bytes PrepShip's own Export serves go straight to the download manager through
   * invoiceWorkbookDownload.ts, which a guard EXECUTES to prove the Blob is the same object
   * in and out. Nothing here reads rows, decides columns, or adds anything up.
   */
  async function exportExcel(
    clientId: number,
    rangeFrom: string,
    rangeTo: string,
    busyKey: string,
  ) {
    if (exporting != null || !accessToken) return;
    setExporting(busyKey);
    try {
      const file = await downloadInvoiceWorkbook(
        { fetchWorkbook: portalApi.invoiceWorkbookRange, sink: downloadFile },
        accessToken, clientId, rangeFrom, rangeTo,
      );
      toast.success('Excel ready', `${file.filename} — PrepShip's invoice workbook for ${rangeFrom} → ${rangeTo}.`);
    } catch (error) {
      toast.error('Excel export failed', error instanceof Error ? error.message : 'Could not download the Excel file.');
    } finally {
      setExporting(null);
    }
  }

  /**
   * Whole-range export. PrepShip issues one workbook per client, so this resolves the page to
   * ONE client (the filter, or the only client on the page). DJ ruled (CP-068, 2026-09-02):
   * one file per client — no merged multi-client sheet is assembled anywhere.
   */
  async function exportAllPeriods() {
    if (exporting != null || !accessToken) return;
    const clientIds = [...new Set(summary.map((row) => row.clientId))];
    const clientId = clientFilter ?? (clientIds.length === 1 ? clientIds[0] : undefined);
    if (clientId == null) {
      toast.info(
        'Choose a client to export',
        'PrepShip issues one invoice workbook per client. Filter to a client, then export the whole range.',
      );
      return;
    }
    await exportExcel(clientId, from, to, 'all-periods');
  }

  return { opening, exporting, viewInvoice, exportExcel, exportAllPeriods };
}
