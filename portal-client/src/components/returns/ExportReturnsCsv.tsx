import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { useAuth } from '@/auth';
import { Button } from '@/components/ui/Button';
import { portalApi, type ListOpts } from '@/lib/api';
import { downloadFile } from '@/lib/downloadFile';

/** Parent keys this control by filters so an old request cannot download into a new view. */
export function ExportReturnsCsv({ filters, disabled }: { filters: ListOpts & { orderId?: number }; disabled: boolean }) {
  const { accessToken, userId } = useAuth();
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setBusy(false); setMessage('');
    return () => { pending.current?.abort(); pending.current = null; };
  }, [accessToken, userId]);

  async function exportCsv() {
    if (!accessToken || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true); setMessage(''); setFailed(false);
    try {
      const file = await portalApi.returnsCsv({ accessToken, signal: controller.signal }, filters);
      if (controller.signal.aborted) return;
      if (!file.contentType.toLowerCase().startsWith('text/csv')) throw new Error('Unexpected file type');
      downloadFile({ bytes: file.bytes, filename: file.filename ?? 'returns.csv' });
      setMessage('CSV downloaded with all matching returns. Dates are in UTC.');
    } catch (error) {
      if (controller.signal.aborted) return;
      const status = (error as { status?: number }).status;
      setFailed(true);
      setMessage(status === 413 ? 'Export is too large. Narrow the date range or search and try again.' :
        status === 401 || status === 403 ? 'Your access could not be verified. Sign in again to export.' :
          'Could not export returns. Please try again.');
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }

  return <div className="space-y-1">
    <Button variant="secondary" size="sm" disabled={disabled || !accessToken} loading={busy}
      leadingIcon={<Download size={15} />} onClick={() => void exportCsv()}>{busy ? 'Exporting…' : 'Export CSV'}</Button>
    <p className="text-xs text-ink-3">All matching returns across pages. Up to 10,000 returns per export.</p>
    {busy && <p role="status" className="text-xs text-ink-2">Preparing your CSV…</p>}
    {message && <p role={failed ? 'alert' : 'status'} className="text-xs text-ink-2">{message}</p>}
  </div>;
}
