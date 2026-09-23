import { validateInboundCreate, CREATE_ITEMS_MAX } from '@client-portal-contracts/create-form-validation';
import { useFieldValidation } from '@/components/ui/useFieldValidation';
import { useRef, useState } from 'react';
import type { NewInboundInput, PortalInbound } from '@client-portal-contracts/inbound';
import type { ApiError } from '@/lib/api/transport';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { DraftModal } from '@/components/ui/DraftModal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth';
import { portalApi, type PortalClientRow } from '@/lib/api';
import { DatePicker } from '@/components/ui/datetime';
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
  validation,
}: {
  item: DraftItem;
  index: number;
  onChange: (index: number, key: keyof DraftItem, value: string) => void;
  onRemove: (index: number) => void;
  validation: ReturnType<typeof useFieldValidation>;
}) {
  return (
    // flex-wrap so on a narrow phone the Qty + remove drop below SKU/name
    // instead of squeezing the SKU field down to a few characters.
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex min-w-[180px] flex-1 gap-2">
        <input
          className={field}
          style={{ flex: 1 }}
          {...validation.props(`items.${index}.sku`)}
          aria-label={`SKU for item ${index + 1}`}
          value={item.sku}
          onChange={(e) => onChange(index, 'sku', e.target.value)}
          placeholder="SKU"
        />
        <input
          className={field}
          style={{ flex: 2 }}
          {...validation.props(`items.${index}.name`)}
          aria-label={`Name for item ${index + 1}`}
          value={item.name}
          onChange={(e) => onChange(index, 'name', e.target.value)}
          placeholder="Item name"
        />
      </div>
      <input
        className={field}
        style={{ width: 80 }}
        type="number"
        min={0}
        {...validation.props(`items.${index}.expectedQty`)}
        aria-label={`Expected quantity for item ${index + 1}`}
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
      <div className="w-full">
        {validation.feedback(`items.${index}.sku`)}
        {validation.feedback(`items.${index}.name`)}
        {validation.feedback(`items.${index}.expectedQty`)}
      </div>
    </div>
  );
}

/** "New inbound" modal: draft form + line items, submits via the portal API. */
type InboundCreateProps = { open: boolean; onClose: () => void; clients: PortalClientRow[]; onCreated?: (shipment: PortalInbound) => void };
export function InboundCreateModal(props: InboundCreateProps) {
  const { userId } = useAuth();
  return props.open ? <InboundDraft key={userId} {...props} /> : null;
}

function InboundDraft({ onClose, clients, onCreated }: InboundCreateProps) {
  const toast = useToast();
  const qc = useQueryClient();
  const { accessToken } = useAuth();
  const [draft, setDraft] = useState(emptyDraft());
  const [saving, setSaving] = useState(false);
  const attempt = useRef<NewInboundInput | null>(null);
  const sending = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const validation = useFieldValidation(validateInboundCreate(draft));

  const setField = (k: keyof Draft, v: unknown) => setDraft((d) => ({ ...d, [k]: v }) as Draft);
  const setItem = (i: number, k: keyof DraftItem, v: string) => setDraft((d) => ({ ...d, items: d.items.map((it, j) => (j === i ? { ...it, [k]: v } : it)) }));
  const addItem = () => setDraft((d) => ({ ...d, items: [...d.items, { sku: '', name: '', expectedQty: '' }] }));
  const removeItem = (i: number) => setDraft((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }));

  async function submitCreate() {
    if (!accessToken || sending.current) return;
    if (!attempt.current && !validation.check()) return;
    const selectedIndices = draft.items.flatMap((item, index) => item.sku.trim() || item.name.trim() ? [index] : []);
    setSaving(true);
    sending.current = true;
    try {
      attempt.current ??= {
        idempotencyKey: crypto.randomUUID(),
        clientId: draft.clientId ? Number(draft.clientId) : undefined,
        reference: draft.reference || undefined,
        supplier: draft.supplier || undefined,
        status: draft.status,
        carrier: draft.carrier || undefined,
        trackingNumber: draft.trackingNumber || undefined,
        expectedDate: draft.expectedDate || undefined,
        notes: draft.notes || undefined,
        items: draft.items.filter((it) => it.sku.trim() || it.name.trim()).map((it) => ({ sku: it.sku.trim() || undefined, name: it.name.trim() || undefined, expectedQty: Number(it.expectedQty) || 0 })),
      };
      const result = await portalApi.createInbound(accessToken, attempt.current);
      // A refresh failure cannot turn a committed create into a failed save.
      void qc.invalidateQueries({ queryKey: ['inbound'] }).catch(() => {});
      toast.success('Inbound saved', result.data.reference ?? `Shipment #${result.data.id}`);
      if (Array.isArray(result.data.items)) onCreated?.(result.data);
      onClose();
    } catch (err) {
      const status = (err as ApiError)?.status;
      // These responses are definitive rejections before persistence. Other failures may follow commit.
      if (!uncertain && (status === 400 || status === 401 || status === 403 || status === 422)) {
        attempt.current = null;
        setUncertain(false);
      } else setUncertain(true);
      validation.reject(err, selectedIndices);
    } finally {
      sending.current = false;
      setSaving(false);
    }
  }

  return (
    <DraftModal dirty={uncertain || JSON.stringify(draft) !== JSON.stringify(emptyDraft())} saving={saving} onClose={onClose} title="New inbound shipment" maxWidth={640}
      discardMessage={uncertain ? 'This shipment may already be saved. Keep editing and use Retry save to confirm it. Discarding closes this form but does not undo a saved shipment.' : undefined}>
      {(requestClose) => (
      <div ref={validation.ref} onChangeCapture={validation.changed} className="space-y-4">
        {validation.summary}
        {uncertain && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-ink-2">
          We could not confirm the save. Retry save checks the same request without creating a second shipment. Your original details are kept below.
        </p>}
        <fieldset disabled={uncertain} className="min-w-0 space-y-4">
        <p className="text-xs text-ink-3">Header fields are optional. For each quantity entered, add a SKU or item name. Expected quantities must be whole numbers of zero or more.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Labeled label="Client" feedback={validation.feedback('clientId')}>
            <select {...validation.props('clientId')} value={draft.clientId ?? ''} onChange={(e) => setField('clientId', e.target.value ? Number(e.target.value) : undefined)} className={field}>
              <option value="">— Select client —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name ?? `Client ${c.id}`}</option>)}
            </select>
          </Labeled>
          <Labeled label="Status" feedback={validation.feedback('status')}>
            <select {...validation.props('status')} value={draft.status} onChange={(e) => setField('status', e.target.value)} className={field}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
          </Labeled>
          <Labeled label="Reference / PO #" feedback={validation.feedback('reference')}>
            <input {...validation.props('reference')} className={field} value={draft.reference} onChange={(e) => setField('reference', e.target.value)} placeholder="PO-1024" />
          </Labeled>
          <Labeled label="Supplier" feedback={validation.feedback('supplier')}>
            <input {...validation.props('supplier')} className={field} value={draft.supplier} onChange={(e) => setField('supplier', e.target.value)} placeholder="Acme Wholesale" />
          </Labeled>
          <Labeled label="Expected date" feedback={validation.feedback('expectedDate')}>
            <div {...validation.props('expectedDate')}><DatePicker value={draft.expectedDate || null} onChange={(v) => { validation.changed(); setField('expectedDate', v); }} /></div>
          </Labeled>
          <Labeled label="Carrier" feedback={validation.feedback('carrier')}>
            <input {...validation.props('carrier')} className={field} value={draft.carrier} onChange={(e) => setField('carrier', e.target.value)} placeholder="UPS Freight" />
          </Labeled>
          <Labeled label="Tracking #" feedback={validation.feedback('trackingNumber')}>
            <input {...validation.props('trackingNumber')} className={field} value={draft.trackingNumber} onChange={(e) => setField('trackingNumber', e.target.value)} />
          </Labeled>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Items</p>
          <div className="space-y-2" {...validation.props('items')}>
            {draft.items.map((it, i) => (
              <DraftItemRow key={i} item={it} index={i} onChange={setItem} onRemove={(i) => { validation.changed(); removeItem(i); }} validation={validation} />
            ))}
          </div>
          {validation.feedback('items')}
          <button
            disabled={draft.items.length >= CREATE_ITEMS_MAX}
            onClick={() => { validation.changed(); addItem(); }}
            className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:text-brand-600"
          >
            <Plus size={14} /> Add item
          </button>
        </div>
        <Labeled label="Notes" feedback={validation.feedback('notes')}>
          <textarea {...validation.props('notes')} className={field + ' h-20 py-2'} value={draft.notes} onChange={(e) => setField('notes', e.target.value)} />
        </Labeled>
        </fieldset>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={requestClose}>Cancel</Button>
          <Button onClick={submitCreate} disabled={saving}>{saving ? 'Saving…' : uncertain ? 'Retry save' : 'Create inbound'}</Button>
        </div>
      </div>
      )}
    </DraftModal>
  );
}
