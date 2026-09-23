import { useAuth } from '@/auth';
import { ExportInboundReceiptsCsv } from '@/components/inbound/ExportInboundReceiptsCsv';
import { useTableSort } from '@/lib/useTableSort';
import { useDebounced } from '@/lib/useDebounced';
import { useFilteredPage } from '@/lib/useFilteredPage';
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
  const { userId } = useAuth();
  const clients = useClients().data?.data ?? [];
  const me = useMe().data;
  const isAdmin = me?.isAdmin ?? false;
  const canReceiveInventory = me?.canReceiveInventory ?? false;
  const canCustomizeTables = useCanCustomizeTables();

  const [clientFilter, setClientFilter] = useState<number | undefined>(undefined);
  const [selected, setSelected] = useState<PortalInbound | null>(null);
  const [confirmation, setConfirmation] = useState<{ scope: string; shipment: PortalInbound } | null>(null);
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
  const confirmationScope = JSON.stringify([userId, effectiveClientId]);
  const created = confirmation?.scope === confirmationScope ? confirmation.shipment : null;
  useEffect(() => { setConfirmation(null); }, [confirmationScope]);
  const [receiptPage, setReceiptPage] = useFilteredPage(JSON.stringify([effectiveClientId]));
  const receiptSort = useTableSort(setReceiptPage);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput.trim(), 300);
  const [status, setStatus] = useState('');
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useFilteredPage(JSON.stringify([userId, effectiveClientId, search, status, pageSize]));
  const query = useInbound(effectiveClientId, { search, status, page, pageSize });
  const pagination = query.data?.pagination;
  const filtered = Boolean(search || status);
  const receiptQuery = useInboundReceipts(effectiveClientId, receiptPage, receiptPageSize, receiptSort.sortBy, receiptSort.sortDir);
  const exportFilters = { clientId: effectiveClientId, sortBy: receiptSort.sortBy, sortDir: receiptSort.sortDir };
  const rows = query.data?.data ?? [];
  const receiptRows = receiptQuery.data?.data ?? [];
  const receiptPagination = receiptQuery.data?.pagination;
  const showClientFilter = clients.length > 1;

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

      {created && (
        <GlassPanel className="flex flex-wrap items-center justify-between gap-3 p-4" role="status">
          <div><p className="font-semibold text-ink">Inbound saved</p><p className="text-sm text-ink-2">{created.reference ?? `Shipment #${created.id}`}</p></div>
          <div className="flex gap-2">
            <Button onClick={() => setSelected(created)}>Open shipment</Button>
            <Button variant="secondary" onClick={() => setConfirmation(null)}>Dismiss</Button>
          </div>
        </GlassPanel>
      )}
      <GlassPanel className="p-2 sm:p-3">
        <div className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <PackageCheck size={17} className="text-emerald-600" />
            <div>
              <p className="text-sm font-semibold text-ink">Received inventory</p>
              <p className="text-xs text-ink-3">Canonical receipts recorded in PrepShip</p>
            </div>
          </div>
          <div className="sm:shrink-0">
            <ExportInboundReceiptsCsv key={JSON.stringify([userId, exportFilters])} filters={exportFilters}
              disabled={!receiptRows.length || receiptQuery.isFetching || receiptQuery.isError} />
          </div>
        </div>
        <QueryState showUpdateStatus={false}
          isLoading={receiptQuery.isLoading}
          isUpdating={receiptQuery.isFetching && !receiptQuery.isLoading}
          isError={receiptQuery.isError}
          error={receiptQuery.error}
          isEmpty={receiptRows.length === 0}
          onRetry={() => receiptQuery.refetch()}
          emptyTitle="No received inventory"
          emptyMessage="No PrepShip receipts have been recorded."
        >
          <DataTable isUpdating={receiptQuery.isFetching && !receiptQuery.isLoading}
            tableId="inbound-receipts"
            sort={receiptSort.sort} onSortChange={receiptSort.onSortChange}
            columns={INBOUND_RECEIPT_COLUMNS}
            rows={receiptRows}
            rowKey={(row) => String(row.id)}
            allowColumnCustomization={canCustomizeTables}
            stickyHeader
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

      <GlassPanel className="p-2 sm:p-3" role="region" aria-label="Expected shipments">
        <div className="flex items-center gap-2 px-3 py-3">
          <PackageOpen size={17} className="text-brand-600" />
          <div>
            <p className="text-sm font-semibold text-ink">Expected shipments</p>
            <p className="text-xs text-ink-3">Purchase orders and ASNs arriving at the warehouse</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3 px-3 pb-3">
          <label className="min-w-0 basis-full text-xs text-ink-2 sm:flex-1">
            Search shipments
            <input type="search" value={searchInput} maxLength={120} onChange={event => setSearchInput(event.target.value)}
              placeholder="PO, supplier, tracking number or SKU"
              className="focus-ring mt-1 h-11 w-full rounded-glass-sm border border-slate-200 bg-white/70 px-3 text-sm text-ink" />
          </label>
          <label className="text-xs text-ink-2">
            Shipment status
            <select aria-label="Shipment status" value={status} onChange={event => setStatus(event.target.value)}
              className="focus-ring mt-1 block h-11 rounded-glass-sm border border-slate-200 bg-white/70 px-3 text-sm text-ink">
              <option value="">All statuses</option><option value="expected">Expected</option>
              <option value="in_transit">In transit</option><option value="received">Received</option><option value="cancelled">Cancelled</option>
            </select>
          </label>
          {(searchInput || status) && <Button variant="secondary" className="self-end"
            onClick={() => { setSearchInput(''); setStatus(''); }}>Clear filters</Button>}
        </div>
        <QueryState showUpdateStatus={false}
          isLoading={query.isLoading}
          isUpdating={query.isFetching && !query.isLoading}
          isError={query.isError}
          error={query.error}
          isEmpty={rows.length === 0}
          onRetry={() => query.refetch()}
          emptyTitle={filtered ? 'No matching shipments' : 'No inbound shipments'}
          emptyMessage={filtered ? 'Try another reference, supplier, tracking number or SKU, or clear your filters.'
            : isAdmin ? 'Click “New inbound” to record an expected purchase order, or Import a CSV feed.'
              : 'Inbound purchase orders will appear here once your operator records them.'}
        >
          <DataTable isUpdating={query.isFetching && !query.isLoading}
            tableId="inbound"
            columns={INBOUND_COLUMNS}
            rows={rows}
            rowKey={(row) => String(row.id)}
            onRowClick={setSelected}
            rowActionLabel={(row) => `View inbound ${row.reference ?? `#${row.id}`}`}
            allowColumnCustomization={canCustomizeTables}
            stickyHeader
          />
          {pagination && <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total}
            pageSize={pagination.pageSize} onPage={setPage} onPageSize={setPageSize} />}
        </QueryState>
      </GlassPanel>

      <InboundDetailDrawer selected={selected} onClose={() => setSelected(null)} canReceiveInventory={canReceiveInventory} />
      <InboundCreateModal open={modalOpen} onClose={() => setModalOpen(false)} clients={clients}
        onCreated={shipment => setConfirmation({ scope: confirmationScope, shipment })} />
      <InboundImportModal open={importOpen} onClose={() => setImportOpen(false)} clients={clients} />
      <ReceiveInventoryModal open={receiveOpen} onClose={() => setReceiveOpen(false)} clients={clients} />
    </div>
  );
}
