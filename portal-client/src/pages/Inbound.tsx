import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PackageCheck, PackageOpen, Plus, Building2, Upload } from 'lucide-react';
import { GlassPanel } from '@/components/ui/Glass';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { QueryState } from '@/components/ui/QueryState';
import { useInbound, useClients, useMe, useCanCustomizeTables } from '@/lib/hooks';
import { usePortalFilters } from '@/lib/portalContext';
import { type PortalInbound } from '@/lib/api';
import { InboundCreateModal } from '@/components/inbound/InboundCreateModal';
import { InboundImportModal } from '@/components/inbound/InboundImportModal';
import { InboundDetailDrawer } from '@/components/inbound/InboundDetailDrawer';
import { ReceiveInventoryModal } from '@/components/inbound/ReceiveInventoryModal';
import { useInboundReceipts } from '@/components/inbound/useInboundReceipts';
import { INBOUND_COLUMNS, INBOUND_RECEIPT_COLUMNS } from '@/components/inbound/columns';
import { Pagination } from '@/components/ui/Pagination';

export default function Inbound() {
  const { clientId: globalClientId } = usePortalFilters();
  const clients = useClients().data?.data ?? [];
  const me = useMe().data;
  const isAdmin = me?.isAdmin ?? false;
  const canReceiveInventory = me?.canReceiveInventory ?? false;
  const canCustomizeTables = useCanCustomizeTables();

  const [clientFilter, setClientFilter] = useState<number | undefined>(undefined);
  const [selected, setSelected] = useState<PortalInbound | null>(null);
  const [receiptPage, setReceiptPage] = useState(1);
  const [receiptPageSize, setReceiptPageSize] = useState(50);
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);

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
  const receiptQuery = useInboundReceipts(effectiveClientId, receiptPage, receiptPageSize);
  const rows = query.data?.data ?? [];
  const receiptRows = receiptQuery.data?.data ?? [];
  const receiptPagination = receiptQuery.data?.pagination;
  const showClientFilter = clients.length > 1;

  useEffect(() => setReceiptPage(1), [effectiveClientId]);

  return (
    <div className="space-y-4">
      <GlassPanel className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-glass-sm bg-brand-50 text-brand-600"><PackageOpen size={18} /></span>
          <div>
            <p className="font-display text-base font-bold text-ink">Inbound</p>
            <p className="text-xs text-ink-3">Expected shipments and PrepShip receiving history</p>
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
          {canReceiveInventory && (
            <Button leadingIcon={<PackageCheck size={16} />} onClick={() => setReceiveOpen(true)}>Receive inventory</Button>
          )}
          {isAdmin && <Button variant="secondary" leadingIcon={<Upload size={16} />} onClick={() => setImportOpen(true)}>Import</Button>}
          {isAdmin && <Button leadingIcon={<Plus size={16} />} onClick={() => setModalOpen(true)}>New inbound</Button>}
        </div>
      </GlassPanel>

      <GlassPanel className="p-2 sm:p-3">
        <div className="flex items-center gap-2 px-3 py-3">
          <PackageCheck size={17} className="text-emerald-600" />
          <div>
            <p className="text-sm font-semibold text-ink">Received inventory</p>
            <p className="text-xs text-ink-3">Canonical receipts recorded in PrepShip</p>
          </div>
        </div>
        <QueryState
          isLoading={receiptQuery.isLoading}
          isError={receiptQuery.isError}
          error={receiptQuery.error}
          isEmpty={receiptRows.length === 0}
          onRetry={() => receiptQuery.refetch()}
          emptyTitle="No received inventory"
          emptyMessage="No PrepShip receipts have been recorded."
        >
          <DataTable
            tableId="inbound-receipts"
            columns={INBOUND_RECEIPT_COLUMNS}
            rows={receiptRows}
            rowKey={(row) => String(row.id)}
            allowColumnCustomization={canCustomizeTables}
          />
          {receiptPagination && (
            <Pagination
              page={receiptPagination.page}
              totalPages={receiptPagination.totalPages}
              total={receiptPagination.total}
              pageSize={receiptPagination.pageSize}
              onPage={setReceiptPage}
              onPageSize={(size) => { setReceiptPageSize(size); setReceiptPage(1); }}
            />
          )}
        </QueryState>
      </GlassPanel>

      <GlassPanel className="p-2 sm:p-3">
        <div className="flex items-center gap-2 px-3 py-3">
          <PackageOpen size={17} className="text-brand-600" />
          <div>
            <p className="text-sm font-semibold text-ink">Expected shipments</p>
            <p className="text-xs text-ink-3">Purchase orders and ASNs arriving at the warehouse</p>
          </div>
        </div>
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
            columns={INBOUND_COLUMNS}
            rows={rows}
            rowKey={(row) => String(row.id)}
            onRowClick={setSelected}
            rowActionLabel={(row) => `View inbound ${row.reference ?? `#${row.id}`}`}
            allowColumnCustomization={canCustomizeTables}
          />
        </QueryState>
      </GlassPanel>

      <InboundDetailDrawer selected={selected} onClose={() => setSelected(null)} canReceiveInventory={canReceiveInventory} />
      <InboundCreateModal open={modalOpen} onClose={() => setModalOpen(false)} clients={clients} />
      <InboundImportModal open={importOpen} onClose={() => setImportOpen(false)} clients={clients} />
      <ReceiveInventoryModal open={receiveOpen} onClose={() => setReceiveOpen(false)} clients={clients} />
    </div>
  );
}
