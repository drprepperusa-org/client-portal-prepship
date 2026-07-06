import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Clock3, Inbox, RefreshCw, Search, ShieldCheck, UserRound } from 'lucide-react';
import { GlassPanel, SectionTitle } from '@/components/ui/Glass';
import { Button } from '@/components/ui/Button';
import { Chip, EmptyState, Skeleton } from '@/components/ui/Display';
import { useAuditLog } from '@/lib/hooks';
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

function metadataText(metadata: Record<string, unknown>): string {
  const entries = Object.entries(metadata ?? {}).filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (!entries.length) return 'No details';
  try {
    return JSON.stringify(Object.fromEntries(entries));
  } catch {
    return 'Details unavailable';
  }
}

function scopeLabel(row: PortalAuditLogRow): string {
  return row.scopeLabel || 'Global';
}

function LogMobileRow({ row }: { row: PortalAuditLogRow }) {
  const details = metadataText(row.metadata);
  return (
    <div className="space-y-3 border-b border-slate-100 px-4 py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Chip accent={eventTone(row.event)} dot={false} className="max-w-full">
            <span className="truncate">{row.event}</span>
          </Chip>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-3">
            <Clock3 size={13} /> {formatDate(row.createdAt)}
          </p>
        </div>
        <span className="tnum rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-ink-3 ring-1 ring-slate-200">#{row.id}</span>
      </div>
      <div className="grid gap-2 text-sm">
        <p className="flex min-w-0 items-center gap-2 text-ink-2">
          <UserRound size={14} className="shrink-0 text-ink-3" />
          <span className="truncate">{row.actorEmail ?? row.actorUserId ?? 'Unknown user'}</span>
        </p>
        <p className="flex min-w-0 items-center gap-2 text-ink-3">
          <ShieldCheck size={14} className="shrink-0" />
          <span className="truncate">{scopeLabel(row)}</span>
        </p>
      </div>
      <p className="line-clamp-2 rounded-glass-sm bg-slate-50/80 px-3 py-2 font-mono text-xs text-ink-2 ring-1 ring-slate-200/70" title={details}>
        {details}
      </p>
    </div>
  );
}

export default function AuditLog() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const audit = useAuditLog(debouncedSearch, 100);
  const rows = audit.data?.data ?? [];
  const visibleRows = useMemo(() => rows, [rows]);

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
        <label className="relative block max-w-xl">
          <span className="sr-only">Search event or user</span>
          <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search event or user"
            className="focus-ring h-11 w-full rounded-glass-sm border border-slate-200/80 bg-white/75 pl-10 pr-3 text-sm text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-brand-300"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
          <ClipboardList size={14} />
          <span className="font-semibold text-ink-2">{visibleRows.length.toLocaleString()}</span>
          <span>recent events</span>
        </div>
      </GlassPanel>

      <GlassPanel className="overflow-hidden p-0">
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
            message={audit.error instanceof Error ? audit.error.message : 'Could not load portal audit events.'}
            action={
              <Button variant="secondary" size="sm" onClick={() => void audit.refetch()}>
                Retry
              </Button>
            }
          />
        ) : visibleRows.length ? (
          <>
            <div className="sm:hidden">
              {visibleRows.map((row) => (
                <LogMobileRow key={row.id} row={row} />
              ))}
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-[960px] w-full divide-y divide-slate-200/80 text-sm" aria-label="Audit log">
                <thead className="bg-slate-50/75 text-[11px] uppercase tracking-wide text-ink-3">
                  <tr>
                    <th scope="col" className="w-44 px-4 py-3 text-left font-bold">When</th>
                    <th scope="col" className="w-64 px-4 py-3 text-left font-bold">Event</th>
                    <th scope="col" className="w-56 px-4 py-3 text-left font-bold">User</th>
                    <th scope="col" className="w-52 px-4 py-3 text-left font-bold">Session scope</th>
                    <th scope="col" className="px-4 py-3 text-left font-bold">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white/55">
                  {visibleRows.map((row) => {
                    const details = metadataText(row.metadata);
                    return (
                      <tr key={row.id} className="transition-colors hover:bg-brand-50/40">
                        <td className="px-4 py-3 align-top text-xs font-medium text-ink-3">{formatDate(row.createdAt)}</td>
                        <td className="px-4 py-3 align-top">
                          <Chip accent={eventTone(row.event)} dot={false} className="max-w-full">
                            <span className="truncate">{row.event}</span>
                          </Chip>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <p className="truncate font-medium text-ink" title={row.actorEmail ?? row.actorUserId ?? undefined}>
                            {row.actorEmail ?? row.actorUserId ?? 'Unknown user'}
                          </p>
                        </td>
                        <td className="px-4 py-3 align-top text-xs text-ink-3">
                          <span className="line-clamp-2" title={scopeLabel(row)}>{scopeLabel(row)}</span>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <p className="line-clamp-2 max-w-xl font-mono text-xs leading-relaxed text-ink-2" title={details}>
                            {details}
                          </p>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <EmptyState
            icon={<Inbox size={24} />}
            title="No audit events"
            message={debouncedSearch ? 'No events match that search.' : 'Portal audit events will appear here as users sign in and navigate.'}
          />
        )}
      </GlassPanel>
    </div>
  );
}
