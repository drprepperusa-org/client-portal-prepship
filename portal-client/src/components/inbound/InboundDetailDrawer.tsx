import { InboundReceiveModal } from './InboundReceiveModal';
import { useEffect, useState } from 'react';
import { Truck, PackageCheck } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { Chip } from '@/components/ui/Display';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/auth';
import { type PortalInbound } from '@/lib/api';
import { shortDate } from '@/lib/status';
import { STATUS_META, Cell } from './shared';

/** Detail + receive drawer for one inbound shipment. The receive flow seeds
 *  each line's quantity from expected units when its protected worksheet opens. */
export function InboundDetailDrawer({
  selected,
  onClose,
  canReceiveInventory,
}: {
  selected: PortalInbound | null;
  onClose: () => void;
  canReceiveInventory: boolean;
}) {
  const { userId } = useAuth();
  const [receiving, setReceiving] = useState(false);
  useEffect(() => { setReceiving(false); }, [selected?.id, userId]);

  return (
    <>
    <Drawer open={!!selected} onClose={() => { if (!receiving) onClose(); }} title={selected ? (selected.reference ?? `Inbound #${selected.id}`) : ''}>
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

          {selected.notes && (
            <div className="rounded-glass-sm bg-white/60 p-4 ring-1 ring-slate-200/70">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Notes</p>
              <p className="text-sm text-ink-2">{selected.notes}</p>
            </div>
          )}

          {/* Receive controls (admin, not already received) */}
          {canReceiveInventory && selected.status !== 'received' && selected.status !== 'cancelled' && (
            <Button className="w-full" onClick={() => setReceiving(true)} leadingIcon={<PackageCheck size={16} />}>Receive shipment</Button>
          )}
        </div>
      )}
    </Drawer>
    {receiving && selected && <InboundReceiveModal key={`${userId}:${selected.id}`} shipment={selected}
      onClose={() => setReceiving(false)} onReceived={() => { setReceiving(false); onClose(); }} />}
    </>
  );
}
