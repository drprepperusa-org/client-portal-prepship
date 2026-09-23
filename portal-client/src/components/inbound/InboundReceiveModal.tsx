import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth';
import { portalApi, type PortalInbound } from '@/lib/api';
import { DraftModal } from '@/components/ui/DraftModal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useFieldValidation } from '@/components/ui/useFieldValidation';
import { validateInboundReceive } from '@client-portal-contracts/inbound-receive-validation';
import { field } from './shared';

/** Mounted only while receiving; draft state survives errors, never a successful close. */
export function InboundReceiveModal({ shipment, onClose, onReceived }: {
  shipment: PortalInbound; onClose: () => void; onReceived: () => void;
}) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [initial] = useState(() => shipment.items.map(item => ({ id: item.id, receivedQty: String(item.expectedQty) })));
  const [items, setItems] = useState(initial);
  const [addToInventory, setAddToInventory] = useState(true);
  const [saving, setSaving] = useState(false);
  const sending = useRef(false);
  const [edited, setEdited] = useState(false);
  const validation = useFieldValidation(validateInboundReceive({ items, addToInventory }));
  const dirty = edited || !addToInventory || JSON.stringify(items) !== JSON.stringify(initial);

  function refresh() {
    // A committed receive stays successful even when a subsequent read fails.
    for (const key of ['inbound', 'inbound-receipts', 'inventory', 'inventory-history']) {
      void qc.invalidateQueries({ queryKey: [key] }).catch(() => {});
    }
  }

  async function submit() {
    if (!accessToken || sending.current || !validation.check()) return;
    sending.current = true; setSaving(true);
    try {
      const result = await portalApi.receiveInbound(accessToken, shipment.id, {
        addToInventory, items: items.map(item => ({ id: item.id, receivedQty: Number(item.receivedQty) })),
      });
      refresh();
      const matched = result.data.bumps.filter(bump => bump.matched).length;
      const missed = result.data.bumps.filter(bump => !bump.matched).length;
      toast.success('Shipment received', addToInventory
        ? `Inventory updated for ${matched} item${matched === 1 ? '' : 's'}.${missed ? ` ${missed} unmatched; inventory was not added for those items.` : ''}`
        : 'Saved as received without adding inventory.');
      onReceived();
    } catch (error) {
      validation.reject(error);
      setEdited(true); // also protect an unchanged default worksheet after an uncertain response
    } finally { sending.current = false; setSaving(false); }
  }

  return (
    <DraftModal dirty={dirty} saving={saving} onClose={onClose} title="Receive shipment" maxWidth={600}>
      {requestClose => (
        <div ref={validation.ref} onChangeCapture={() => { setEdited(true); validation.changed(); }} className="space-y-4">
          <p className="font-semibold text-ink">{shipment.reference ?? `Inbound #${shipment.id}`}</p>
          <p className="text-sm text-ink-2">Enter the quantity that arrived for every item. Use 0 if none arrived. Quantities must be whole numbers.</p>
          {validation.summary}
          {validation.feedback('items')}
          <div className="space-y-3">
            {shipment.items.map((item, index) => (
              <div key={item.id} className="rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
                <p className="break-words text-sm font-medium text-ink">{item.name ?? item.sku ?? 'Item'}{item.name && item.sku ? ` · ${item.sku}` : ''}</p>
                <p className="mt-1 text-xs text-ink-3">Expected: {item.expectedQty}</p>
                <label className="mt-2 block text-xs text-ink-2">
                  Received quantity
                  <input type="number" min={0} max={2147483647} step={1} className={`${field} mt-1`}
                    aria-label={`Received quantity for item ${index + 1}`} {...validation.props(`items.${index}.receivedQty`)}
                    value={items[index]?.receivedQty ?? ''}
                    onChange={event => setItems(previous => previous.map((line, i) => i === index ? { ...line, receivedQty: event.target.value } : line))} />
                </label>
                {validation.feedback(`items.${index}.receivedQty`)}
              </div>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={addToInventory} onChange={event => setAddToInventory(event.target.checked)} />
            Add received units to inventory (matched by SKU)
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={requestClose}>Cancel</Button>
            <Button onClick={submit}>{saving ? 'Receiving…' : 'Confirm receive'}</Button>
          </div>
        </div>
      )}
    </DraftModal>
  );
}
