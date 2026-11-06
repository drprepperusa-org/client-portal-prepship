import { InboundReceiveModal } from './InboundReceiveModal';
import { useEffect, useState } from 'react';
import { PackageCheck } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { Chip } from '@/components/ui/Display';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/auth';
import { type PortalInbound } from '@/lib/api';
import { shortDate } from '@/lib/status';
import { STATUS_META } from './shared';

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
    <Drawer width={1180} open={!!selected} onClose={() => { if (!receiving) onClose(); }} title={selected ? (selected.reference ?? `Inbound #${selected.id}`) : ''}>
      {selected && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <Chip accent={(STATUS_META[selected.status]?.accent) ?? 'amber'}>{STATUS_META[selected.status]?.label ?? selected.status}</Chip>
            <span className="text-sm text-ink-3">Receiving worksheet</span>
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 border-y border-slate-200 py-4 sm:grid-cols-2">
            {[
              ['Client name', selected.clientName], ['Inbound shipment reference', selected.reference],
              ['Date received', selected.receivedDate ? shortDate(selected.receivedDate) : null],
              ['Supplier', selected.supplier], ['Expected date', selected.expectedDate ? shortDate(selected.expectedDate) : null],
              ['Carrier / tracking', [selected.carrier, selected.trackingNumber].filter(Boolean).join(' · ')],
            ].filter(([, value]) => Boolean(value)).map(([label, value]) => (
              <div key={label} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] items-start gap-3 text-sm">
                <dt className="text-ink-2">{label}</dt>
                <dd className="break-words bg-amber-50 px-2 py-1 font-semibold text-ink">{value}</dd>
              </div>
            ))}
          </dl>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-ink">Shipment items</h3>
            <p className="mb-2 text-xs text-ink-2 md:hidden">Scroll sideways to compare expected and received units.</p>
            <div className="relative overflow-x-auto rounded-md border border-slate-300 bg-white focus-ring" role="region" aria-label="Shipment item quantities" tabIndex={0}>
              <table className="w-full min-w-[700px] table-fixed border-collapse text-left text-sm">
                <caption className="sr-only">Expected and received units for {selected.reference ?? `Inbound #${selected.id}`}</caption>
                <thead className="bg-sky-100 text-ink">
                  <tr>
                    <th scope="col" className="w-48 border-r border-slate-300 px-3 py-3 font-semibold">SKU</th>
                    <th scope="col" className="border-r border-slate-300 px-3 py-3 font-semibold">Product description</th>
                    <th scope="col" className="w-32 border-r border-slate-300 px-3 py-3 text-right font-semibold">Units expected</th>
                    <th scope="col" className="w-32 bg-emerald-100 px-3 py-3 text-right font-semibold">Units received</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {selected.items.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-ink-3">No line items recorded.</td></tr>}
                  {selected.items.map((it) => (
                    <tr key={it.id}>
                      <th scope="row" className="break-words border-r border-slate-200 px-3 py-2 font-normal text-ink">{it.sku ?? 'No SKU recorded'}</th>
                      <td className="break-words border-r border-slate-200 px-3 py-2 text-ink">{it.name ?? 'Unnamed product'}</td>
                      <td className="border-r border-slate-200 px-3 py-2 text-right tnum text-ink-2">{it.expectedQty.toLocaleString()}</td>
                      <td className="bg-emerald-100 px-3 py-2 text-right font-semibold tnum text-ink">{it.receivedQty.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-ink">
                  <tr><th scope="row" colSpan={2} className="border-r border-slate-200 px-3 py-3">Total units</th>
                    <td className="border-r border-slate-200 px-3 py-3 text-right tnum">{selected.expectedUnits.toLocaleString()}</td>
                    <td className="bg-emerald-100 px-3 py-3 text-right tnum">{selected.receivedUnits.toLocaleString()}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-2">Expected and received quantities are from this shipment’s recorded items.</p>
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
