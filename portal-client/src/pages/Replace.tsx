import { useMemo, useState } from 'react';
import { Info, Plus, Repeat, ShoppingCart, Trash2, Undo2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AnimatedIcon } from '@/components/ui/AnimatedIcon';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Display';
import { Drawer } from '@/components/ui/Drawer';
import { Modal } from '@/components/ui/Modal';
import { GlassPanel, SectionTitle } from '@/components/ui/Glass';
import { QueryState } from '@/components/ui/QueryState';
import { TextInput, TextArea } from '@/components/ui/Inputs';
import { useToast } from '@/components/ui/Toast';
import { portalApi } from '@/lib/api';
import type { Accent } from '@/lib/accents';
import { useAuth } from '@/auth';
import { useMe, useReplacement, useReplacements } from '@/lib/hooks';
import { shortDate } from '@/lib/status';

/**
 * Replace (CP-061).
 *
 * The portal is a shadow renderer over canonical PS-502 replacement rows: this
 * page lists backend-derived replacement truth and decides none of it. The
 * create action FORWARDS to the canonical PrepShip command — while PS-502 is
 * feature-flagged off upstream, the honest upstream refusal is surfaced as-is.
 */

// Presentation only — the backend owns the status vocabulary; unknown statuses
// render as themselves so a new canonical state is never hidden.
const STATUS_META: Record<string, { label: string; accent: Accent }> = {
  requested: { label: 'Requested', accent: 'amber' },
  review: { label: 'In review', accent: 'amber' },
  approved: { label: 'Approved', accent: 'sky' },
  label_created: { label: 'Label created', accent: 'sky' },
  label_failed: { label: 'Label needs attention', accent: 'rose' },
  shipped: { label: 'Shipped', accent: 'teal' },
  completed: { label: 'Completed', accent: 'emerald' },
  rejected: { label: 'Rejected', accent: 'rose' },
  cancelled: { label: 'Cancelled', accent: 'violet' },
};

function statusMeta(status: string): { label: string; accent: Accent } {
  return STATUS_META[status] ?? { label: status, accent: 'violet' };
}

export default function Replace() {
  const q = useReplacements();
  const me = useMe();
  const [openId, setOpenId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const rows = useMemo(() => q.data?.data ?? [], [q.data]);
  const canRequest = me.data?.canRequestReplacements ?? false;

  return (
    <div className="space-y-4">
      <GlassPanel className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle title="Replace" subtitle="Re-ship an item to your customer" />
          {canRequest && (
            <Button leadingIcon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
              Request replacement
            </Button>
          )}
        </div>
      </GlassPanel>

      <QueryState isLoading={q.isLoading} isError={q.isError} onRetry={() => q.refetch()}>
        {rows.length === 0 ? (
          <GlassPanel className="p-6 sm:p-8">
            <div className="mx-auto flex max-w-md flex-col items-center text-center">
              <AnimatedIcon icon={Repeat} accent="emerald" tile />
              <h3 className="mt-4 font-display text-lg font-semibold text-ink">No replacements yet</h3>
              <p className="mt-2 text-sm text-ink-3">
                When a replacement is arranged for one of your orders it will appear here with
                its status and items. If a customer received a damaged or incorrect item, you can
                also log it as a return.
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <Link to="/returns"><Button variant="secondary" leadingIcon={<Undo2 size={16} />}>Open Returns</Button></Link>
                <Link to="/orders"><Button variant="secondary" leadingIcon={<ShoppingCart size={16} />}>View orders</Button></Link>
              </div>
              <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-3">
                <Info size={13} /> Contact your PrepShip account manager to arrange a replacement today.
              </p>
            </div>
          </GlassPanel>
        ) : (
          <GlassPanel className="p-4">
            <div className="space-y-1.5">
              {rows.map((row) => {
                const meta = statusMeta(row.status);
                return (
                  <button
                    key={row.id}
                    onClick={() => setOpenId(row.id)}
                    className="focus-ring flex w-full items-center gap-3 rounded-glass-sm px-2 py-2 text-left transition-colors hover:bg-brand-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-brand-700">{row.reference}</p>
                      <p className="truncate text-xs text-ink-3">
                        {row.orderNumber ?? '—'} · {row.clientName ?? '—'} · {shortDate(row.requestedAt)}
                      </p>
                    </div>
                    <span className="shrink-0 tnum text-xs text-ink-3">
                      {row.itemCount} item{row.itemCount === 1 ? '' : 's'}
                    </span>
                    <Chip accent={meta.accent} dot={false}>{meta.label}</Chip>
                  </button>
                );
              })}
            </div>
          </GlassPanel>
        )}
      </QueryState>

      <ReplacementDrawer id={openId} onClose={() => setOpenId(null)} />
      {canRequest && (
        <ReplacementCreateModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            void q.refetch();
          }}
        />
      )}
    </div>
  );
}

function ReplacementDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const q = useReplacement(id);
  const detail = q.data?.data;
  const meta = detail ? statusMeta(detail.status) : null;
  return (
    <Drawer open={id != null} onClose={onClose} title={detail?.reference ?? 'Replacement'}>
      <QueryState isLoading={q.isLoading} isError={q.isError} onRetry={() => q.refetch()}>
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              {meta && <Chip accent={meta.accent} dot={false}>{meta.label}</Chip>}
              <span className="text-xs text-ink-3">Requested {shortDate(detail.requestedAt)}</span>
            </div>
            <div className="rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink-3">Order</p>
              <p className="mt-1 text-sm font-semibold text-ink">{detail.orderNumber ?? '—'}</p>
              <p className="text-xs text-ink-3">{detail.clientName ?? '—'}</p>
            </div>
            <div className="rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink-3">Reason</p>
              <p className="mt-1 text-sm text-ink-2">{detail.reason}</p>
            </div>
            <div className="rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-ink-3">
                Items ({detail.items.length})
              </p>
              <div className="space-y-1">
                {detail.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-ink-2">
                      <span className="font-mono text-xs">{item.sku}</span>
                      {item.name ? <span className="text-ink-3"> · {item.name}</span> : null}
                    </span>
                    <span className="tnum shrink-0 text-xs text-ink-3">×{item.quantity}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </QueryState>
    </Drawer>
  );
}

type DraftItem = { sku: string; quantity: string };

function ReplacementCreateModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { accessToken } = useAuth();
  const toast = useToast();
  const [orderId, setOrderId] = useState('');
  const [reason, setReason] = useState('');
  const [items, setItems] = useState<DraftItem[]>([{ sku: '', quantity: '1' }]);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!accessToken || saving) return;
    const orderIdNum = Number(orderId);
    if (!Number.isInteger(orderIdNum) || orderIdNum <= 0) {
      toast.error('Order required', 'Enter the internal order id for the replacement.');
      return;
    }
    if (!reason.trim()) {
      toast.error('Reason required', 'Say why this replacement is needed.');
      return;
    }
    const cleanItems = items
      .map((item) => ({ sku: item.sku.trim(), quantity: Number(item.quantity) }))
      .filter((item) => item.sku && Number.isInteger(item.quantity) && item.quantity > 0);
    if (cleanItems.length === 0) {
      toast.error('Items required', 'Add at least one SKU with a positive quantity.');
      return;
    }
    setSaving(true);
    try {
      await portalApi.createReplacement(accessToken, {
        orderId: orderIdNum,
        reason: reason.trim(),
        items: cleanItems,
      });
      toast.success('Replacement requested', 'The request was forwarded to PrepShip.');
      onCreated();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Please try again.';
      // PS-502's canonical router is feature-flagged off / internal-only today;
      // its refusal passes through verbatim. Say what that means instead of
      // pretending the request landed.
      toast.error(
        'Could not request replacement',
        /403|not permitted|forbidden|disabled/i.test(message)
          ? 'Replacements are not enabled on PrepShip yet. Contact your account manager.'
          : message,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Request replacement">
      <div className="space-y-3">
        <TextInput
          label="Order id"
          required
          value={orderId}
          onChange={(e) => setOrderId(e.target.value)}
          placeholder="e.g. 1321"
          inputMode="numeric"
        />
        <TextArea
          label="Reason"
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is a replacement needed?"
          rows={3}
        />
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">Items</p>
          {items.map((item, index) => (
            <div key={index} className="flex items-end gap-2">
              <TextInput
                label={index === 0 ? 'SKU' : undefined}
                value={item.sku}
                onChange={(e) =>
                  setItems((prev) => prev.map((p, i) => (i === index ? { ...p, sku: e.target.value } : p)))
                }
                containerClassName="flex-1"
              />
              <TextInput
                label={index === 0 ? 'Qty' : undefined}
                value={item.quantity}
                onChange={(e) =>
                  setItems((prev) => prev.map((p, i) => (i === index ? { ...p, quantity: e.target.value } : p)))
                }
                inputMode="numeric"
                containerClassName="w-20"
              />
              <Button
                variant="secondary"
                aria-label="Remove item"
                onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                disabled={items.length === 1}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            leadingIcon={<Plus size={14} />}
            onClick={() => setItems((prev) => [...prev, { sku: '', quantity: '1' }])}
          >
            Add item
          </Button>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? 'Requesting…' : 'Request replacement'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
