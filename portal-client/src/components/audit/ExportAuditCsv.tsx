import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { useAuth } from '@/auth';
import { Button } from '@/components/ui/Button';
import { portalApi } from '@/lib/api';
import { downloadFile } from '@/lib/downloadFile';
import type { PortalAuditLogFilters } from '@client-portal-contracts/access';

export function ExportAuditCsv({ filters, disabled }: { filters: PortalAuditLogFilters; disabled: boolean }) {
  const { accessToken, userId } = useAuth();
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => () => { pending.current?.abort(); }, [accessToken, userId]);

  async function exportCsv() {
    if (!accessToken || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true); setMessage('');
    try {
      const file = await portalApi.auditCsv({ accessToken, signal: controller.signal }, filters);
      if (controller.signal.aborted) return;
      if (!file.contentType.toLowerCase().startsWith('text/csv')) throw new Error('Unexpected file type');
      downloadFile({ bytes: file.bytes, filename: file.filename ?? 'audit-log.csv' });
      setMessage('CSV downloaded with all matching events. Times are in UTC.');
    } catch (error) {
      if (controller.signal.aborted) return;
      const status = (error as { status?: number }).status;
      setMessage(status === 413 ? 'Export is too large. Narrow the date range or filters and try again.' :
        status === 401 || status === 403 ? 'Admin access is required. Sign in again to export.' :
          'Could not export the audit log. Please try again.');
    } finally {
      pending.current = null;
      setBusy(false);
    }
  }
  return <div className="space-y-1">
    <Button variant="secondary" size="sm" disabled={disabled || !accessToken} loading={busy}
      leadingIcon={<Download size={15} />} onClick={() => void exportCsv()}>{busy ? 'Exporting…' : 'Export CSV'}</Button>
    {message && <p role="status" className="text-xs text-ink-2">{message}</p>}
  </div>;
}
