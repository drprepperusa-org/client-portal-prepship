import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMe, useTokenQuery } from '@/lib/hooks';
import { portalApi } from '@/lib/api';
import { useDebounced } from '@/lib/useDebounced';
import { useFilteredPage } from '@/lib/useFilteredPage';
import { Button } from '@/components/ui/Button';
import { GlassPanel } from '@/components/ui/Glass';
import { SearchInput } from '@/components/ui/SearchInput';
import type { PortalClientActivityEvent, PortalClientActivityResponse } from '@client-portal-contracts/access';

function timestamp(value: string) { return new Date(value).toLocaleString(); }
function Event({ event }: { event: PortalClientActivityEvent }) {
  return <div className="min-w-0 space-y-1">
    <p className="break-words text-sm text-ink">{event.activity.summary}</p>
    <p className="break-words text-xs text-ink-3">{event.actorEmail ?? event.actorUserId ?? 'Actor not recorded'} · {timestamp(event.createdAt)}</p>
    <p className="text-xs text-ink-3">{event.activity.category} · {event.activity.outcome}</p>
  </div>;
}
function auditLink(clientId: number, window: PortalClientActivityResponse['window'], activity?: string) {
  const params = new URLSearchParams({ clientId: String(clientId), dateFrom: window.dateFrom, dateTo: window.dateTo, hideBackground: 'true' });
  if (activity) params.set('activity', activity);
  return `/audit-log?${params}`;
}

export function ClientActivityPanel() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [days, setDays] = useState(30);
  const appliedSearch = useDebounced(search.trim().slice(0, 120), 350);
  const [page, setPage] = useFilteredPage(JSON.stringify([appliedSearch, days]));
  const canView = useMe().data?.canViewAudit === true;
  const query = useTokenQuery(['client-activity', appliedSearch, days, page],
    token => portalApi.clientActivity(token, { search: appliedSearch, days, page }), open && canView,
    { alwaysRefetch: true, refetchOnWindowFocus: true });
  if (!canView) return null;
  const result = query.data;
  return <GlassPanel className="space-y-4 p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-display font-bold text-ink">Client activity</h2>
        <p className="mt-1 text-sm text-ink-3">Latest recorded activity, recent actions and failed or denied events for each client.</p></div>
      <Button variant="secondary" size="sm" aria-expanded={open} aria-controls="client-activity-overview"
        onClick={() => setOpen(!open)}>{open ? 'Hide client activity' : 'View client activity'}</Button>
    </div>
    {open && <section id="client-activity-overview" aria-label="Client activity overview" className="space-y-4">
      <p className="text-xs text-ink-3">Includes client users and staff. Background checks are excluded. Data requests may be automatic;
        recorded activity does not establish online presence. Events without a client attribution remain in All clients audit history.</p>
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search clients…" ariaLabel="Search activity clients" />
        <label className="text-sm text-ink-2">Period
          <select aria-label="Client activity period" value={days} onChange={e => setDays(Number(e.target.value))}
            className="focus-ring ml-2 h-11 rounded-glass-sm bg-white/70 px-3 ring-1 ring-slate-200">
            {[7, 30, 90].map(value => <option key={value} value={value}>Last {value} days</option>)}
          </select>
        </label>
        <Button size="sm" variant="secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh client activity</Button>
      </div>
      {query.isError ? <div role="alert" className="space-y-2 text-sm text-ink-2">
        <p>Client activity unavailable. No activity totals could be confirmed.</p>
        <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>Retry client activity</Button>
      </div> : query.isLoading ? <p role="status" className="text-sm text-ink-3">Loading client activity…</p> : result && <>
        <p className="text-xs text-ink-3">Recorded from {timestamp(result.window.dateFrom)} to {timestamp(result.window.dateTo)}.
          {query.isFetching ? ' Refreshing…' : ''}</p>
        {!result.data.length && <p className="text-sm text-ink-2">No clients match this search.</p>}
        <ul className="space-y-3" aria-label="Client activity results">
          {result.data.map(row => <li key={row.clientId} className="space-y-3 rounded-glass-sm border border-slate-200/80 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="min-w-0 break-words font-semibold text-ink">{row.clientName}{!row.active && ' (Inactive)'}</h3>
              <Link className="focus-ring rounded text-sm font-semibold text-brand-700 underline" to={auditLink(row.clientId, result.window)}
                onClick={() => setOpen(false)} aria-label={`Audit history for ${row.clientName}`}>Open audit history</Link>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div><p className="mb-2 text-xs font-semibold text-ink-3">Latest recorded event</p>
                {row.latestEvent ? <Event event={row.latestEvent} /> : <p className="text-sm text-ink-3">No recorded activity in this period.</p>}</div>
              <div><p className="mb-2 text-xs font-semibold text-ink-3">Recent actions / navigation</p>
                {row.recentActions.length ? <ul className="space-y-3">{row.recentActions.map(event => <li key={event.id}><Event event={event} /></li>)}</ul>
                  : <p className="text-sm text-ink-3">No actions or navigation recorded in this period.</p>}</div>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <Link className="focus-ring rounded text-brand-700 underline" to={auditLink(row.clientId, result.window, 'failed')}
                onClick={() => setOpen(false)} aria-label={`Failed events for ${row.clientName}`}>Failed events: {row.failedCount}</Link>
              <Link className="focus-ring rounded text-brand-700 underline" to={auditLink(row.clientId, result.window, 'denied')}
                onClick={() => setOpen(false)} aria-label={`Denied events for ${row.clientName}`}>Denied events: {row.deniedCount}</Link>
            </div>
          </li>)}
        </ul>
        <div className="flex items-center justify-between gap-3">
          <Button size="sm" variant="secondary" disabled={page === 1 || query.isFetching} onClick={() => setPage(page - 1)}>Previous clients</Button>
          <span className="text-xs text-ink-3">Client page {result.pagination.page}</span>
          <Button size="sm" variant="secondary" disabled={!result.pagination.hasMore || query.isFetching} onClick={() => setPage(page + 1)}>More clients</Button>
        </div>
      </>}
    </section>}
  </GlassPanel>;
}
