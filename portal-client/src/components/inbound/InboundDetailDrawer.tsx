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
    <Drawer width={960} open={!!selected} onClose={() => { if (!receiving) onClose(); }} title={selected ? (selected.reference ?? `Inbound #${selected.id}`) : ''}>
      {selected && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <Chip accent={(STATUS_META[selected.status]?.accent) ?? 'amber'}>{STATUS_META[selected.status]?.label ?? selected.status}</Chip>
            <span className="text-sm text-ink-3">Receiving worksheet</span>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-slate-200 py-4 lg:grid-cols-3">
            {[
              ['Client', selected.clientName], ['Inbound reference', selected.reference],
              ['Date received', selected.receivedDate ? shortDate(selected.receivedDate) : null],
              ['Supplier', selected.supplier], ['Expected date', selected.expectedDate ? shortDate(selected.expectedDate) : null],
              ['Carrier / tracking', [selected.carrier, selected.trackingNumber].filter(Boolean).join(' · ')],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs text-ink-3">{label}</dt>
                <dd className="mt-1 break-words text-sm font-semibold text-ink">{value || 'Not recorded'}</dd>
              </div>
            ))}
          </dl>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-ink">Shipment items</h3>
            <div className="overflow-x-auto rounded-glass-sm border border-slate-200 bg-white/60 focus-ring" role="region" aria-label="Shipment item quantities" tabIndex={0}>
              <table className="w-full table-fixed text-left text-sm">
                <caption className="sr-only">Expected and received units for {selected.reference ?? `Inbound #${selected.id}`}</caption>
                <thead className="bg-slate-50 text-xs text-ink-2">
                  <tr>
                    <th scope="col" className="px-3 py-3 font-medium sm:px-4">SKU / Product description</th>
                    <th scope="col" className="w-20 px-2 py-3 text-right font-medium sm:w-32 sm:px-4">Units expected</th>
                    <th scope="col" className="w-20 bg-emerald-50 px-2 py-3 text-right font-medium text-emerald-800 sm:w-32 sm:px-4">Units received</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {selected.items.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-ink-3">No line items recorded.</td></tr>}
                  {selected.items.map((it) => (
                    <tr key={it.id}>
                      <th scope="row" className="px-3 py-3 font-normal sm:px-4">
                        <span className="block break-words text-ink">{it.name ?? 'Unnamed product'}</span>
                        <span className="mt-1 block break-all font-mono text-xs text-ink-3">{it.sku ?? 'No SKU recorded'}</span>
                      </th>
                      <td className="break-words px-2 py-3 text-right tnum text-ink-2 sm:px-4">{it.expectedQty.toLocaleString()}</td>
                      <td className="break-words bg-emerald-50/50 px-2 py-3 text-right font-semibold tnum text-ink sm:px-4">{it.receivedQty.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-ink">
                  <tr><th scope="row" className="px-3 py-3 sm:px-4">Total units</th>
                    <td className="break-words px-2 py-3 text-right tnum sm:px-4">{selected.expectedUnits.toLocaleString()}</td>
                    <td className="break-words bg-emerald-50 px-2 py-3 text-right tnum sm:px-4">{selected.receivedUnits.toLocaleString()}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-3">Expected units come from the shipment record. Units per carton, cartons sent/received, and fulfillment channel are not recorded for this worksheet.</p>
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
