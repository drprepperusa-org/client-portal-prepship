import { useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth';
import { portalApi, type PortalClientRow } from '@/lib/api';
import { field } from './shared';
import { parseCsv } from './csv';

const CSV_COLUMNS = 'client, reference, supplier, status, expected_date, carrier, tracking, sku, name, qty';

function CodeToken({ children }: { children: ReactNode }) {
  return <code className="rounded bg-slate-100 px-1 text-xs">{children}</code>;
}

/** CSV-paste import modal: parses locally, then bulk-creates via the portal API. */
export function InboundImportModal({ open, onClose, clients }: { open: boolean; onClose: () => void; clients: PortalClientRow[] }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { accessToken } = useAuth();
  const [csv, setCsv] = useState('');
  const [importing, setImporting] = useState(false);
  const parsed = useMemo(() => parseCsv(csv, clients), [csv, clients]);

  async function submitImport() {
    if (!accessToken || importing) return;
    if (!parsed.shipments.length) { toast.error('Nothing to import', 'Add a header row + data rows.'); return; }
    setImporting(true);
    try {
      const res = await portalApi.importInbound(accessToken, parsed.shipments);
      await qc.invalidateQueries({ queryKey: ['inbound'] });
      toast.success('Imported', `${res.data.created} shipment${res.data.created === 1 ? '' : 's'}, ${res.data.itemsCreated} items${res.data.skipped ? ` · ${res.data.skipped} skipped` : ''}.`);
      onClose();
      setCsv('');
    } catch (err) {
      toast.error('Import failed', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setImporting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Import inbound (CSV feed)" maxWidth={640}>
      <div className="space-y-4">
        <p className="text-sm text-ink-3">
          Paste CSV with a header row. Columns (any order): <CodeToken>{CSV_COLUMNS}</CodeToken>.
          One row per item; rows sharing a reference are grouped into one shipment.
          <CodeToken>client</CodeToken> matches a client name or id.
        </p>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={'client,reference,supplier,expected_date,sku,name,qty\nHUGRAB,PO-1024,Acme,2026-06-05,HU-10,Leeds Line V2,120'}
          className={field + ' h-44 py-2 font-mono text-xs'}
        />
        <div className="flex items-center justify-between">
          <p className="text-xs text-ink-3">{parsed.shipments.length} shipment{parsed.shipments.length === 1 ? '' : 's'} · {parsed.items} item{parsed.items === 1 ? '' : 's'} parsed</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={submitImport} disabled={importing || !parsed.shipments.length} leadingIcon={<Upload size={15} />}>{importing ? 'Importing…' : 'Import'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
