import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Undo2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth';
import { useOrder, useReturnLocations } from '@/lib/hooks';
import { portalApi } from '@/lib/api';
import { field, Labeled } from '@/components/inbound/shared';

/**
 * CP-029 — Create-return modal. Opened for a specific order (from the Orders /
 * Shipments row/detail, or the Returns page). It lets the user select which
 * ordered items + partial quantities to return and a reason, then POSTs to the
 * backend.
 *
 * REDACTION / AUTHORITY BOUNDARY: this form renders the backend order DTO only.
 * It does NOT compute rates, choose a carrier/cheapest, price the return, or make
 * duplicate/override decisions — the backend owns all of that (CP-027/028). The
 * return-to location defaults on the backend (the configured default location).
 */
export function ReturnCreateModal({
  open,
  orderId,
  onClose,
  onCreated,
}: {
  open: boolean;
  orderId: number | null;
  onClose: () => void;
  onCreated?: (returnId: number) => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const { accessToken } = useAuth();
  const order = useOrder(open ? orderId : null);
  const items = order.data?.data.items ?? [];

  const [reason, setReason] = useState('');
  // Per-item requested return quantity, keyed by the item's index in the order.
  const [qtys, setQtys] = useState<Record<number, string>>({});
  // CP-029: selected return-to location. null → the backend applies its default.
  const [returnToLocationId, setReturnToLocationId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const locationsQuery = useReturnLocations(open);
  const locations = locationsQuery.data?.data ?? [];
  const defaultLocationName = locations.find((l) => l.isDefault)?.name ?? 'default location';

  // Reset the draft whenever a new order's modal opens.
  useEffect(() => {
    if (open) {
      setReason('');
      setQtys({});
      setReturnToLocationId(null);
    }
  }, [open, orderId]);

  const selectedCount = useMemo(
    () => Object.values(qtys).filter((v) => Number(v) > 0).length,
    [qtys],
  );

  function setQty(index: number, value: string) {
    setQtys((q) => ({ ...q, [index]: value }));
  }

  async function submit() {
    if (!accessToken || saving || orderId == null) return;
    // Build the return items from the ordered lines with a positive requested qty.
    // Quantities are validated (≤ ordered) on the backend — we do not price them.
    const chosen = items
      .map((it, i) => ({ it, quantity: Number(qtys[i]) || 0 }))
      .filter((row) => row.quantity > 0 && (row.it.sku || row.it.name))
      .map((row) => ({
        sku: (row.it.sku ?? row.it.name ?? '').trim(),
        name: row.it.name ?? undefined,
        quantity: row.quantity,
      }));
    if (!chosen.length) {
      toast.error('Nothing to return', 'Enter a return quantity for at least one item.');
      return;
    }
    setSaving(true);
    try {
      const res = await portalApi.createReturn(accessToken, {
        orderId,
        reason: reason.trim() || undefined,
        returnToLocationId: returnToLocationId ?? undefined,
        items: chosen,
      });
      const returnId = res.data.id;

      // CP-032: PrepShip creates the label IMMEDIATELY (PDF-only) — the modal no
      // longer stops at "request recorded". Rate-shopping + cheapest-eligible
      // selection + label creation are all backend-owned; we just trigger it and
      // surface the outcome. A label failure still leaves the return created and
      // retryable from its detail.
      let labelReady = false;
      try {
        const label = await portalApi.createReturnLabel(accessToken, returnId);
        labelReady = label.data.pdfAvailable;
      } catch (labelErr) {
        console.error('[returns] label creation failed:', labelErr);
      }

      await qc.invalidateQueries({ queryKey: ['returns'] });
      await qc.invalidateQueries({ queryKey: ['return', returnId] });
      if (labelReady) {
        toast.success('Return label ready', 'The PrepShip return label PDF is ready to download from the return detail.');
      } else {
        toast.warning(
          'Return created — label pending',
          'The return was created; its label is still being prepared. Open the return to download the PDF once ready.',
        );
      }
      onCreated?.(returnId);
      onClose();
    } catch (err) {
      toast.error('Could not create return', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Start a return" maxWidth={620}>
      {order.isLoading ? (
        <p className="text-sm text-ink-3">Loading order…</p>
      ) : order.isError || !order.data?.data ? (
        <p className="text-sm text-ink-3">Couldn’t load this order.</p>
      ) : (
        <div className="space-y-4">
          <div className="rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
            <p className="text-xs text-ink-3">Order</p>
            <p className="text-sm font-semibold text-ink">
              {order.data.data.orderNumber ?? `#${order.data.data.id}`}
              {order.data.data.clientName ? ` · ${order.data.data.clientName}` : ''}
            </p>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
              Items to return
            </p>
            <div className="space-y-2">
              {items.length === 0 && <p className="text-sm text-ink-3">This order has no line items.</p>}
              {items.map((it, i) => {
                const ordered = Number(it.quantity) || 0;
                return (
                  <div key={i} className="flex items-center gap-3 rounded-glass-sm bg-white/60 p-2.5 ring-1 ring-slate-200/70">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink" title={it.name ?? ''}>
                        {it.name ?? it.sku ?? 'Item'}
                      </p>
                      {it.sku && <p className="truncate font-mono text-[11px] text-ink-3">{it.sku}</p>}
                    </div>
                    <span className="shrink-0 text-xs text-ink-3 tnum">Ordered {ordered}</span>
                    <input
                      className={field}
                      style={{ width: 84 }}
                      type="number"
                      min={0}
                      max={ordered || undefined}
                      value={qtys[i] ?? ''}
                      onChange={(e) => setQty(i, e.target.value)}
                      placeholder="Qty"
                      aria-label={`Return quantity for ${it.name ?? it.sku ?? 'item'}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <Labeled label="Return to location">
            <select
              className={field}
              value={returnToLocationId ?? ''}
              onChange={(e) => setReturnToLocationId(e.target.value ? Number(e.target.value) : null)}
              aria-label="Return-to location"
            >
              <option value="">Default ({defaultLocationName})</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                  {loc.city && loc.state ? ` — ${loc.city}, ${loc.state}` : ''}
                </option>
              ))}
            </select>
          </Labeled>

          <Labeled label="Reason (optional)">
            <textarea
              className={field + ' h-20 py-2'}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this being returned?"
            />
          </Labeled>

          <p className="text-xs text-ink-3">
            Choose where the return ships, or leave it on the default location. The return label,
            tracking, and cost are handled for you after the return is created.
          </p>

          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-ink-3">{selectedCount} item{selectedCount === 1 ? '' : 's'} selected</span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button leadingIcon={<Undo2 size={16} />} onClick={submit} disabled={saving || selectedCount === 0}>
                {saving ? 'Creating label…' : 'Create return & label'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
