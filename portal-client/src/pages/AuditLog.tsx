import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Inbox, RefreshCw, Search, Store } from 'lucide-react';
import { GlassPanel, SectionTitle } from '@/components/ui/Glass';
import { Button } from '@/components/ui/Button';
import { Chip, EmptyState, Skeleton } from '@/components/ui/Display';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { useAuditLog, useCanCustomizeTables } from '@/lib/hooks';
import { cn } from '@/lib/cn';
import type { PortalAuditLogRow } from '@/lib/api';

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function eventTone(event: string): 'indigo' | 'teal' | 'amber' | 'rose' {
  if (event.includes('denied') || event.includes('delete')) return 'rose';
  if (event.includes('create') || event.includes('update') || event.includes('set')) return 'amber';
  if (event.includes('click') || event.includes('view')) return 'teal';
  return 'indigo';
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

function formatDetailValue(value: unknown): string {
  if (typeof value === 'string') return value.startsWith('/') ? routeLabel(value) : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `${value.length}`;
  try {
    return JSON.stringify(value);
  } catch {
    return '—';
  }
}

function detailEntries(metadata: Record<string, unknown>): Array<{ label: string; value: string }> {
  return Object.entries(metadata ?? {})
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => ({ label: humanizeKey(key), value: formatDetailValue(value) }));
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
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [storeFilter, setStoreFilter] = useState<number | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const audit = useAuditLog(debouncedSearch, 100, storeFilter);
  const canCustomizeTables = useCanCustomizeTables();
  const rows = audit.data?.data ?? [];
  const storeFilters = audit.data?.filters.stores ?? [];
  const visibleRows = useMemo(() => rows, [rows]);
  const columns: Column<PortalAuditLogRow>[] = useMemo(
    () => [
      {
        key: 'when',
        header: 'When',
        defaultWidth: 190,
        render: (row) => <span className="text-xs font-medium text-ink-3">{formatDate(row.createdAt)}</span>,
      },
      {
        key: 'event',
        header: 'Event',
        defaultWidth: 240,
        render: (row) => (
          <Chip accent={eventTone(row.event)} dot={false} className="max-w-full">
            <span className="truncate">{row.event}</span>
          </Chip>
        ),
      },
      {
        key: 'user',
        header: 'User',
        defaultWidth: 230,
        render: (row) => (
          <p className="truncate font-medium text-ink" title={row.actorEmail ?? row.actorUserId ?? undefined}>
            {row.actorEmail ?? row.actorUserId ?? 'Unknown user'}
          </p>
        ),
      },
      {
        key: 'scope',
        header: 'Session scope',
        defaultWidth: 220,
        render: (row) => (
          <span className="line-clamp-2 text-xs text-ink-3" title={scopeLabel(row)}>
            {scopeLabel(row)}
          </span>
        ),
      },
      {
        key: 'details',
        header: 'Details',
        defaultWidth: 360,
        minWidth: 240,
        render: (row) => (
          <div className="max-w-xl" title={detailPlain(row.metadata)}>
            <DetailPills metadata={row.metadata} />
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
            subtitle="Portal entries, page views, actions, and sidebar clicks"
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
              {storeFilters.map((store) => (
                <option key={store.id} value={store.id}>{store.name}</option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3">▾</span>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
          <ClipboardList size={14} />
          <span className="font-semibold text-ink-2">{visibleRows.length.toLocaleString()}</span>
          <span>recent events</span>
        </div>
      </GlassPanel>

      <GlassPanel className="p-2 sm:p-3">
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
            columns={columns}
            rows={visibleRows}
            rowKey={(row) => String(row.id)}
            allowColumnCustomization={canCustomizeTables}
          />
        ) : (
          <EmptyState
            icon={<Inbox size={24} />}
            title="No audit events"
            message={
              debouncedSearch || storeFilter
                ? 'No events match the selected filters.'
                : 'Portal audit events will appear here as users sign in and navigate.'
            }
          />
        )}
      </GlassPanel>
    </div>
  );
}
