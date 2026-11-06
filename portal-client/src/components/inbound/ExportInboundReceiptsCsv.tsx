import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { useAuth } from '@/auth';
import { Button } from '@/components/ui/Button';
import { portalApi, type ListOpts } from '@/lib/api';
import { downloadFile } from '@/lib/downloadFile';

/** Parent keys this control by filters so an old request cannot download into a new view. */
export function ExportInboundReceiptsCsv({ filters, disabled }: { filters: ListOpts; disabled: boolean }) {
  const { accessToken, userId } = useAuth();
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState<'csv' | 'xlsx' | null>(null);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setBusy(null); setMessage('');
    return () => { pending.current?.abort(); pending.current = null; };
  }, [accessToken, userId]);

  async function exportFile(format: 'csv' | 'xlsx') {
    if (!accessToken || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(format); setMessage(''); setFailed(false);
    try {
      const request = format === 'xlsx' ? portalApi.inboundReceiptsXlsx : portalApi.inboundReceiptsCsv;
      const file = await request({ accessToken, signal: controller.signal }, filters);
      if (controller.signal.aborted) return;
      const contentType = format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv';
      if (!file.contentType.toLowerCase().startsWith(contentType)) throw new Error('Unexpected file type');
      downloadFile({ bytes: file.bytes, filename: file.filename ?? `inbound-receipts.${format}` });
      setMessage(`${format === 'xlsx' ? 'Excel' : 'CSV'} downloaded with all matching receipts. Dates are in UTC.`);
    } catch (error) {
      if (controller.signal.aborted) return;
      const status = (error as { status?: number }).status;
      setFailed(true);
      setMessage(status === 413 ? 'Export is too large. Narrow the date range or client filter and try again.' :
        status === 401 || status === 403 ? 'Your access could not be verified. Sign in again to export.' :
          'Could not export receiving history. Please try again.');
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(null);
      }
    }
  }

  return <div className="space-y-1">
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={disabled || !accessToken || busy !== null} loading={busy === 'xlsx'}
        leadingIcon={<Download size={15} />} onClick={() => void exportFile('xlsx')}>{busy === 'xlsx' ? 'Exporting…' : 'Export Excel'}</Button>
      <Button variant="secondary" size="sm" disabled={disabled || !accessToken || busy !== null} loading={busy === 'csv'}
        leadingIcon={<Download size={15} />} onClick={() => void exportFile('csv')}>{busy === 'csv' ? 'Exporting…' : 'Export CSV'}</Button>
    </div>
    <p className="text-xs text-ink-2">Excel keeps column widths and wraps long text.</p>
    {busy && <p role="status" className="text-xs text-ink-2">Preparing your {busy === 'xlsx' ? 'Excel file' : 'CSV'}…</p>}
    {message && <p role={failed ? 'alert' : 'status'} className="text-xs text-ink-2">{message}</p>}
  </div>;
}
