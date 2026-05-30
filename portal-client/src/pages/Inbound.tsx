import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PackageOpen, Plus, Building2, Trash2, Truck, Upload, PackageCheck } from 'lucide-react';
import { GlassPanel } from '@/components/ui/Glass';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Chip } from '@/components/ui/Display';
import { Drawer } from '@/components/ui/Drawer';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { QueryState } from '@/components/ui/QueryState';
import { useToast } from '@/components/ui/Toast';
import { useInbound, useClients, useMe } from '@/lib/hooks';
import { usePortalFilters } from '@/lib/portalContext';
import { useAuth } from '@/auth';
import { portalApi, type PortalInbound, type NewInboundInput, type PortalClientRow } from '@/lib/api';
import { shortDate } from '@/lib/status';
import { type Accent } from '@/lib/accents';

const STATUSES = ['expected', 'in_transit', 'received', 'cancelled'] as const;
const STATUS_META: Record<string, { label: string; accent: Accent }> = {
  expected: { label: 'Expected', accent: 'amber' },
  in_transit: { label: 'In transit', accent: 'sky' },
  received: { label: 'Received', accent: 'emerald' },
  cancelled: { label: 'Cancelled', accent: 'rose' },
};
const CLIENT_ACCENTS: Accent[] = ['emerald', 'rose', 'indigo', 'amber', 'teal', 'violet', 'sky'];
function clientAccent(name: string | null): Accent {
  const s = name ?? '';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i)) % CLIENT_ACCENTS.length;
  return CLIENT_ACCENTS[h];
}

const field = 'focus-ring h-10 w-full rounded-glass-sm border border-white/80 bg-white/60 px-3 text-sm text-ink ring-1 ring-slate-200/70 placeholder:text-slate-400 focus:bg-white/90';

type DraftItem = { sku: string; name: string; expectedQty: string };
type Draft = {
  clientId?: number; reference: string; supplier: string; status: string;
  carrier: string; trackingNumber: string; expectedDate: string; notes: string; items: DraftItem[];
};
const emptyDraft = (): Draft => ({
  clientId: undefined, reference: '', supplier: '', status: 'expected',
  carrier: '', trackingNumber: '', expectedDate: '', notes: '', items: [{ sku: '', name: '', expectedQty: '' }],
});

/** CSV → grouped inbound shipments. Columns (any order, header row required):
 *  client, reference, supplier, status, expected_date, carrier, tracking, sku, name, qty */
function parseCsv(text: string, clients: PortalClientRow[]): { shipments: NewInboundInput[]; items: number } {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { shipments: [], items: 0 };
  const split = (l: string) => l.split(',').map((s) => s.trim());
  const header = split(lines[0]).map((h) => h.toLowerCase());
  const at = (cells: string[], name: string) => { const i = header.indexOf(name); return i >= 0 ? (cells[i] ?? '') : ''; };
  const byName = new Map(clients.map((c) => [(c.name ?? '').toLowerCase(), c.id]));
  const groups = new Map<string, NewInboundInput & { items: NonNullable<NewInboundInput['items']> }>();
  let items = 0;
  for (let i = 1; i < lines.length; i++) {
    const cells = split(lines[i]);
    const clientRaw = at(cells, 'client');
    const clientId = clientRaw ? (Number(clientRaw) || byName.get(clientRaw.toLowerCase())) : undefined;
    const reference = at(cells, 'reference');
    const key = `${clientId ?? ''}|${reference}`;
    if (!groups.has(key)) {
      groups.set(key, {
        clientId: clientId || undefined,
        reference: reference || undefined,
        supplier: at(cells, 'supplier') || undefined,
        status: at(cells, 'status') || undefined,
        carrier: at(cells, 'carrier') || undefined,
        trackingNumber: at(cells, 'tracking') || undefined,
        expectedDate: at(cells, 'expected_date') || undefined,
        items: [],
      });
    }
    const g = groups.get(key)!;
    const sku = at(cells, 'sku');
    const name = at(cells, 'name');
    if (sku || name) {
      g.items.push({ sku: sku || undefined, name: name || undefined, expectedQty: Number(at(cells, 'qty')) || 0 });
      items++;
    }
  }
  return { shipments: [...groups.values()], items };
}

export default function Inbound() {
  const toast = useToast();
  const qc = useQueryClient();
  const { accessToken } = useAuth();
  const { clientId: globalClientId } = usePortalFilters();
  const clients = useClients().data?.data ?? [];
  const isAdmin = useMe().data?.isAdmin ?? false;

  const [clientFilter, setClientFilter] = useState<number | undefined>(undefined);
  const [selected, setSelected] = useState<PortalInbound | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft());
  const [saving, setSaving] = useState(false);

  // Receive flow (within the detail drawer)
  const [receiving, setReceiving] = useState(false);
  const [recvQty, setRecvQty] = useState<Record<number, string>>({});
  const [addToInv, setAddToInv] = useState(true);
  const [recvSaving, setRecvSaving] = useState(false);

  // Import flow
  const [importOpen, setImportOpen] = useState(false);
  const [csv, setCsv] = useState('');
  const [importing, setImporting] = useState(false);
  const parsed = useMemo(() => parseCsv(csv, clients), [csv, clients]);

  const effectiveClientId = clientFilter ?? globalClientId;
  const query = useInbound(effectiveClientId);
  const rows = query.data?.data ?? [];
  const showClientFilter = clients.length > 1;

  const columns: Column<PortalInbound>[] = useMemo(
    () => [
      { key: 'ref', header: 'Reference', defaultWidth: 150, render: (r) => <span className="font-semibold text-ink">{r.reference ?? `#${r.id}`}</span>, sortAccessor: (r) => r.reference ?? `#${r.id}` },
      { key: 'supplier', header: 'Supplier', defaultWidth: 160, render: (r) => <span className="text-ink-2">{r.supplier ?? '—'}</span>, sortAccessor: (r) => r.supplier ?? '' },
      { key: 'client', header: 'Client', defaultWidth: 150, render: (r) => (r.clientName ? <Chip accent={clientAccent(r.clientName)} dot={false}>{r.clientName}</Chip> : <span className="text-ink-3">—</span>), sortAccessor: (r) => r.clientName ?? '' },
      {
        key: 'status', header: 'Status', defaultWidth: 120,
        render: (r) => { const m = STATUS_META[r.status] ?? { label: r.status, accent: 'amber' as Accent }; return <Chip accent={m.accent}>{m.label}</Chip>; },
        sortAccessor: (r) => r.status,
      },
      { key: 'units', header: 'Units', defaultWidth: 110, className: 'text-right', render: (r) => <span className="tnum text-ink-2">{r.receivedUnits}/{r.expectedUnits}</span>, sortAccessor: (r) => r.expectedUnits },
      { key: 'expected', header: 'Expected', defaultWidth: 130, render: (r) => <span className="text-ink-3 tnum">{shortDate(r.expectedDate)}</span>, sortAccessor: (r) => r.expectedDate ?? '' },
      { key: 'carrier', header: 'Carrier', defaultWidth: 130, render: (r) => <span className="text-ink-2">{r.carrier ?? '—'}</span>, sortAccessor: (r) => r.carrier ?? '' },
    ],
    [],
  );

  function openDetail(r: PortalInbound) {
    setSelected(r);
    setReceiving(false);
    setRecvQty(Object.fromEntries(r.items.map((it) => [it.id, String(it.expectedQty)])));
    setAddToInv(true);
  }

  async function submitCreate() {
    if (!accessToken || saving) return;
    setSaving(true);
    try {
      await portalApi.createInbound(accessToken, {
        clientId: draft.clientId ? Number(draft.clientId) : undefined,
        reference: draft.reference || undefined,
        supplier: draft.supplier || undefined,
        status: draft.status,
        carrier: draft.carrier || undefined,
        trackingNumber: draft.trackingNumber || undefined,
        expectedDate: draft.expectedDate || undefined,
        notes: draft.notes || undefined,
        items: draft.items.filter((it) => it.sku.trim() || it.name.trim()).map((it) => ({ sku: it.sku.trim() || undefined, name: it.name.trim() || undefined, expectedQty: Number(it.expectedQty) || 0 })),
      });
      await qc.invalidateQueries({ queryKey: ['inbound'] });
      toast.success('Inbound created', 'The receiving record was added.');
      setModalOpen(false);
      setDraft(emptyDraft());
    } catch (err) {
      toast.error('Could not create', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

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
      setSelected(null);
      setReceiving(false);
    } catch (err) {
      toast.error('Receive failed', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setRecvSaving(false);
    }
  }

  async function submitImport() {
    if (!accessToken || importing) return;
    if (!parsed.shipments.length) { toast.error('Nothing to import', 'Add a header row + data rows.'); return; }
    setImporting(true);
    try {
      const res = await portalApi.importInbound(accessToken, parsed.shipments);
      await qc.invalidateQueries({ queryKey: ['inbound'] });
      toast.success('Imported', `${res.data.created} shipment${res.data.created === 1 ? '' : 's'}, ${res.data.itemsCreated} items${res.data.skipped ? ` · ${res.data.skipped} skipped` : ''}.`);
      setImportOpen(false);
      setCsv('');
    } catch (err) {
      toast.error('Import failed', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setImporting(false);
    }
  }

  const setField = (k: keyof Draft, v: unknown) => setDraft((d) => ({ ...d, [k]: v }) as Draft);
  const setItem = (i: number, k: keyof DraftItem, v: string) => setDraft((d) => ({ ...d, items: d.items.map((it, j) => (j === i ? { ...it, [k]: v } : it)) }));

  return (
    <div className="space-y-4">
      <GlassPanel className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-glass-sm bg-brand-50 text-brand-600"><PackageOpen size={18} /></span>
          <div>
            <p className="font-display text-base font-bold text-ink">Inbound shipments</p>
            <p className="text-xs text-ink-3">Purchase orders arriving at the warehouse</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {showClientFilter && (
            <label className="relative flex items-center">
              <Building2 size={15} className="pointer-events-none absolute left-3 z-10 text-ink-3" />
              <select value={clientFilter ?? ''} onChange={(e) => setClientFilter(e.target.value ? Number(e.target.value) : undefined)} aria-label="Filter by client" className="focus-ring h-11 cursor-pointer appearance-none rounded-glass-sm border border-white/80 bg-white/60 pl-9 pr-8 text-sm font-medium text-ink ring-1 ring-slate-200/70 focus:bg-white/90">
                <option value="">All clients</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name ?? `Client ${c.id}`}</option>)}
              </select>
              <span className="pointer-events-none absolute right-3 text-ink-3">▾</span>
            </label>
          )}
          {isAdmin && <Button variant="secondary" leadingIcon={<Upload size={16} />} onClick={() => setImportOpen(true)}>Import</Button>}
          {isAdmin && <Button leadingIcon={<Plus size={16} />} onClick={() => setModalOpen(true)}>New inbound</Button>}
        </div>
      </GlassPanel>

      <GlassPanel className="p-2 sm:p-3">
        <QueryState
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          isEmpty={rows.length === 0}
          onRetry={() => query.refetch()}
          emptyTitle="No inbound shipments"
          emptyMessage={isAdmin ? 'Click “New inbound” to record an expected purchase order, or Import a CSV feed.' : 'Inbound purchase orders will appear here once your operator records them.'}
        >
          <DataTable tableId="inbound" columns={columns} rows={rows} rowKey={(r) => String(r.id)} onRowClick={openDetail} />
        </QueryState>
      </GlassPanel>

      {/* Detail + receive drawer */}
      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected ? (selected.reference ?? `Inbound #${selected.id}`) : ''}>
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
            {isAdmin && selected.status !== 'received' && selected.status !== 'cancelled' && (
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

      {/* Create modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New inbound shipment" maxWidth={640}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Labeled label="Client">
              <select value={draft.clientId ?? ''} onChange={(e) => setField('clientId', e.target.value ? Number(e.target.value) : undefined)} className={field}>
                <option value="">— Select client —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name ?? `Client ${c.id}`}</option>)}
              </select>
            </Labeled>
            <Labeled label="Status">
              <select value={draft.status} onChange={(e) => setField('status', e.target.value)} className={field}>
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
              </select>
            </Labeled>
            <Labeled label="Reference / PO #"><input className={field} value={draft.reference} onChange={(e) => setField('reference', e.target.value)} placeholder="PO-1024" /></Labeled>
            <Labeled label="Supplier"><input className={field} value={draft.supplier} onChange={(e) => setField('supplier', e.target.value)} placeholder="Acme Wholesale" /></Labeled>
            <Labeled label="Expected date"><input type="date" className={field} value={draft.expectedDate} onChange={(e) => setField('expectedDate', e.target.value)} /></Labeled>
            <Labeled label="Carrier"><input className={field} value={draft.carrier} onChange={(e) => setField('carrier', e.target.value)} placeholder="UPS Freight" /></Labeled>
            <Labeled label="Tracking #"><input className={field} value={draft.trackingNumber} onChange={(e) => setField('trackingNumber', e.target.value)} /></Labeled>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Items</p>
            <div className="space-y-2">
              {draft.items.map((it, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className={field} style={{ flex: 1 }} value={it.sku} onChange={(e) => setItem(i, 'sku', e.target.value)} placeholder="SKU" />
                  <input className={field} style={{ flex: 2 }} value={it.name} onChange={(e) => setItem(i, 'name', e.target.value)} placeholder="Item name" />
                  <input className={field} style={{ width: 80 }} type="number" min={0} value={it.expectedQty} onChange={(e) => setItem(i, 'expectedQty', e.target.value)} placeholder="Qty" />
                  <button onClick={() => setDraft((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }))} aria-label="Remove item" className="focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-rose-50 hover:text-rose-500"><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
            <button onClick={() => setDraft((d) => ({ ...d, items: [...d.items, { sku: '', name: '', expectedQty: '' }] }))} className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:text-brand-600"><Plus size={14} /> Add item</button>
          </div>
          <Labeled label="Notes"><textarea className={field + ' h-20 py-2'} value={draft.notes} onChange={(e) => setField('notes', e.target.value)} /></Labeled>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={submitCreate} disabled={saving}>{saving ? 'Saving…' : 'Create inbound'}</Button>
          </div>
        </div>
      </Modal>

      {/* Import modal */}
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import inbound (CSV feed)" maxWidth={640}>
        <div className="space-y-4">
          <p className="text-sm text-ink-3">
            Paste CSV with a header row. Columns (any order): <code className="rounded bg-slate-100 px-1 text-xs">client, reference, supplier, status, expected_date, carrier, tracking, sku, name, qty</code>. One row per item; rows sharing a reference are grouped into one shipment. <code className="rounded bg-slate-100 px-1 text-xs">client</code> matches a client name or id.
          </p>
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={'client,reference,supplier,expected_date,sku,name,qty\nHUGRAB,PO-1024,Acme,2026-06-05,HU-10,Leeds Line V2,120'}
            className={field + ' h-44 py-2 font-mono text-xs'}
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-ink-3">{parsed.shipments.length} shipment{parsed.shipments.length === 1 ? '' : 's'} · {parsed.items} item{parsed.items === 1 ? '' : 's'} parsed</p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setImportOpen(false)}>Cancel</Button>
              <Button onClick={submitImport} disabled={importing || !parsed.shipments.length} leadingIcon={<Upload size={15} />}>{importing ? 'Importing…' : 'Import'}</Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
      <p className="text-xs font-medium text-ink-3">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-ink" title={value}>{value}</p>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
      {children}
    </label>
  );
}
