import { useEffect, useState } from 'react';
import { ChevronLeft, MapPin, PackageCheck, ScanLine } from 'lucide-react';
import { field } from '@/components/inbound/shared';
import { ReturnInspectionEditor } from '@/components/returns/ReturnInspectionEditor';
import { Chip } from '@/components/ui/Display';
import { Modal } from '@/components/ui/Modal';
import { useReturnDetail, useReturnsReceiving } from '@/lib/hooks';
import { shortDate } from '@/lib/status';
import { useDebounced } from '@/lib/useDebounced';
import { type Accent } from '@/lib/accents';

/**
 * Mobile-friendly operator receiving flow. The backend independently enforces
 * operator permission and tenant scope for every inspection write.
 */
const STATUS_META: Record<string, { label: string; accent: Accent }> = {
  requested: { label: 'Requested', accent: 'amber' },
  label_created: { label: 'Label created', accent: 'sky' },
  in_transit: { label: 'In transit', accent: 'indigo' },
  received: { label: 'Received', accent: 'teal' },
  inspected: { label: 'Inspected', accent: 'violet' },
};

function statusMeta(status: string) {
  return STATUS_META[status] ?? { label: status, accent: 'amber' as Accent };
}

export function ReturnReceivingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    if (open) setSelectedId(null);
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={selectedId ? 'Receive return' : 'Receiving'} maxWidth={560}>
      {selectedId == null ? (
        <ReceivingList onPick={setSelectedId} />
      ) : (
        <ReceivingDetail id={selectedId} onBack={() => setSelectedId(null)} onDone={onClose} />
      )}
    </Modal>
  );
}

function ReceivingList({ onPick }: { onPick: (id: number) => void }) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 300);
  const query = useReturnsReceiving(debouncedSearch);
  const rows = query.data?.data ?? [];

  return (
    <div className="space-y-4">
      <label className="relative flex items-center">
        <ScanLine size={18} className="pointer-events-none absolute left-3 text-ink-3" />
        <input
          className={`${field} h-12 pl-10 text-base`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Scan or type tracking, order #, or return ref"
          aria-label="Scan or search returns to receive"
          autoFocus
          inputMode="search"
          enterKeyHint="search"
        />
      </label>

      {query.isLoading ? (
        <p className="py-8 text-center text-sm text-ink-3">Loading receiving queue...</p>
      ) : query.isError ? (
        <p className="py-8 text-center text-sm text-ink-3">Could not load the receiving queue.</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-3">
          {debouncedSearch ? 'No matching returns to receive.' : 'Nothing expected right now.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const status = statusMeta(row.status);
            return (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => onPick(row.id)}
                  className="focus-ring flex min-h-14 w-full items-center gap-3 rounded-glass-sm bg-white/60 p-3 text-left ring-1 ring-slate-200/70 transition-colors hover:bg-white/90"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-glass-sm bg-brand-50 text-brand-600">
                    <PackageCheck size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm font-semibold text-ink">
                      {row.returnReference}
                    </p>
                    <p className="truncate text-xs text-ink-3">
                      {row.clientName ?? '—'}{row.trackingNumber ? ` · ${row.trackingNumber}` : ''}
                    </p>
                  </div>
                  <Chip accent={status.accent} dot={false}>{status.label}</Chip>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ReceivingDetail({ id, onBack, onDone }: { id: number; onBack: () => void; onDone: () => void }) {
  const query = useReturnDetail(id);
  const detail = query.data?.data;

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="focus-ring inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-ink-3 hover:text-ink"
      >
        <ChevronLeft size={16} /> Back to list
      </button>

      {query.isLoading ? (
        <p className="py-8 text-center text-sm text-ink-3">Loading return...</p>
      ) : query.isError || !detail ? (
        <p className="py-8 text-center text-sm text-ink-3">Could not load this return.</p>
      ) : (
        <>
          <div className="rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate font-mono text-sm font-semibold text-ink">
                {detail.returnReference}
              </p>
              <Chip accent={statusMeta(detail.status).accent} dot={false}>{statusMeta(detail.status).label}</Chip>
            </div>
            <p className="mt-1 truncate text-xs text-ink-3">{detail.clientName ?? '—'}</p>
            {detail.trackingNumber && <p className="mt-1 truncate font-mono text-xs text-ink-3">{detail.trackingNumber}</p>}
          </div>

          <div className="rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Items</p>
            <ul className="space-y-2">
              {detail.items.length === 0 && <li className="text-sm text-ink-3">No items on this return.</li>}
              {detail.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{item.name ?? item.sku}</p>
                    <p className="truncate font-mono text-[11px] text-ink-3">{item.sku}</p>
                  </div>
                  <span className="shrink-0 text-sm tnum text-ink-2">×{item.quantity}</span>
                </li>
              ))}
            </ul>
          </div>

          <ReturnInspectionEditor
            returnId={id}
            mode="operator"
            onSaved={onDone}
            onCancel={onBack}
          />

          <p className="flex items-center gap-1 text-xs text-ink-3">
            <MapPin size={13} /> {detail.returnToLocationId ? `Location #${detail.returnToLocationId}` : 'Default location'}
          </p>

          {detail.inspections.length > 0 && (
            <div className="rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Previous inspection</p>
              {detail.inspections.map((inspection) => (
                <div key={inspection.id} className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
                  <Chip accent="teal" dot={false}>{inspection.status}</Chip>
                  {inspection.condition && <span>{inspection.condition}</span>}
                  {inspection.receivedAt && <span>· {shortDate(inspection.receivedAt)}</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
