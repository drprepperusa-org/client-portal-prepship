import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PackageOpen, Plus, Building2, Upload } from 'lucide-react';
import { GlassPanel } from '@/components/ui/Glass';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Chip } from '@/components/ui/Display';
import { Button } from '@/components/ui/Button';
import { QueryState } from '@/components/ui/QueryState';
import { useInbound, useClients, useMe, useCanCustomizeTables } from '@/lib/hooks';
import { usePortalFilters } from '@/lib/portalContext';
import { type PortalInbound } from '@/lib/api';
import { shortDate } from '@/lib/status';
import { type Accent } from '@/lib/accents';
import { STATUS_META } from '@/components/inbound/shared';
import { InboundCreateModal } from '@/components/inbound/InboundCreateModal';
import { InboundImportModal } from '@/components/inbound/InboundImportModal';
import { InboundDetailDrawer } from '@/components/inbound/InboundDetailDrawer';

const CLIENT_ACCENTS: Accent[] = ['emerald', 'rose', 'indigo', 'amber', 'teal', 'violet', 'sky'];
function clientAccent(name: string | null): Accent {
  const s = name ?? '';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i)) % CLIENT_ACCENTS.length;
  return CLIENT_ACCENTS[h];
}

function ClientCell({ name }: { name: string | null }) {
  if (!name) return <span className="text-ink-3">—</span>;
  return (
    <Chip accent={clientAccent(name)} dot={false}>
      {name}
    </Chip>
  );
}

export default function Inbound() {
  const { clientId: globalClientId } = usePortalFilters();
  const clients = useClients().data?.data ?? [];
  const isAdmin = useMe().data?.isAdmin ?? false;
  const canCustomizeTables = useCanCustomizeTables();

  const [clientFilter, setClientFilter] = useState<number | undefined>(undefined);
  const [selected, setSelected] = useState<PortalInbound | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // The mobile bottom-bar "+" lands here with ?new=1. Auto-open the create
  // modal for users who can create (admins; inbound is operator-recorded), then
  // strip the param so a refresh/back doesn't reopen it. Non-admins just see
  // their inbound list.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    if (isAdmin) setModalOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next, { replace: true });
  }, [searchParams, isAdmin, setSearchParams]);

  const effectiveClientId = clientFilter ?? globalClientId;
  const query = useInbound(effectiveClientId);
  const rows = query.data?.data ?? [];
  const showClientFilter = clients.length > 1;

  const columns: Column<PortalInbound>[] = useMemo(
    () => [
      { key: 'ref', header: 'Reference', defaultWidth: 150, render: (r) => <span className="font-semibold text-ink">{r.reference ?? `#${r.id}`}</span>, sortAccessor: (r) => r.reference ?? `#${r.id}` },
      { key: 'supplier', header: 'Supplier', defaultWidth: 160, render: (r) => <span className="text-ink-2">{r.supplier ?? '—'}</span>, sortAccessor: (r) => r.supplier ?? '' },
      {
        key: 'client',
        header: 'Client',
        defaultWidth: 150,
        render: (r) => <ClientCell name={r.clientName} />,
        sortAccessor: (r) => r.clientName ?? '',
      },
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
              <select
                value={clientFilter ?? ''}
                onChange={(event) => setClientFilter(event.target.value ? Number(event.target.value) : undefined)}
                aria-label="Filter by client"
                className="focus-ring h-11 cursor-pointer appearance-none rounded-glass-sm border border-white/80 bg-white/60 pl-9 pr-8 text-sm font-medium text-ink ring-1 ring-slate-200/70 focus:bg-white/90"
              >
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
          <DataTable
            tableId="inbound"
            columns={columns}
            rows={rows}
            rowKey={(row) => String(row.id)}
            onRowClick={setSelected}
            rowActionLabel={(row) => `View inbound ${row.reference ?? `#${row.id}`}`}
            allowColumnCustomization={canCustomizeTables}
          />
        </QueryState>
      </GlassPanel>

      <InboundDetailDrawer selected={selected} onClose={() => setSelected(null)} isAdmin={isAdmin} />
      <InboundCreateModal open={modalOpen} onClose={() => setModalOpen(false)} clients={clients} />
      <InboundImportModal open={importOpen} onClose={() => setImportOpen(false)} clients={clients} />
    </div>
  );
}
