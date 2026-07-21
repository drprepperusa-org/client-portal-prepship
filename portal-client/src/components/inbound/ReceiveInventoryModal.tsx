import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PackageCheck, Plus, Search, Trash2 } from 'lucide-react';
import { useAuth } from '@/auth';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useInventory } from '@/lib/hooks';
import { portalApi, type PortalClientRow, type PortalInventory } from '@/lib/api';
import { useDebounced } from '@/lib/useDebounced';
import { field, Labeled } from './shared';

type ReceiveLine = {
  key: string;
  inventoryId: number | null;
  label: string;
  qty: string;
};

function newLine(): ReceiveLine {
  return { key: crypto.randomUUID(), inventoryId: null, label: '', qty: '' };
}

function localDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function inventoryLabel(item: PortalInventory): string {
  return item.name ? `${item.sku ?? 'No SKU'} — ${item.name}` : (item.sku ?? `Inventory #${item.id}`);
}

function ReceiveLineEditor({
  line,
  clientId,
  selectedIds,
  canRemove,
  disabled,
  onChange,
  onRemove,
}: {
  line: ReceiveLine;
  clientId: number;
  selectedIds: Set<number>;
  canRemove: boolean;
  disabled: boolean;
  onChange: (next: ReceiveLine) => void;
  onRemove: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const search = useDebounced(line.label, 250);
  const query = useInventory({ clientId, search, page: 1, pageSize: 50 });
  const options = (query.data?.data ?? []).filter(
    (item) => item.id === line.inventoryId || !selectedIds.has(item.id),
  );
  const showOptions = focused && line.inventoryId == null;

  function selectItem(item: PortalInventory) {
    onChange({ ...line, inventoryId: item.id, label: inventoryLabel(item) });
    setFocused(false);
  }

  return (
    <div className="grid gap-2 rounded-glass-sm bg-white/70 p-3 ring-1 ring-slate-200/70 sm:grid-cols-[1fr_96px_44px]">
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-3.5 text-ink-3" />
        <input
          value={line.label}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => onChange({ ...line, inventoryId: null, label: event.target.value })}
          placeholder="Search SKU or product name"
          aria-label="SKU or product"
          aria-expanded={showOptions}
          disabled={disabled}
          className={`${field} pl-9`}
        />
        {showOptions && (
          <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-glass-sm bg-white p-1 shadow-glass-lg ring-1 ring-slate-200">
            {query.isLoading && <p className="px-3 py-2 text-xs text-ink-3">Loading SKUs…</p>}
            {!query.isLoading && options.length === 0 && (
              <p className="px-3 py-2 text-xs text-ink-3">No matching SKU for this client.</p>
            )}
            {options.map((item) => (
              <button
                key={item.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectItem(item)}
                className="focus-ring block w-full rounded-lg px-3 py-2 text-left hover:bg-brand-50"
              >
                <span className="block text-sm font-semibold text-ink">{item.sku ?? `Inventory #${item.id}`}</span>
                <span className="block truncate text-xs text-ink-3">{item.name ?? 'Unnamed item'} · Stock {item.inventoryQuantity}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <input
        type="number"
        min={1}
        max={1_000_000}
        step={1}
        value={line.qty}
        onChange={(event) => onChange({ ...line, qty: event.target.value })}
        placeholder="Qty"
        aria-label="Quantity received"
        disabled={disabled}
        className={field}
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove || disabled}
        aria-label="Remove receive row"
        className="focus-ring grid h-11 w-11 place-items-center rounded-lg text-ink-3 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-35"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}

export function ReceiveInventoryModal({
  open,
  onClose,
  clients,
}: {
  open: boolean;
  onClose: () => void;
  clients: PortalClientRow[];
}) {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [clientId, setClientId] = useState<number | undefined>();
  const [reference, setReference] = useState('');
  const [receivedDate, setReceivedDate] = useState(localDate);
  const [lines, setLines] = useState<ReceiveLine[]>(() => [newLine()]);
  const [saving, setSaving] = useState(false);
  const submissionIdentity = useRef<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setClientId(clients.length === 1 ? clients[0]?.id : undefined);
    setReference('');
    setReceivedDate(localDate());
    setLines([newLine()]);
    submissionIdentity.current = null;
  }, [open, clients]);

  const selectedIds = useMemo(
    () => new Set(lines.flatMap((line) => line.inventoryId == null ? [] : [line.inventoryId])),
    [lines],
  );
  const totalUnits = lines.reduce((sum, line) => sum + (Number(line.qty) || 0), 0);
  const valid = Boolean(
    clientId &&
    receivedDate &&
    lines.length > 0 &&
    lines.every((line) => line.inventoryId && Number.isInteger(Number(line.qty)) && Number(line.qty) > 0),
  );

  function updateLine(key: string, next: ReceiveLine) {
    setLines((current) => current.map((line) => line.key === key ? next : line));
  }

  function changeClient(value: number | undefined) {
    setClientId(value);
    setLines([newLine()]);
  }

  async function submit() {
    if (!accessToken || !clientId || !valid || saving) return;
    const items = lines.map((line) => ({ inventoryId: line.inventoryId as number, qty: Number(line.qty) }));
    const fingerprint = JSON.stringify({ clientId, reference: reference.trim(), receivedDate, items });
    let identity = submissionIdentity.current;
    if (identity?.fingerprint !== fingerprint) {
      identity = { fingerprint, key: crypto.randomUUID() };
      submissionIdentity.current = identity;
    }
    setSaving(true);
    try {
      const result = await portalApi.receiveInventory(accessToken, {
        clientId,
        idempotencyKey: identity.key,
        reference: reference.trim() || undefined,
        receivedAt: new Date(`${receivedDate}T00:00:00`).toISOString(),
        items,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['inventory'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory-history'] }),
        queryClient.invalidateQueries({ queryKey: ['inbound-receipts'] }),
      ]);
      toast.success(
        'Inventory received',
        `${result.data.totalUnits} units received across ${result.data.received} SKU${result.data.received === 1 ? '' : 's'}.`,
      );
      onClose();
    } catch (error) {
      toast.error('Receive failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={() => { if (!saving) onClose(); }} title="Receive inventory" maxWidth={760}>
      <div className="space-y-4">
        <p className="text-sm text-ink-3">Received units post directly to PrepShip stock levels and inventory history.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Labeled label="Client">
            <select
              value={clientId ?? ''}
              onChange={(event) => changeClient(event.target.value ? Number(event.target.value) : undefined)}
              disabled={saving}
              className={field}
            >
              <option value="">Select client…</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.name ?? `Client ${client.id}`}</option>)}
            </select>
          </Labeled>
          <Labeled label="Reference">
            <input value={reference} onChange={(event) => setReference(event.target.value)} disabled={saving} className={field} placeholder="PO, shipment ref, or note" />
          </Labeled>
          <Labeled label="Received on">
            <input type="date" value={receivedDate} onChange={(event) => setReceivedDate(event.target.value)} disabled={saving} className={field} />
          </Labeled>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">SKU or product · Quantity</p>
            <span className="text-xs font-medium text-ink-3">{totalUnits} total units</span>
          </div>
          {!clientId && <p className="rounded-glass-sm bg-amber-50 px-3 py-3 text-sm text-amber-800 ring-1 ring-amber-200">Select a client to load its SKUs.</p>}
          {clientId && lines.map((line) => (
            <ReceiveLineEditor
              key={line.key}
              line={line}
              clientId={clientId}
              selectedIds={selectedIds}
              canRemove={lines.length > 1}
              disabled={saving}
              onChange={(next) => updateLine(line.key, next)}
              onRemove={() => setLines((current) => current.filter((item) => item.key !== line.key))}
            />
          ))}
          {clientId && (
            <Button variant="secondary" size="sm" leadingIcon={<Plus size={15} />} onClick={() => setLines((current) => [...current, newLine()])} disabled={saving || lines.length >= 200}>
              Add SKU
            </Button>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-white/60 pt-4 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button leadingIcon={<PackageCheck size={16} />} onClick={submit} disabled={!valid} loading={saving}>
            Receive All
          </Button>
        </div>
      </div>
    </Modal>
  );
}
