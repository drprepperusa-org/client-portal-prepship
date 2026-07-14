import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building2, Download, ExternalLink, Filter, PackageCheck } from 'lucide-react';
import { ReturnCreateModal } from '@/components/returns/ReturnCreateModal';
import { ReturnDetailDrawer } from '@/components/returns/ReturnDetailDrawer';
import { ReturnReceivingModal } from '@/components/returns/ReturnReceivingModal';
import {
  clientAccent,
  RETURN_DELIVERY_LABEL,
  RETURN_STATUS_OPTIONS,
  returnStatusMeta,
} from '@/components/returns/returnPresentation';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Chip } from '@/components/ui/Display';
import { GlassPanel } from '@/components/ui/Glass';
import { Pagination } from '@/components/ui/Pagination';
import { QueryState } from '@/components/ui/QueryState';
import { SearchInput } from '@/components/ui/SearchInput';
import {
  useCanCustomizeTables,
  useClients,
  useMe,
  useReturns,
} from '@/lib/hooks';
import type { PortalReturnRow } from '@/lib/api';
import { usePortalFilters } from '@/lib/portalContext';
import { money, shortDate } from '@/lib/status';
import { useDebounced } from '@/lib/useDebounced';

// CP-034: return tracking URLs are backend-built carrier links. The portal
// renders copyable text when the carrier is unknown and never exposes identity.
export default function Returns() {
  const { clientId: globalClientId } = usePortalFilters();
  const clients = useClients().data?.data ?? [];
  const me = useMe().data;
  const canCustomizeTables = useCanCustomizeTables();
  // Backend permissions remain authoritative; this only hides operator UI.
  const isOperator = Boolean(me?.isAdmin || me?.isGlobal);
  const [params] = useSearchParams();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [clientFilter, setClientFilter] = useState<number | undefined>();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOrderId, setCreateOrderId] = useState<number | null>(null);
  const [receivingOpen, setReceivingOpen] = useState(false);
  const debouncedSearch = useDebounced(search, 350);
  const effectiveClientId = clientFilter ?? globalClientId;
  const orderParam = params.get('order');
  const orderFilter = orderParam ? Number(orderParam) : undefined;
  const newParam = params.get('new');

  useEffect(() => {
    if (newParam) setCreateOrderId(Number(newParam));
  }, [newParam]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, effectiveClientId, statusFilter, orderFilter]);

  const query = useReturns({
    search: debouncedSearch,
    page,
    status: statusFilter || undefined,
    clientId: effectiveClientId,
    orderId: orderFilter,
  });
  const returnsFetchFailed = query.failureCount > 0;
  const rows = query.data?.data ?? [];
  const pagination = query.data?.pagination;

  const columns: Column<PortalReturnRow>[] = useMemo(
    () => [
      {
        key: 'returnReference',
        header: 'Return ref',
        defaultWidth: 150,
        render: (row) => (
          <span className="font-mono text-xs font-semibold text-ink">
            {row.returnReference}
          </span>
        ),
        sortAccessor: (row) => row.returnReference,
      },
      {
        key: 'order',
        header: 'Order',
        defaultWidth: 150,
        render: (row) => (
          <span className="font-semibold text-ink">
            {row.orderNumber ?? (row.orderId ? `#${row.orderId}` : '—')}
          </span>
        ),
        sortAccessor: (row) => row.orderNumber ?? '',
      },
      {
        key: 'client',
        header: 'Client',
        defaultWidth: 150,
        render: (row) => row.clientName
          ? <Chip accent={clientAccent(row.clientName)} dot={false}>{row.clientName}</Chip>
          : <span className="text-ink-3">—</span>,
        sortAccessor: (row) => row.clientName ?? '',
      },
      {
        key: 'status',
        header: 'Status',
        defaultWidth: 130,
        render: (row) => {
          const status = returnStatusMeta(row.status);
          return <Chip accent={status.accent}>{status.label}</Chip>;
        },
        sortAccessor: (row) => row.status,
      },
      {
        key: 'delivery',
        header: 'Delivery',
        defaultWidth: 130,
        render: (row) => (
          <span className="text-ink-2">
            {row.deliveryMethod
              ? RETURN_DELIVERY_LABEL[row.deliveryMethod] ?? row.deliveryMethod
              : '—'}
          </span>
        ),
        sortAccessor: (row) => row.deliveryMethod ?? '',
      },
      {
        key: 'tracking',
        header: 'Tracking #',
        defaultWidth: 180,
        render: (row) => {
          if (!row.trackingNumber) return <span className="text-ink-3">—</span>;
          return row.trackingUrl ? (
            <a
              href={row.trackingUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="focus-ring inline-flex min-h-11 items-center gap-1 font-mono text-xs text-brand-700 hover:text-brand-600 hover:underline sm:min-h-8"
              title="Track return"
            >
              <span className="truncate">{row.trackingNumber}</span>
              <ExternalLink size={12} className="shrink-0" />
            </a>
          ) : (
            <span className="font-mono text-xs text-ink-2">{row.trackingNumber}</span>
          );
        },
        sortAccessor: (row) => row.trackingNumber ?? '',
      },
      {
        key: 'labelPdf',
        header: 'Label PDF',
        defaultWidth: 140,
        render: (row) => row.pdfAvailable ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setSelectedId(row.id);
            }}
            className={
              'focus-ring inline-flex min-h-11 cursor-pointer items-center gap-1.5 ' +
              'rounded-glass-sm bg-brand-50 px-2.5 text-xs font-semibold text-brand-700 ' +
              'ring-1 ring-brand-100 transition-colors hover:bg-brand-100 sm:min-h-8'
            }
            title="Open return detail to download the PDF"
          >
            <Download size={13} /> Download
          </button>
        ) : (
          <span className={
            `inline-flex min-h-11 items-center rounded-glass-sm px-2.5 text-xs font-medium ring-1 sm:min-h-8 ${
              row.status === 'label_failed'
                ? 'bg-rose-50 text-rose-700 ring-rose-200'
                : 'bg-slate-50 text-ink-3 ring-slate-200'
            }`
          }>
            {row.status === 'label_failed' ? 'Needs retry' : 'Label pending'}
          </span>
        ),
        sortAccessor: (row) => row.pdfAvailable ? 1 : 0,
      },
      {
        key: 'returnCustomerShippingRate',
        header: 'Return postage',
        defaultWidth: 110,
        className: 'text-right',
        render: (row) => (
          <span className="font-semibold text-ink tnum">
            {row.returnCustomerShippingRate != null
              ? money(row.returnCustomerShippingRate)
              : '—'}
          </span>
        ),
        sortAccessor: (row) => row.returnCustomerShippingRate ?? -1,
      },
      {
        key: 'created',
        header: 'Created',
        defaultWidth: 130,
        render: (row) => <span className="text-ink-3 tnum">{shortDate(row.createdAt)}</span>,
        sortAccessor: (row) => row.createdAt ?? '',
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <GlassPanel className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search return ref, order #, tracking, reason..."
          ariaLabel="Search returns"
        />
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          {isOperator && (
            <Button leadingIcon={<PackageCheck size={16} />} onClick={() => setReceivingOpen(true)}>
              Receive returns
            </Button>
          )}
          <label className="relative flex items-center">
            <Filter size={15} className="pointer-events-none absolute left-3 z-10 text-ink-3" />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              aria-label="Filter by status"
              className="focus-ring h-11 cursor-pointer appearance-none rounded-glass-sm border border-white/80 bg-white/60 pl-9 pr-9 text-sm font-medium text-ink ring-1 ring-slate-200/70 focus:bg-white/90"
            >
              <option value="">All statuses</option>
              {RETURN_STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>{returnStatusMeta(status).label}</option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 text-ink-3">▾</span>
          </label>
          {clients.length > 1 && (
            <label className="relative flex items-center">
              <Building2 size={15} className="pointer-events-none absolute left-3 z-10 text-ink-3" />
              <select
                value={clientFilter ?? ''}
                onChange={(event) => setClientFilter(event.target.value ? Number(event.target.value) : undefined)}
                aria-label="Filter by client"
                className="focus-ring h-11 cursor-pointer appearance-none rounded-glass-sm border border-white/80 bg-white/60 pl-9 pr-9 text-sm font-medium text-ink ring-1 ring-slate-200/70 focus:bg-white/90"
              >
                <option value="">All clients</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name ?? `Client ${client.id}`}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 text-ink-3">▾</span>
            </label>
          )}
        </div>
      </GlassPanel>

      <GlassPanel className="p-2 sm:p-3">
        <QueryState
          isLoading={query.isLoading && !returnsFetchFailed}
          isError={query.isError || returnsFetchFailed}
          error={query.error}
          isEmpty={rows.length === 0}
          onRetry={() => query.refetch()}
          emptyTitle={statusFilter || debouncedSearch ? 'No matching returns' : 'No returns yet'}
          emptyMessage="Start a return from an order or shipment, and it will appear here."
        >
          <DataTable
            tableId="returns"
            columns={columns}
            rows={rows}
            rowKey={(row) => String(row.id)}
            onRowClick={(row) => setSelectedId(row.id)}
            rowActionLabel={(row) => `View return ${row.returnReference}`}
            allowColumnCustomization={canCustomizeTables}
          />
          {pagination && (
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              total={pagination.total}
              pageSize={pagination.pageSize}
              onPage={setPage}
            />
          )}
        </QueryState>
      </GlassPanel>

      <ReturnDetailDrawer
        id={selectedId}
        onClose={() => setSelectedId(null)}
      />
      <ReturnCreateModal
        open={createOrderId != null}
        orderId={createOrderId}
        onClose={() => setCreateOrderId(null)}
        onCreated={setSelectedId}
      />
      {isOperator && (
        <ReturnReceivingModal open={receivingOpen} onClose={() => setReceivingOpen(false)} />
      )}
    </div>
  );
}
