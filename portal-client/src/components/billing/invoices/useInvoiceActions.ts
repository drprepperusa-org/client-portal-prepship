import { useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { portalApi, type BillingInvoiceDetailRow } from '@/lib/api';
import { exportInvoiceExcel } from '@/lib/invoiceExcel';
import { fetchAllInvoiceRows as fetchAllInvoiceRowsPaged } from '@/lib/invoiceRows';
import type { PeriodSummary } from '../invoiceColumns';

interface InvoiceActionsOptions {
  accessToken: string | null;
  summary: PeriodSummary[];
  clientFilter: number | undefined;
  from: string;
  to: string;
}

async function fetchAllInvoiceRows(
  token: string,
  clientId: number | undefined,
  rangeFrom: string,
  rangeTo: string,
): Promise<{ rows: BillingInvoiceDetailRow[]; truncated: boolean }> {
  return fetchAllInvoiceRowsPaged({
    fetcher: portalApi.invoiceDetailsRange,
    token,
    clientId,
    rangeFrom,
    rangeTo,
  });
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

  async function exportExcel(
    clientId: number,
    clientName: string,
    rangeFrom: string,
    rangeTo: string,
    busyKey: string,
  ) {
    if (exporting != null || !accessToken) return;
    setExporting(busyKey);
    try {
      const result = await fetchAllInvoiceRows(accessToken, clientId, rangeFrom, rangeTo);
      if (!result.rows.length) {
        toast.error('Nothing to export', 'No billable lines for this client in this period.');
        return;
      }
      await exportInvoiceExcel(result.rows, { clientName, from: rangeFrom, to: rangeTo });
      if (result.truncated) {
        toast.warning('Partial export', 'This range is very large; narrow it for a complete file.');
      }
    } catch (error) {
      toast.error('Excel export failed', error instanceof Error ? error.message : 'Could not build the Excel file.');
    } finally {
      setExporting(null);
    }
  }

  async function exportAllPeriods() {
    if (exporting != null || !accessToken) return;
    const clientIds = [...new Set(summary.map((row) => row.clientId))];
    const clientId = clientFilter ?? (clientIds.length === 1 ? clientIds[0] : undefined);
    const multiClient = clientId == null && clientIds.length > 1;
    const clientName = clientId == null
      ? 'All clients'
      : summary.find((row) => row.clientId === clientId)?.clientName ?? `Client ${clientId}`;
    setExporting('all-periods');
    try {
      const result = await fetchAllInvoiceRows(accessToken, clientId, from, to);
      if (!result.rows.length) {
        toast.error('Nothing to export', 'No billable lines in this date range.');
        return;
      }
      await exportInvoiceExcel(result.rows, { clientName, from, to, includeClient: multiClient });
      if (result.truncated) {
        toast.warning('Partial export', 'This range is very large; narrow it for a complete file.');
      } else {
        toast.success('Excel ready', `${result.rows.length.toLocaleString()} lines across ${from} → ${to}.`);
      }
    } catch (error) {
      toast.error('Excel export failed', error instanceof Error ? error.message : 'Could not build the Excel file.');
    } finally {
      setExporting(null);
    }
  }

  return { opening, exporting, viewInvoice, exportExcel, exportAllPeriods };
}
