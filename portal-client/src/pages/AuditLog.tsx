import { useMemo, useState } from 'react';
import { ClipboardList, Inbox, RefreshCw, Search, Store } from 'lucide-react';
import { GlassPanel, SectionTitle } from '@/components/ui/Glass';
import { Button } from '@/components/ui/Button';
import { Chip, EmptyState, Skeleton } from '@/components/ui/Display';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { TableUpdateStatus } from '@/components/ui/TableUpdateStatus';
import { Modal } from '@/components/ui/Modal';
import { useAuditLog, useCanCustomizeTables } from '@/lib/hooks';
import { cn } from '@/lib/cn';
import type { PortalAuditLogRow } from '@/lib/api';
import { AuditInvestigationFilters } from '@/components/audit/AuditInvestigationFilters';
import { CopyAuditView } from '@/components/audit/CopyAuditView';
import { ExportAuditCsv } from '@/components/audit/ExportAuditCsv';
import { useAuditView } from '@/lib/useAuditView';

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
}

function eventTone(event: string): 'indigo' | 'teal' | 'amber' | 'rose' {
  if (event.includes('denied') || event.includes('delete')) return 'rose';
  if (event.includes('create') || event.includes('update') || event.includes('set')) return 'amber';
  if (event.includes('click') || event.includes('view')) return 'teal';
  return 'indigo';
}

const EVENT_LABELS: Record<string, string> = {
  'portal.me.view': 'Opened client portal',
  'portal.ui.click': 'Clicked navigation',
  'portal.activity.view': 'Viewed recent activity',
  'portal.dashboard.daily_counts': 'Loaded dashboard daily totals',
  'portal.orders.awaiting_active_count': 'Checked awaiting shipment count',
  'portal.analysis.sku_orders': 'Viewed SKU orders',
  'portal.analysis.daily_shipments': 'Viewed daily shipments',
  'portal.inventory.history': 'Viewed inventory history',
  'portal.shipments.refresh_tracking': 'Refreshed shipment tracking',
  'portal.settings.scoped_empty': 'Opened settings with no assigned stores',
};

function sentenceWords(value: string): string {
  return value
    .replace(/[._-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
}

function eventLabel(event: string): string {
  if (EVENT_LABELS[event]) return EVENT_LABELS[event];

  const parts = event.replace(/^portal\./, '').split('.');
  const action = parts.pop() ?? '';
  const subject = sentenceWords(parts.join(' ')) || 'activity';
  const labels: Record<string, string> = {
    view: `Viewed ${subject}`,
    list: `Viewed ${subject}`,
    create: `Created ${subject}`,
    update: `Updated ${subject}`,
    set: `Updated ${subject}`,
    delete: `Deleted ${subject}`,
    import: `Imported ${subject}`,
    receive: `Received ${subject}`,
    deliver: `Delivered ${subject}`,
    approve: `Approved ${subject}`,
    reconnect: `Reconnected ${subject}`,
    rename: `Renamed ${subject}`,
    disconnect: `Disconnected ${subject}`,
    validate: `Validated ${subject}`,
    invite: `Invited ${subject}`,
    activate: `Activated ${subject}`,
    requested: `Requested ${subject}`,
    completed: `Completed ${subject}`,
    failed: `${subject} failed`,
    denied: `Access denied: ${subject}`,
    start: `Started ${subject}`,
  };
  const label = labels[action] ?? sentenceWords(event.replace(/^portal\./, ''));
  return label.replace(/^\w/, (character) => character.toUpperCase());
}

// ── Human-readable audit details ────────────────────────────────────────────
// The metadata is a small flat key/value object (page/pageSize/status, click
// to/from/target, orderId, tracking counts, …). Render it as labeled pills
// instead of raw JSON so an operator can scan it at a glance.
const DETAIL_KEY_LABELS: Record<string, string> = {
  to: 'To',
  from: 'From',
  target: 'Clicked',
  page: 'Page',
  pageSize: 'Per page',
  status: 'Status',
  orderId: 'Order',
  shipmentId: 'Shipment',
  returnId: 'Return',
  clientId: 'Client',
  storeId: 'Store',
  checked: 'Checked',
  updated: 'Updated',
  requested: 'Requested',
  count: 'Count',
  query: 'Search',
  q: 'Search',
  reason: 'Reason',
};

const ROUTE_LABELS: Record<string, string> = {
  '/': 'Dashboard',
  '/orders': 'Orders',
  '/shipments': 'Shipments',
  '/returns': 'Returns',
  '/inbound': 'Inbound',
  '/inventory': 'Inventory',
  '/analysis': 'Analysis',
  '/billing': 'Billing',
  '/rate-sheet': 'Rate Sheet',
  '/connections': 'Connections',
  '/audit-log': 'Audit log',
  '/settings': 'Settings',
};

function humanizeKey(key: string): string {
  if (DETAIL_KEY_LABELS[key]) return DETAIL_KEY_LABELS[key];
  // camelCase / snake_case → "Title Case".
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^\w/, (c) => c.toUpperCase());
}

function routeLabel(path: string): string {
  if (ROUTE_LABELS[path]) return ROUTE_LABELS[path];
  const base = path.replace(/^\//, '').split(/[/?]/)[0];
  if (!base) return 'Dashboard';
  return base.replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function formatDetailDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDetailValue(key: string, value: unknown): string {
  if (typeof value === 'string') {
    if (value.startsWith('/')) return routeLabel(value);
    const date = formatDetailDate(value);
    if (date) return date;
    if (key === 'status' || key === 'type') {
      const label = sentenceWords(value);
      return label.replace(/^\w/, (character) => character.toUpperCase());
    }
    return value;
  }
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? 'item' : 'items'}`;
  if (value && typeof value === 'object' && Object.keys(value).length === 0) return 'Not recorded';
  try {
    return JSON.stringify(value);
  } catch {
    return '—';
  }
}

function detailEntries(metadata: Record<string, unknown>): Array<{ label: string; value: string }> {
  return Object.entries(metadata ?? {})
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => ({ label: humanizeKey(key), value: formatDetailValue(key, value) }));
}

// Plain one-line version for hover titles + accessibility.
function detailPlain(metadata: Record<string, unknown>): string {
  const entries = detailEntries(metadata);
  return entries.length ? entries.map((e) => `${e.label}: ${e.value}`).join(' · ') : 'No details';
}

function DetailPills({ metadata }: { metadata: Record<string, unknown> }) {
  const entries = detailEntries(metadata);
  if (!entries.length) return <span className="text-xs italic text-ink-3">No details</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map((entry, index) => (
        <span
          key={`${entry.label}-${index}`}
          className="inline-flex max-w-full items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs ring-1 ring-slate-200/70"
          title={`${entry.label}: ${entry.value}`}
        >
          <span className="shrink-0 text-ink-3">{entry.label}</span>
          <span className="truncate font-semibold text-ink-2">{entry.value}</span>
        </span>
      ))}
    </div>
  );
}

function scopeLabel(row: PortalAuditLogRow): string {
  return row.scopeLabel || 'Global';
}

export default function AuditLog() {
  const { search, setSearch, debouncedSearch, storeFilter, setStoreFilter, userFilter, setUserFilter,
    filters, setFilters, page, setPage, invalid, copyUrl, searchPending, dateDraftKey } = useAuditView();
  const [selected, setSelected] = useState<PortalAuditLogRow | null>(null);

  const audit = useAuditLog(debouncedSearch, 100, storeFilter, userFilter, page, filters);
  const canCustomizeTables = useCanCustomizeTables();
  const rows = audit.data?.data ?? [];
  const storeFilters = audit.data?.filters.stores ?? [];
  const visibleRows = useMemo(() => rows, [rows]);
  const columns: Column<PortalAuditLogRow>[] = useMemo(
    () => [
      {
        key: 'when', sortAccessor: (row) => row.createdAt,
        header: 'When',
        defaultWidth: 190,
        render: (row) => <span className="text-xs font-medium text-ink-3">{formatDate(row.createdAt)}</span>,
      },
      {
        key: 'event', sortAccessor: (row) => row.activity?.label ?? eventLabel(row.event),
        header: 'Activity',
        defaultWidth: 280,
        render: (row) => (
          <div className="min-w-0 space-y-1" title={row.event}>
            <Chip accent={eventTone(row.event)} dot={false} className="max-w-full">
              <span className="truncate">{row.activity?.label ?? eventLabel(row.event)}</span>
            </Chip>
            {row.activity ? <p className="text-xs text-ink-3">{row.activity.category} · {row.activity.outcome}</p> : null}
            <p className="truncate font-mono text-[10px] text-ink-3">{row.event}</p>
          </div>
        ),
      },
      {
        key: 'user', sortAccessor: (row) => row.actorEmail ?? row.actorUserId,
        header: 'User',
        defaultWidth: 230,
        render: (row) => (
          <p className="truncate font-medium text-ink" title={row.actorEmail ?? row.actorUserId ?? undefined}>
            {row.actorEmail ?? row.actorUserId ?? 'Unknown user'}
          </p>
        ),
      },
      {
        key: 'scope', sortAccessor: (row) => scopeLabel(row),
        header: 'Session scope',
        defaultWidth: 220,
        render: (row) => (
          <span
            className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-ink-2 ring-1 ring-slate-200/70"
            title={scopeLabel(row)}
          >
            <Store size={12} className="shrink-0 text-ink-3" />
            <span className="line-clamp-2">{scopeLabel(row)}</span>
          </span>
        ),
      },
      {
        key: 'details', sortAccessor: (row) => row.activity?.summary ?? detailPlain(row.metadata),
        header: 'Details',
        defaultWidth: 360,
        minWidth: 240,
        render: (row) => (
          <div className="max-w-xl space-y-2">
            {row.activity ? <p className="line-clamp-3 break-words text-sm text-ink-2">{row.activity.summary}</p> : <DetailPills metadata={row.metadata} />}
            <Button size="sm" variant="secondary" onClick={() => setSelected(row)} aria-label={`View details for event ${row.id}`}>View details</Button>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <GlassPanel className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle
            title="Audit log"
            subtitle="Recorded activity from all portal users. Select a user to view their history, or browse older events."
            right={
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<RefreshCw size={15} className={cn(audit.isFetching && 'animate-spin')} />}
                onClick={() => void audit.refetch()}
              >
                Refresh
              </Button>
            }
          />
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <label className="relative block w-full max-w-xl">
            <span className="sr-only">Search event or user</span>
            <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search event or user"
              className="focus-ring h-11 w-full rounded-glass-sm border border-slate-200/80 bg-white/75 pl-10 pr-3 text-sm text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-brand-300"
            />
          </label>
          <label className="relative block w-full sm:w-64">
            <span className="sr-only">Filter audit log by store</span>
            <Store size={16} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-ink-3" />
            <select
              value={storeFilter ?? ''}
              onChange={(event) => setStoreFilter(event.target.value ? Number(event.target.value) : null)}
              aria-label="Filter audit log by store"
              className="focus-ring h-11 w-full cursor-pointer appearance-none rounded-glass-sm border border-white/80 bg-white/70 pl-10 pr-9 text-sm font-medium text-ink ring-1 ring-slate-200/70 focus:bg-white/90"
            >
              <option value="">All stores</option>
              {storeFilter && !storeFilters.some(store => store.id === storeFilter) && <option value={storeFilter}>Store #{storeFilter}</option>}
              {storeFilters.map((store) => (
                <option key={store.id} value={store.id}>{store.name}</option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3">▾</span>
          </label>
          <label className="block w-full lg:w-72 lg:shrink-0">
            <span className="sr-only">Filter audit log by user</span>
            <select aria-label="Filter audit log by user" value={userFilter}
              onChange={(event) => setUserFilter(event.target.value)}
              className="focus-ring h-11 w-full min-w-0 rounded-glass-sm border border-slate-200/80 bg-white/75 px-3 text-sm text-ink">
              <option value="">All users</option>
              {userFilter && !audit.data?.filters.users?.includes(userFilter) && <option value={userFilter}>{userFilter}</option>}
              {(audit.data?.filters.users ?? []).map((email) => <option key={email} value={email}>{email}</option>)}
            </select>
          </label>
        </div>
        {invalid && <p role="alert" className="text-sm text-ink-2">Some link filters were invalid and were reset. Check the selected filters below.</p>}
        <AuditInvestigationFilters key={`${dateDraftKey}/${filters.dateFrom ?? ''}/${filters.dateTo ?? ''}`} value={filters} onChange={setFilters} />
        <CopyAuditView key={JSON.stringify([debouncedSearch, storeFilter, userFilter, filters, page])} getUrl={copyUrl} disabled={searchPending} />
        <ExportAuditCsv key={JSON.stringify([debouncedSearch, storeFilter, userFilter, filters])}
          filters={{ ...filters, search: debouncedSearch, storeId: storeFilter, actorEmail: userFilter }} disabled={searchPending || invalid} />
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
          <ClipboardList size={14} />
          <span className="font-semibold text-ink-2">{visibleRows.length.toLocaleString()}</span>
          <span>events on page {page} · {userFilter || 'All users'}</span>
        </div>
      </GlassPanel>

      <GlassPanel className="p-2 sm:p-3">
        <TableUpdateStatus updating={!visibleRows.length && audit.isFetching && !audit.isLoading && !audit.isError} />
        {audit.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-12 rounded-glass-sm" />
            ))}
          </div>
        ) : audit.isError ? (
          <EmptyState
            icon={<ClipboardList size={24} />}
            title="Audit log unavailable"
            message="Portal audit events are temporarily unavailable."
            action={
              <Button variant="secondary" size="sm" onClick={() => void audit.refetch()}>
                Retry
              </Button>
            }
          />
        ) : visibleRows.length ? (
          <DataTable
            tableId="audit-log"
            isUpdating={audit.isFetching}
            columns={columns}
            rows={visibleRows}
            rowKey={(row) => String(row.id)}
            allowColumnCustomization={canCustomizeTables}
            stickyHeader
          />
        ) : (
          <EmptyState
            icon={<Inbox size={24} />}
            title="No audit events"
            message={
              debouncedSearch || storeFilter || userFilter || filters.dateFrom || filters.dateTo || filters.hideBackground || (filters.activity && filters.activity !== 'all')
                ? 'No events match the selected filters.'
                : 'Portal audit events will appear here as users sign in and navigate.'
            }
          />
        )}
        {audit.data?.pagination ? <div className="flex items-center justify-between gap-3 border-t border-slate-200 p-3">
          <Button size="sm" variant="secondary" disabled={page === 1 || audit.isFetching} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-xs text-ink-3">Page {audit.data.pagination.page}</span>
          <Button size="sm" variant="secondary" disabled={!audit.data.pagination.hasMore || audit.isFetching} onClick={() => setPage(page + 1)}>Older events</Button>
        </div> : null}
      </GlassPanel>
      <Modal open={selected !== null} onClose={() => setSelected(null)} title="Audit event details" maxWidth={760}>
        {selected ? <div className="space-y-5">
          <div>
            <h3 className="font-semibold text-ink">{selected.activity?.label ?? eventLabel(selected.event)}</h3>
            <p className="mt-1 break-words text-sm text-ink-2">{selected.activity?.summary ?? detailPlain(selected.metadata)}</p>
          </div>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            {[
              ['When', formatDate(selected.createdAt)],
              ['User', selected.actorEmail ?? selected.actorUserId ?? 'Not recorded'],
              ['Activity type', selected.activity?.category ?? 'Not recorded'],
              ['Outcome', selected.activity?.outcome ?? 'Not recorded'],
              ['Session scope', scopeLabel(selected)],
              ['Event ID', String(selected.id)],
            ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-ink-3">{label}</dt><dd className="mt-1 break-words font-medium text-ink">{value}</dd></div>)}
          </dl>
          <div className="rounded-lg bg-slate-50 p-3 text-sm text-ink-2">
            {selected.activity?.note ?? 'Only recorded details are available for this event.'}
            <p className="mt-1">Session scope lists the user’s available clients and stores, not necessarily the records affected by this event.</p>
          </div>
          <div>
            <h4 className="mb-2 text-sm font-semibold">Recorded details</h4>
            <dl className="divide-y divide-slate-200">
              {(selected.activity?.details ?? detailEntries(selected.metadata)).map((detail, index) => (
                <div key={`${detail.label}-${index}`} className="grid grid-cols-1 gap-1 py-2 text-sm sm:grid-cols-[180px_minmax(0,1fr)]">
                  <dt className="text-ink-3">{detail.label}</dt><dd className="whitespace-pre-wrap break-words text-ink">{detail.value}</dd>
                </div>
              ))}
            </dl>
            {(selected.activity?.details ?? detailEntries(selected.metadata)).length === 0 ? <p className="text-sm text-ink-3">Additional details: Not recorded</p> : null}
          </div>
          <p className="break-all font-mono text-xs text-ink-3">{selected.event}</p>
        </div> : null}
      </Modal>
    </div>
  );
}
