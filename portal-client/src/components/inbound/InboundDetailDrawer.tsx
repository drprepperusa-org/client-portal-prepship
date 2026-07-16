import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Truck, PackageCheck } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { Chip } from '@/components/ui/Display';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth';
import { portalApi, type PortalInbound } from '@/lib/api';
import { shortDate } from '@/lib/status';
import { STATUS_META, field, Cell } from './shared';

/** Detail + receive drawer for one inbound shipment. The receive flow seeds
 *  each line's received qty from its expected qty whenever a new shipment is
 *  opened (same behavior as the old page-level openDetail). */
export function InboundDetailDrawer({
  selected,
  onClose,
  canReceiveInventory,
}: {
  selected: PortalInbound | null;
  onClose: () => void;
  canReceiveInventory: boolean;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const { accessToken } = useAuth();

  const [receiving, setReceiving] = useState(false);
  const [recvQty, setRecvQty] = useState<Record<number, string>>({});
  const [addToInv, setAddToInv] = useState(true);
  const [recvSaving, setRecvSaving] = useState(false);

  const selectedId = selected?.id;
  useEffect(() => {
    if (!selected) return;
    setReceiving(false);
    setRecvQty(Object.fromEntries(selected.items.map((it) => [it.id, String(it.expectedQty)])));
    setAddToInv(true);
    // Re-seed only when a different shipment is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function submitReceive() {
    if (!accessToken || !selected || recvSaving) return;
    setRecvSaving(true);
    try {
      const res = await portalApi.receiveInbound(accessToken, selected.id, {
        addToInventory: addToInv,
        items: selected.items.map((it) => ({ id: it.id, receivedQty: Number(recvQty[it.id]) || 0 })),
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['inbound'] }),
        qc.invalidateQueries({ queryKey: ['inventory'] }),
        qc.invalidateQueries({ queryKey: ['inventory-history'] }),
      ]);
      const matched = res.data.bumps.filter((b) => b.matched).length;
      const missed = res.data.bumps.filter((b) => !b.matched).length;
      toast.success('Received', addToInv ? `Inventory updated for ${matched} SKU${matched === 1 ? '' : 's'}${missed ? ` · ${missed} unmatched` : ''}.` : 'Marked as received.');
      onClose();
      setReceiving(false);
    } catch (err) {
      toast.error('Receive failed', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setRecvSaving(false);
    }
  }

  return (
    <Drawer open={!!selected} onClose={onClose} title={selected ? (selected.reference ?? `Inbound #${selected.id}`) : ''}>
      {selected && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <Chip accent={(STATUS_META[selected.status]?.accent) ?? 'amber'}>{STATUS_META[selected.status]?.label ?? selected.status}</Chip>
            <span className="text-sm text-ink-3">{shortDate(selected.expectedDate)}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Cell label="Supplier" value={selected.supplier ?? '—'} />
            <Cell label="Client" value={selected.clientName ?? '—'} />
            <Cell label="Carrier" value={selected.carrier ?? '—'} />
            <Cell label="Tracking" value={selected.trackingNumber ?? '—'} />
          </div>

          {!receiving ? (
            <div className="rounded-glass-sm bg-white/60 p-4 ring-1 ring-slate-200/70">
              <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3"><Truck size={13} /> Items ({selected.items.length})</p>
              <ul className="space-y-2">
                {selected.items.length === 0 && <li className="text-sm text-ink-3">No line items.</li>}
                {selected.items.map((it) => (
                  <li key={it.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate text-ink-2">{it.name ?? it.sku ?? 'Item'}{it.sku && it.name ? ` · ${it.sku}` : ''}</span>
                    <span className="shrink-0 tnum text-ink-3">{it.receivedQty}/{it.expectedQty}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded-glass-sm bg-white/60 p-4 ring-1 ring-brand-200">
              <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-700"><PackageCheck size={13} /> Receive items</p>
              <ul className="space-y-2">
                {selected.items.map((it) => (
                  <li key={it.id} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-ink-2">{it.name ?? it.sku ?? 'Item'}{it.sku ? ` · ${it.sku}` : ''}</span>
                    <span className="shrink-0 text-xs text-ink-3">exp {it.expectedQty}</span>
                    <input type="number" min={0} value={recvQty[it.id] ?? ''} onChange={(e) => setRecvQty((m) => ({ ...m, [it.id]: e.target.value }))} className={field} style={{ width: 76, height: 36 }} />
                  </li>
                ))}
              </ul>
              <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-ink-2">
                <input type="checkbox" checked={addToInv} onChange={(e) => setAddToInv(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600" />
                Add received units to inventory (matched by SKU)
              </label>
            </div>
          )}

          {selected.notes && !receiving && (
            <div className="rounded-glass-sm bg-white/60 p-4 ring-1 ring-slate-200/70">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Notes</p>
              <p className="text-sm text-ink-2">{selected.notes}</p>
            </div>
          )}

          {/* Receive controls (admin, not already received) */}
          {canReceiveInventory && selected.status !== 'received' && selected.status !== 'cancelled' && (
            receiving ? (
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setReceiving(false)} disabled={recvSaving}>Cancel</Button>
                <Button onClick={submitReceive} disabled={recvSaving} leadingIcon={<PackageCheck size={15} />}>{recvSaving ? 'Receiving…' : 'Confirm receive'}</Button>
              </div>
            ) : (
              <Button className="w-full" onClick={() => setReceiving(true)} leadingIcon={<PackageCheck size={16} />}>Receive shipment</Button>
            )
          )}
        </div>
      )}
    </Drawer>
  );
}
