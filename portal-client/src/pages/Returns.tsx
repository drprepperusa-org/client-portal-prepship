import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building2, Filter, Download, MapPin, Copy, ExternalLink, PackageCheck } from 'lucide-react';
import { GlassPanel } from '@/components/ui/Glass';
import { SearchInput } from '@/components/ui/SearchInput';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Chip } from '@/components/ui/Display';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { QueryState } from '@/components/ui/QueryState';
import { Pagination } from '@/components/ui/Pagination';
import { useToast } from '@/components/ui/Toast';
import { useReturns, useReturnDetail, useClients, useMe } from '@/lib/hooks';
import { usePortalFilters } from '@/lib/portalContext';
import { useDebounced } from '@/lib/useDebounced';
import { money, shortDate } from '@/lib/status';
import { API_BASE, type PortalReturnRow } from '@/lib/api';
import { type Accent } from '@/lib/accents';
import { ReturnCreateModal } from '@/components/returns/ReturnCreateModal';
import { ReturnReceivingModal } from '@/components/returns/ReturnReceivingModal';

const CLIENT_ACCENTS: Accent[] = ['emerald', 'rose', 'indigo', 'amber', 'teal', 'violet', 'sky'];
function clientAccent(name: string | null): Accent {
  const s = name ?? '';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i)) % CLIENT_ACCENTS.length;
  return CLIENT_ACCENTS[h];
}

// Lifecycle status → chip meta. Backend-owned status enum (CP-026); the page
// only maps it to a label + accent. No carrier/service ever appears here.
const STATUS_META: Record<string, { label: string; accent: Accent }> = {
  requested: { label: 'Requested', accent: 'amber' },
  label_created: { label: 'Label created', accent: 'sky' },
  in_transit: { label: 'In transit', accent: 'indigo' },
  received: { label: 'Received', accent: 'teal' },
  inspected: { label: 'Inspected', accent: 'violet' },
  closed: { label: 'Closed', accent: 'emerald' },
  cancelled: { label: 'Cancelled', accent: 'rose' },
};
function statusMeta(status: string) {
  return STATUS_META[status] ?? { label: status, accent: 'amber' as Accent };
}

const STATUS_OPTIONS = [
  'requested',
  'label_created',
  'in_transit',
  'received',
  'inspected',
  'closed',
  'cancelled',
] as const;

const DELIVERY_LABEL: Record<string, string> = {
  manual_pdf: 'PDF download',
  shopify_native: 'Store delivery',
};

// CP-034: return tracking links open the REAL carrier site (USPS/UPS/FedEx) via
// the backend-built `r.trackingUrl` / `d.trackingUrl` — never a 17track link.
// When trackingUrl is null (unknown carrier), the number renders as copyable
// text with no external link. Carrier identity itself stays redacted.

export default function Returns() {
  const { clientId: globalClientId } = usePortalFilters();
  const clients = useClients().data?.data ?? [];
  const me = useMe().data;
  // Operator = 3PL/admin. The receiving desk is theirs; a client user never sees
  // the entry point. The BACKEND is the true guard (it 403s a client on writes) —
  // this is the client-side signal that matches the operator concept as closely
  // as the JWT allows (admin email OR global scope).
  const isOperator = Boolean(me?.isAdmin || me?.isGlobal);
  const [params] = useSearchParams();

  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [clientFilter, setClientFilter] = useState<number | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOrderId, setCreateOrderId] = useState<number | null>(null);
  const [receivingOpen, setReceivingOpen] = useState(false);

  const debouncedQ = useDebounced(q, 350);
  const effectiveClientId = clientFilter ?? globalClientId;

  // Deep-link: /returns?order=123 filters to one order; ?new=<orderId> opens the
  // create-return modal (used by the "Start return" entry points).
  const orderParam = params.get('order');
  const orderFilter = orderParam ? Number(orderParam) : undefined;
  const newParam = params.get('new');
  useEffect(() => {
    if (newParam) setCreateOrderId(Number(newParam));
  }, [newParam]);

  useEffect(() => setPage(1), [debouncedQ, effectiveClientId, statusFilter, orderFilter]);

  const query = useReturns({
    search: debouncedQ,
    page,
    status: statusFilter || undefined,
    clientId: effectiveClientId,
    orderId: orderFilter,
  });
  const rows = query.data?.data ?? [];
  const pg = query.data?.pagination;

  const showClientFilter = clients.length > 1;

  const columns: Column<PortalReturnRow>[] = useMemo(
    () => [
      {
        key: 'order',
        header: 'Order',
        defaultWidth: 150,
        render: (r) => <span className="font-semibold text-ink">{r.orderNumber ?? (r.orderId ? `#${r.orderId}` : '—')}</span>,
        sortAccessor: (r) => r.orderNumber ?? '',
      },
      {
        key: 'client',
        header: 'Client',
        defaultWidth: 150,
        render: (r) => (r.clientName ? <Chip accent={clientAccent(r.clientName)} dot={false}>{r.clientName}</Chip> : <span className="text-ink-3">—</span>),
        sortAccessor: (r) => r.clientName ?? '',
      },
      {
        key: 'status',
        header: 'Status',
        defaultWidth: 130,
        render: (r) => { const m = statusMeta(r.status); return <Chip accent={m.accent}>{m.label}</Chip>; },
        sortAccessor: (r) => r.status,
      },
      {
        key: 'delivery',
        header: 'Delivery',
        defaultWidth: 130,
        render: (r) => <span className="text-ink-2">{r.deliveryMethod ? DELIVERY_LABEL[r.deliveryMethod] ?? r.deliveryMethod : '—'}</span>,
        sortAccessor: (r) => r.deliveryMethod ?? '',
      },
      {
        key: 'tracking',
        header: 'Tracking #',
        defaultWidth: 180,
        render: (r) => {
          const url = r.trackingUrl;
          if (!r.trackingNumber) return <span className="text-ink-3">—</span>;
          return url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="focus-ring inline-flex items-center gap-1 font-mono text-xs text-brand-700 hover:text-brand-600 hover:underline"
              title="Track return"
            >
              <span className="truncate">{r.trackingNumber}</span>
              <ExternalLink size={12} className="shrink-0" />
            </a>
          ) : (
            <span className="font-mono text-xs text-ink-2">{r.trackingNumber}</span>
          );
        },
        sortAccessor: (r) => r.trackingNumber ?? '',
      },
      {
        key: 'price',
        header: 'Price',
        defaultWidth: 110,
        className: 'text-right',
        render: (r) => <span className="font-semibold text-ink tnum">{r.price != null ? money(r.price) : '—'}</span>,
        sortAccessor: (r) => r.price ?? -1,
      },
      {
        key: 'created',
        header: 'Created',
        defaultWidth: 130,
        render: (r) => <span className="text-ink-3 tnum">{shortDate(r.createdAt)}</span>,
        sortAccessor: (r) => r.createdAt ?? '',
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <GlassPanel className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput value={q} onChange={setQ} placeholder="Search order #, tracking, reason…" ariaLabel="Search returns" />

        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          {/* Operator-only receiving desk entry. Client users never see it; the
              backend independently 403s a client on the receiving/inspection
              writes, so this is a convenience gate, not the security boundary. */}
          {isOperator && (
            <Button leadingIcon={<PackageCheck size={16} />} onClick={() => setReceivingOpen(true)}>
              Receive returns
            </Button>
          )}
          <label className="relative flex items-center">
            <Filter size={15} className="pointer-events-none absolute left-3 z-10 text-ink-3" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by status"
              className="focus-ring h-11 cursor-pointer appearance-none rounded-glass-sm border border-white/80 bg-white/60 pl-9 pr-9 text-sm font-medium text-ink ring-1 ring-slate-200/70 focus:bg-white/90"
            >
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{statusMeta(s).label}</option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 text-ink-3">▾</span>
          </label>

          {showClientFilter && (
            <label className="relative flex items-center">
              <Building2 size={15} className="pointer-events-none absolute left-3 z-10 text-ink-3" />
              <select
                value={clientFilter ?? ''}
                onChange={(e) => setClientFilter(e.target.value ? Number(e.target.value) : undefined)}
                aria-label="Filter by client"
                className="focus-ring h-11 cursor-pointer appearance-none rounded-glass-sm border border-white/80 bg-white/60 pl-9 pr-9 text-sm font-medium text-ink ring-1 ring-slate-200/70 focus:bg-white/90"
              >
                <option value="">All clients</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name ?? `Client ${c.id}`}</option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 text-ink-3">▾</span>
            </label>
          )}
        </div>
      </GlassPanel>

      <GlassPanel className="p-2 sm:p-3">
        <QueryState
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          isEmpty={rows.length === 0}
          onRetry={() => query.refetch()}
          emptyTitle={statusFilter || debouncedQ ? 'No matching returns' : 'No returns yet'}
          emptyMessage="Start a return from an order or shipment, and it will appear here."
        >
          <DataTable tableId="returns" columns={columns} rows={rows} rowKey={(r) => String(r.id)} onRowClick={(r) => setSelectedId(r.id)} />
          {pg && <Pagination page={pg.page} totalPages={pg.totalPages} total={pg.total} pageSize={pg.pageSize} onPage={setPage} />}
        </QueryState>
      </GlassPanel>

      <ReturnDetailDrawer id={selectedId} onClose={() => setSelectedId(null)} />
      <ReturnCreateModal
        open={createOrderId != null}
        orderId={createOrderId}
        onClose={() => setCreateOrderId(null)}
        onCreated={(id) => setSelectedId(id)}
      />
      {/* Operator-only mobile receiving/inspection flow. */}
      {isOperator && <ReturnReceivingModal open={receivingOpen} onClose={() => setReceivingOpen(false)} />}
    </div>
  );
}

/** Return detail: items, tracking/status, delivery method + PDF download,
 *  inspection notes/media. Carrier/service identity is never shown. */
function ReturnDetailDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const toast = useToast();
  const q = useReturnDetail(id);
  const d = q.data?.data;

  // The return label PDF is served by the existing /labels/... route the return
  // shipment's labelUrl points at. Resolve it to an absolute URL for download.
  const pdfHref = d?.pdfUrl ? (d.pdfUrl.startsWith('http') ? d.pdfUrl : `${API_BASE}${d.pdfUrl}`) : null;

  return (
    <Drawer open={id != null} onClose={onClose} title={d ? `Return #${d.id}` : 'Return'}>
      {q.isLoading ? (
        <p className="text-sm text-ink-3">Loading…</p>
      ) : q.isError || !d ? (
        <p className="text-sm text-ink-3">Couldn’t load this return.</p>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <Chip accent={statusMeta(d.status).accent}>{statusMeta(d.status).label}</Chip>
            <span className="flex items-center gap-1 text-sm text-ink-3"><MapPin size={14} /> {d.clientName ?? '—'}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Order" value={d.orderNumber ?? (d.orderId ? `#${d.orderId}` : '—')} />
            <Field label="Started by" value={d.initiatedBy === 'three_pl' ? 'Warehouse' : 'Client'} />
            <Field label="Delivery" value={d.deliveryMethod ? DELIVERY_LABEL[d.deliveryMethod] ?? d.deliveryMethod : '—'} />
            <Field label="Delivery status" value={d.deliveryStatus ?? '—'} />
            <Field label="Created" value={shortDate(d.createdAt)} />
            {d.price != null && <Field label="Price" value={money(d.price)} />}
          </div>

          {/* Tracking */}
          <div className="flex items-center justify-between rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
            <div className="min-w-0">
              <p className="text-xs text-ink-3">Tracking number</p>
              <p className="truncate font-mono text-sm text-ink">{d.trackingNumber ?? '—'}</p>
              {d.trackingStatus && <p className="text-xs text-ink-3">{d.trackingStatus}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* CP-034: open the real carrier site when the carrier is known. */}
              {d.trackingUrl && (
                <a
                  href={d.trackingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="focus-ring inline-flex items-center gap-1 rounded-glass-sm bg-brand-50 px-2.5 py-1.5 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-100"
                  title="Track on carrier site"
                >
                  <ExternalLink size={13} /> Track
                </a>
              )}
              {d.trackingNumber && (
                <Button
                  variant="icon"
                  size="sm"
                  aria-label="Copy tracking number"
                  onClick={() => {
                    navigator.clipboard?.writeText(d.trackingNumber!);
                    toast.success('Copied', 'Tracking number copied to clipboard');
                  }}
                >
                  <Copy size={15} />
                </Button>
              )}
            </div>
          </div>

          {/* PDF download — shown for manual_pdf delivery / when Shopify delivery
              failed. Served by the existing label route; never a new mechanism. */}
          {pdfHref && (
            <a
              href={pdfHref}
              target="_blank"
              rel="noreferrer"
              className="focus-ring flex w-full items-center justify-center gap-2 rounded-glass-sm bg-gradient-to-br from-brand-400 to-brand-600 py-2.5 text-sm font-semibold text-white shadow-glass transition-opacity hover:opacity-95"
            >
              <Download size={15} /> Download return label
            </a>
          )}

          {d.reason && (
            <div className="rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
              <p className="text-xs font-medium text-ink-3">Reason</p>
              <p className="mt-1 text-sm text-ink-2">{d.reason}</p>
            </div>
          )}

          {/* Returned items */}
          <div className="rounded-glass-sm bg-white/60 p-4 ring-1 ring-slate-200/70">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-3">Returned items</p>
            <ul className="space-y-2">
              {d.items.length === 0 && <li className="text-sm text-ink-3">No items.</li>}
              {d.items.map((it) => (
                <li key={it.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink" title={it.name ?? ''}>{it.name ?? it.sku}</p>
                    {it.sku && <p className="truncate font-mono text-[11px] text-ink-3">{it.sku}</p>}
                  </div>
                  <span className="shrink-0 text-sm tnum text-ink-2">×{it.quantity}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Inspection notes + media from the 3PL receiving flow (CP-030). */}
          <div className="rounded-glass-sm bg-white/60 p-4 ring-1 ring-slate-200/70">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-3">Inspection</p>
            {d.inspections.length === 0 ? (
              <p className="text-sm text-ink-3">No inspection recorded yet.</p>
            ) : (
              <ul className="space-y-3">
                {d.inspections.map((ins) => (
                  <li key={ins.id} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Chip accent="teal" dot={false}>{ins.status}</Chip>
                      {ins.condition && <span className="text-xs text-ink-3">{ins.condition}</span>}
                      {ins.receivedAt && <span className="text-xs text-ink-3">· {shortDate(ins.receivedAt)}</span>}
                    </div>
                    {ins.comments && <p className="text-sm text-ink-2">{ins.comments}</p>}
                    {ins.media.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {ins.media.map((m) =>
                          m.url ? (
                            <a
                              key={m.id}
                              href={m.url}
                              target="_blank"
                              rel="noreferrer"
                              className="focus-ring inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs text-ink-2 hover:bg-slate-200"
                            >
                              {m.mediaType === 'video' ? 'Video' : 'Photo'}
                            </a>
                          ) : (
                            <span
                              key={m.id}
                              title="Media unavailable"
                              className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs text-ink-3 opacity-60"
                            >
                              {m.mediaType === 'video' ? 'Video' : 'Photo'} · unavailable
                            </span>
                          ),
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
      <p className="text-xs font-medium text-ink-3">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-ink" title={value}>{value}</p>
    </div>
  );
}
