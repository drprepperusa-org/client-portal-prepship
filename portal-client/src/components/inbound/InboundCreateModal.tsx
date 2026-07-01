import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth';
import { portalApi, type PortalClientRow } from '@/lib/api';
import { STATUSES, STATUS_META, field, Labeled } from './shared';

type DraftItem = { sku: string; name: string; expectedQty: string };
type Draft = {
  clientId?: number; reference: string; supplier: string; status: string;
  carrier: string; trackingNumber: string; expectedDate: string; notes: string; items: DraftItem[];
};
const emptyDraft = (): Draft => ({
  clientId: undefined, reference: '', supplier: '', status: 'expected',
  carrier: '', trackingNumber: '', expectedDate: '', notes: '', items: [{ sku: '', name: '', expectedQty: '' }],
});

function DraftItemRow({
  item,
  index,
  onChange,
  onRemove,
}: {
  item: DraftItem;
  index: number;
  onChange: (index: number, key: keyof DraftItem, value: string) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        className={field}
        style={{ flex: 1 }}
        value={item.sku}
        onChange={(e) => onChange(index, 'sku', e.target.value)}
        placeholder="SKU"
      />
      <input
        className={field}
        style={{ flex: 2 }}
        value={item.name}
        onChange={(e) => onChange(index, 'name', e.target.value)}
        placeholder="Item name"
      />
      <input
        className={field}
        style={{ width: 80 }}
        type="number"
        min={0}
        value={item.expectedQty}
        onChange={(e) => onChange(index, 'expectedQty', e.target.value)}
        placeholder="Qty"
      />
      <button
        onClick={() => onRemove(index)}
        aria-label="Remove item"
        className="focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-rose-50 hover:text-rose-500"
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

/** "New inbound" modal: draft form + line items, submits via the portal API. */
export function InboundCreateModal({ open, onClose, clients }: { open: boolean; onClose: () => void; clients: PortalClientRow[] }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { accessToken } = useAuth();
  const [draft, setDraft] = useState(emptyDraft());
  const [saving, setSaving] = useState(false);

  const setField = (k: keyof Draft, v: unknown) => setDraft((d) => ({ ...d, [k]: v }) as Draft);
  const setItem = (i: number, k: keyof DraftItem, v: string) => setDraft((d) => ({ ...d, items: d.items.map((it, j) => (j === i ? { ...it, [k]: v } : it)) }));
  const addItem = () => setDraft((d) => ({ ...d, items: [...d.items, { sku: '', name: '', expectedQty: '' }] }));
  const removeItem = (i: number) => setDraft((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }));

  async function submitCreate() {
    if (!accessToken || saving) return;
    setSaving(true);
    try {
      await portalApi.createInbound(accessToken, {
        clientId: draft.clientId ? Number(draft.clientId) : undefined,
        reference: draft.reference || undefined,
        supplier: draft.supplier || undefined,
        status: draft.status,
        carrier: draft.carrier || undefined,
        trackingNumber: draft.trackingNumber || undefined,
        expectedDate: draft.expectedDate || undefined,
        notes: draft.notes || undefined,
        items: draft.items.filter((it) => it.sku.trim() || it.name.trim()).map((it) => ({ sku: it.sku.trim() || undefined, name: it.name.trim() || undefined, expectedQty: Number(it.expectedQty) || 0 })),
      });
      await qc.invalidateQueries({ queryKey: ['inbound'] });
      toast.success('Inbound created', 'The receiving record was added.');
      onClose();
      setDraft(emptyDraft());
    } catch (err) {
      toast.error('Could not create', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New inbound shipment" maxWidth={640}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Labeled label="Client">
            <select value={draft.clientId ?? ''} onChange={(e) => setField('clientId', e.target.value ? Number(e.target.value) : undefined)} className={field}>
              <option value="">— Select client —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name ?? `Client ${c.id}`}</option>)}
            </select>
          </Labeled>
          <Labeled label="Status">
            <select value={draft.status} onChange={(e) => setField('status', e.target.value)} className={field}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
          </Labeled>
          <Labeled label="Reference / PO #"><input className={field} value={draft.reference} onChange={(e) => setField('reference', e.target.value)} placeholder="PO-1024" /></Labeled>
          <Labeled label="Supplier"><input className={field} value={draft.supplier} onChange={(e) => setField('supplier', e.target.value)} placeholder="Acme Wholesale" /></Labeled>
          <Labeled label="Expected date"><input type="date" className={field} value={draft.expectedDate} onChange={(e) => setField('expectedDate', e.target.value)} /></Labeled>
          <Labeled label="Carrier"><input className={field} value={draft.carrier} onChange={(e) => setField('carrier', e.target.value)} placeholder="UPS Freight" /></Labeled>
          <Labeled label="Tracking #"><input className={field} value={draft.trackingNumber} onChange={(e) => setField('trackingNumber', e.target.value)} /></Labeled>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Items</p>
          <div className="space-y-2">
            {draft.items.map((it, i) => (
              <DraftItemRow key={i} item={it} index={i} onChange={setItem} onRemove={removeItem} />
            ))}
          </div>
          <button
            onClick={addItem}
            className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:text-brand-600"
          >
            <Plus size={14} /> Add item
          </button>
        </div>
        <Labeled label="Notes"><textarea className={field + ' h-20 py-2'} value={draft.notes} onChange={(e) => setField('notes', e.target.value)} /></Labeled>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submitCreate} disabled={saving}>{saving ? 'Saving…' : 'Create inbound'}</Button>
        </div>
      </div>
    </Modal>
  );
}
