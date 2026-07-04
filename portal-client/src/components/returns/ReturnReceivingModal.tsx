import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ScanLine, PackageCheck, ChevronLeft, MapPin, Camera, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Display';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth';
import { useReturnsReceiving, useReturnDetail } from '@/lib/hooks';
import { useDebounced } from '@/lib/useDebounced';
import { shortDate } from '@/lib/status';
import { portalApi, type ReturnInspectionCondition } from '@/lib/api';
import { field, Labeled } from '@/components/inbound/shared';
import { type Accent } from '@/lib/accents';

/**
 * CP-030 — Mobile-friendly 3PL return receiving + inspection flow. OPERATOR-ONLY:
 * the page gates the entry point on the operator role AND the backend 403s a
 * client user on every write (the true guard). Phone-first: single column, large
 * tap targets, a scan/search box, a scannable receiving list, a return detail,
 * and an inspection form with optional photo/video capture.
 *
 * AUTHORITY BOUNDARY: this form records the warehouse's receiving ack only. It
 * never computes rates/carrier/price and never issues refunds (out of scope).
 * Media is METADATA-CANONICAL: this repo has no object-storage upload plumbing,
 * so a captured file is previewed locally and its metadata is what the backend
 * persists (storageRef). Real binary upload depends on a storage backend.
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

// The agreed condition enum (mirrors the backend INSPECTION_CONDITIONS exactly).
const CONDITIONS: Array<{ value: ReturnInspectionCondition; label: string }> = [
  { value: 'sealed_new', label: 'Sealed / new' },
  { value: 'opened_good', label: 'Opened · good' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'missing_item', label: 'Missing item' },
  { value: 'wrong_item', label: 'Wrong item' },
  { value: 'other', label: 'Other' },
];

export function ReturnReceivingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Reset to the list whenever the modal is (re)opened.
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

/** Scan/search + the scannable list of returns to receive. */
function ReceivingList({ onPick }: { onPick: (id: number) => void }) {
  const [q, setQ] = useState('');
  const debouncedQ = useDebounced(q, 300);
  const query = useReturnsReceiving(debouncedQ);
  const rows = query.data?.data ?? [];

  return (
    <div className="space-y-4">
      {/* Scan / search — a phone's keyboard or a wedge scanner both type here. */}
      <label className="relative flex items-center">
        <ScanLine size={18} className="pointer-events-none absolute left-3 text-ink-3" />
        <input
          className={field + ' h-12 pl-10 text-base'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Scan or type tracking, order #, or return id"
          aria-label="Scan or search returns to receive"
          autoFocus
          inputMode="search"
          enterKeyHint="search"
        />
      </label>

      {query.isLoading ? (
        <p className="py-8 text-center text-sm text-ink-3">Loading receiving queue…</p>
      ) : query.isError ? (
        <p className="py-8 text-center text-sm text-ink-3">Couldn’t load the receiving queue.</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-3">
          {debouncedQ ? 'No matching returns to receive.' : 'Nothing expected right now.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const m = statusMeta(r.status);
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onPick(r.id)}
                  className="focus-ring flex w-full items-center gap-3 rounded-glass-sm bg-white/60 p-3 text-left ring-1 ring-slate-200/70 transition-colors hover:bg-white/90"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-glass-sm bg-brand-50 text-brand-600">
                    <PackageCheck size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">
                      {r.orderNumber ?? (r.orderId ? `#${r.orderId}` : `Return #${r.id}`)}
                    </p>
                    <p className="truncate text-xs text-ink-3">
                      {r.clientName ?? '—'}
                      {r.trackingNumber ? ` · ${r.trackingNumber}` : ''}
                    </p>
                  </div>
                  <Chip accent={m.accent} dot={false}>{m.label}</Chip>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The receiving detail (order#, items, tracking, return-to location) + the
 *  inspection form with optional photo/video capture. */
function ReceivingDetail({ id, onBack, onDone }: { id: number; onBack: () => void; onDone: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { accessToken } = useAuth();
  const q = useReturnDetail(id);
  const d = q.data?.data;

  const [condition, setCondition] = useState<ReturnInspectionCondition | ''>('');
  const [receivedAt, setReceivedAt] = useState(() => toLocalInput(new Date()));
  const [comments, setComments] = useState('');
  const [media, setMedia] = useState<CapturedMedia[]>([]);
  const [saving, setSaving] = useState(false);

  const canSave = useMemo(() => Boolean(receivedAt) && !saving, [receivedAt, saving]);

  async function submit() {
    if (!accessToken || !canSave) return;
    setSaving(true);
    try {
      const res = await portalApi.recordInspection(accessToken, id, {
        receivedAt: fromLocalInput(receivedAt),
        condition: condition || undefined,
        comments: comments.trim() || undefined,
      });
      void res.data.id;

      // Photos/videos are captured + previewed locally for the operator's own
      // check during receiving, but are NOT persisted yet: this repo has no
      // durable media-storage backend (Supabase is auth-only), and posting an
      // ephemeral blob: object URL as the storageRef would leave the CLIENT a
      // dead link in the return detail. The return_inspection_media table + the
      // POST .../media endpoint (portalApi.addInspectionMedia) are built and
      // ready — once a storage bucket is configured, upload the file, get a
      // hosted URL, and post THAT as storageRef (the row shape is unchanged).
      if (media.length > 0) {
        toast.warning(
          'Photos not saved yet',
          'Photo/video capture is preview-only until durable media storage is configured; the inspection notes were saved.',
        );
      }

      await qc.invalidateQueries({ queryKey: ['returns'] });
      await qc.invalidateQueries({ queryKey: ['return', id] });
      await qc.invalidateQueries({ queryKey: ['returns-receiving'] });
      toast.success('Return received', condition ? 'Inspection recorded.' : 'Marked received.');
      onDone();
    } catch (err) {
      toast.error('Could not save', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function onCapture(files: FileList | null) {
    if (!files) return;
    const next: CapturedMedia[] = [];
    for (const f of Array.from(files)) {
      next.push({
        id: `${f.name}-${f.size}-${f.lastModified}`,
        mediaType: f.type.startsWith('video') ? 'video' : 'photo',
        storageRef: URL.createObjectURL(f),
        contentType: f.type || null,
        sizeBytes: f.size || null,
        name: f.name,
      });
    }
    setMedia((prev) => [...prev, ...next]);
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="focus-ring -ml-1 inline-flex items-center gap-1 rounded-lg px-1 py-0.5 text-sm text-ink-3 hover:text-ink"
      >
        <ChevronLeft size={16} /> Back to list
      </button>

      {q.isLoading ? (
        <p className="py-8 text-center text-sm text-ink-3">Loading return…</p>
      ) : q.isError || !d ? (
        <p className="py-8 text-center text-sm text-ink-3">Couldn’t load this return.</p>
      ) : (
        <>
          {/* Header: order + status + return-to location */}
          <div className="rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ink">{d.orderNumber ?? `#${d.orderId ?? id}`}</p>
              <Chip accent={statusMeta(d.status).accent} dot={false}>{statusMeta(d.status).label}</Chip>
            </div>
            <p className="mt-1 truncate text-xs text-ink-3">{d.clientName ?? '—'}</p>
            {d.trackingNumber && <p className="mt-1 truncate font-mono text-xs text-ink-3">{d.trackingNumber}</p>}
          </div>

          {/* Returned items */}
          <div className="rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Items</p>
            <ul className="space-y-2">
              {d.items.length === 0 && <li className="text-sm text-ink-3">No items on this return.</li>}
              {d.items.map((it) => (
                <li key={it.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{it.name ?? it.sku}</p>
                    {it.sku && <p className="truncate font-mono text-[11px] text-ink-3">{it.sku}</p>}
                  </div>
                  <span className="shrink-0 text-sm tnum text-ink-2">×{it.quantity}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Inspection form */}
          <div className="space-y-3">
            <Labeled label="Received date/time">
              <input
                type="datetime-local"
                className={field + ' h-12 text-base'}
                value={receivedAt}
                onChange={(e) => setReceivedAt(e.target.value)}
              />
            </Labeled>

            <div>
              <span className="mb-1 block text-xs font-medium text-ink-2">Condition</span>
              <div className="grid grid-cols-2 gap-2">
                {CONDITIONS.map((c) => {
                  const active = condition === c.value;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setCondition(active ? '' : c.value)}
                      aria-pressed={active}
                      className={
                        'focus-ring min-h-[44px] rounded-glass-sm px-3 py-2 text-sm font-medium ring-1 transition-colors ' +
                        (active
                          ? 'bg-brand-600 text-white ring-brand-600'
                          : 'bg-white/60 text-ink-2 ring-slate-200/70 hover:bg-white/90')
                      }
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <Labeled label="Comments (optional)">
              <textarea
                className={field + ' h-20 py-2'}
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                placeholder="Notes about the returned goods…"
              />
            </Labeled>

            {/* Photo / video capture — a mobile-capture file input opens the
                camera on a phone. Files are previewed locally; their metadata is
                what the backend persists (see the AUTHORITY BOUNDARY note above). */}
            <div>
              <span className="mb-1 block text-xs font-medium text-ink-2">Photos / video (optional)</span>
              <label className="focus-within:ring-brand-400 flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-glass-sm border border-dashed border-slate-300 bg-white/60 py-3 text-sm font-medium text-ink-2 ring-1 ring-slate-200/70 hover:bg-white/90">
                <Camera size={18} /> Capture photo or video
                <input
                  type="file"
                  accept="image/*,video/*"
                  capture="environment"
                  multiple
                  className="sr-only"
                  onChange={(e) => onCapture(e.target.files)}
                />
              </label>
              {media.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {media.map((m) => (
                    <li
                      key={m.id}
                      className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs text-ink-2"
                    >
                      {m.mediaType === 'video' ? 'Video' : 'Photo'}
                      <span className="max-w-[120px] truncate text-ink-3">· {m.name}</span>
                      <button
                        type="button"
                        aria-label="Remove"
                        onClick={() => setMedia((prev) => prev.filter((x) => x.id !== m.id))}
                        className="focus-ring rounded p-0.5 text-ink-3 hover:text-ink"
                      >
                        <X size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <span className="flex items-center gap-1 text-xs text-ink-3">
              <MapPin size={13} /> {d.returnToLocationId ? `Location #${d.returnToLocationId}` : 'Default location'}
            </span>
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" onClick={onBack}>Cancel</Button>
              <Button leadingIcon={<PackageCheck size={16} />} onClick={submit} disabled={!canSave}>
                {saving ? 'Saving…' : condition ? 'Record inspection' : 'Mark received'}
              </Button>
            </div>
          </div>

          {/* Existing inspection, if this return was already inspected. */}
          {d.inspections.length > 0 && (
            <div className="rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Previous inspection</p>
              {d.inspections.map((ins) => (
                <div key={ins.id} className="flex items-center gap-2 text-xs text-ink-3">
                  <Chip accent="teal" dot={false}>{ins.status}</Chip>
                  {ins.condition && <span>{ins.condition}</span>}
                  {ins.receivedAt && <span>· {shortDate(ins.receivedAt)}</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface CapturedMedia {
  id: string;
  mediaType: 'photo' | 'video';
  storageRef: string;
  contentType: string | null;
  sizeBytes: number | null;
  name: string;
}

/** <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in LOCAL time. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
