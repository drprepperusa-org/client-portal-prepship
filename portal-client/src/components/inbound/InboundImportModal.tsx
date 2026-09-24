import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DraftModal } from '@/components/ui/DraftModal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth';
import { portalApi } from '@/lib/api';
import type { ApiError } from '@/lib/api/transport';
import type { InboundImportInput, InboundImportPreview } from '@client-portal-contracts/inbound-import';
import { InboundImportPreviewTable } from './InboundImportPreviewTable';
import { field } from './shared';

type Props = { open: boolean; onClose: () => void };
export function InboundImportModal(props: Props) {
  const { userId } = useAuth();
  return props.open ? <ImportDraft key={userId} onClose={props.onClose} /> : null;
}

function ImportDraft({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { accessToken } = useAuth();
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<InboundImportPreview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null);
  const [message, setMessage] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const attempt = useRef<InboundImportInput | null>(null);
  const sending = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);

  async function loadPreview() {
    if (!accessToken || sending.current) return;
    sending.current = true; setBusy('preview'); setMessage(''); setPreview(null);
    try {
      const result = await portalApi.previewInboundImport(accessToken, csv);
      setPreview(result.data);
    } catch (error) {
      setMessage((error as ApiError)?.status && (error as ApiError).status! < 500 && error instanceof Error
        ? error.message : 'Could not preview. Your CSV is still here; try again.');
    } finally { sending.current = false; setBusy(null); }
  }

  async function submitImport() {
    if (!accessToken || sending.current || (!attempt.current && (!preview?.valid || !preview.fingerprint))) return;
    attempt.current ??= { csv, fingerprint: preview!.fingerprint!, idempotencyKey: crypto.randomUUID() };
    sending.current = true; setBusy('import'); setMessage('');
    try {
      const result = await portalApi.importInbound(accessToken, attempt.current);
      void qc.invalidateQueries({ queryKey: ['inbound'] }).catch(() => {});
      toast.success(result.data.replayed ? 'Import confirmed' : 'Imported', `${result.data.created} shipments, ${result.data.itemsCreated} items saved.`);
      onClose();
    } catch (error) {
      const status = (error as ApiError)?.status;
      if (!uncertain && status && [400, 401, 403, 409, 422].includes(status)) {
        attempt.current = null; setPreview(null);
        setMessage(error instanceof Error ? error.message : 'Review the CSV and preview it again.');
        requestAnimationFrame(() => input.current?.focus());
      } else {
        setUncertain(true);
        setMessage('We could not confirm the import. Retry import checks the same batch without creating it twice.');
      }
    } finally { sending.current = false; setBusy(null); }
  }

  return (
    <DraftModal dirty={Boolean(csv) || uncertain} saving={busy !== null} onClose={onClose} title="Import inbound CSV" maxWidth={1000}
      discardMessage={uncertain ? 'This batch may already be saved. Use Retry import to confirm it. Closing this form does not undo a saved import.' : undefined}>
      {requestClose => (
        <div className="min-w-0 space-y-4">
          <p className="text-sm text-ink-2">Paste one row per item. Rows with the same client and reference form one shipment.
            Required columns: client, reference, qty, and sku or name. Use YYYY-MM-DD dates.</p>
          <p className="break-words text-xs text-ink-3">Optional columns: supplier, status, expected_date, carrier, tracking.
            Maximum 5,000 rows, 500 shipments and 200 items per shipment; 1 MiB of CSV.</p>
          <div>
            <label htmlFor="inbound-import-csv" className="block text-sm font-medium text-ink">CSV data</label>
            <textarea id="inbound-import-csv" ref={input} value={csv} disabled={uncertain}
              onChange={event => { setCsv(event.target.value); setPreview(null); setMessage(''); }}
              placeholder={'client,reference,supplier,expected_date,sku,name,qty\nHUGRAB,PO-1024,Acme,2026-06-05,HU-10,Leeds Line V2,120'}
              className={`${field} mt-1 h-44 py-2 font-mono text-xs`} />
          </div>
          {message && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-ink-2">{message}</p>}
          {preview && <InboundImportPreviewTable preview={preview} />}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={requestClose}>Cancel</Button>
            {!uncertain && <Button variant="secondary" onClick={loadPreview} disabled={!csv.trim() || busy !== null}>
              {busy === 'preview' ? 'Checking…' : 'Preview import'}
            </Button>}
            {(uncertain || preview?.valid) && <Button onClick={submitImport} disabled={busy !== null}>
              {busy === 'import' ? 'Importing…' : uncertain ? 'Retry import' : 'Import shipments'}
            </Button>}
          </div>
        </div>
      )}
    </DraftModal>
  );
}
