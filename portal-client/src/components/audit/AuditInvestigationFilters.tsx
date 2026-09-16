import { useState } from 'react';
import type { PortalAuditInvestigationFilters } from '@client-portal-contracts/access';
import { Button } from '@/components/ui/Button';

const inputClass = 'focus-ring h-11 w-full rounded-glass-sm border border-slate-200/80 bg-white/75 px-3 text-sm text-ink';

function localDay(instant?: string, exclusiveEnd = false) {
  if (!instant) return '';
  const date = new Date(Date.parse(instant) - (exclusiveEnd ? 1 : 0));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function AuditInvestigationFilters({ value, onChange }: {
  value: PortalAuditInvestigationFilters;
  onChange: (value: PortalAuditInvestigationFilters) => void;
}) {
  const [start, setStart] = useState(() => localDay(value.dateFrom));
  const [end, setEnd] = useState(() => localDay(value.dateTo, true));
  const invalid = Boolean(start && end && start > end);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  function applyDates() {
    const from = start ? new Date(`${start}T00:00:00`) : undefined;
    const to = end ? new Date(`${end}T00:00:00`) : undefined;
    // Next local calendar midnight, not +24 hours: keeps DST days inclusive.
    if (to) to.setDate(to.getDate() + 1);
    onChange({ ...value, dateFrom: from?.toISOString(), dateTo: to?.toISOString() });
  }
  return <div className="space-y-3 border-t border-slate-200/70 pt-3">
    <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); if (!invalid) applyDates(); }}>
      <label className="min-w-0 flex-1 space-y-1 text-xs text-ink-2 sm:flex-none">Start date
        <input type="date" aria-label="Audit start date" value={start} max={end || undefined}
          onChange={event => setStart(event.target.value)} className={inputClass} />
      </label>
      <label className="min-w-0 flex-1 space-y-1 text-xs text-ink-2 sm:flex-none">End date
        <input type="date" aria-label="Audit end date" value={end} min={start || undefined}
          onChange={event => setEnd(event.target.value)} className={inputClass} />
      </label>
      <Button type="submit" variant="secondary" disabled={invalid}>Apply dates</Button>
      {(start || end || value.dateFrom || value.dateTo) && <Button type="button" variant="ghost" onClick={() => {
        // Applied dates clear when navigation commits; an interrupted navigation
        // must not erase inputs belonging to the prior history entry.
        if (!value.dateFrom && !value.dateTo) { setStart(''); setEnd(''); }
        onChange({ ...value, dateFrom: undefined, dateTo: undefined });
      }}>Clear dates</Button>}
    </form>
    <p className="text-xs text-ink-3">Dates use {timezone}. {invalid ? 'End date must be on or after start date.' :
      value.dateFrom || value.dateTo ? 'Applied date range shown below.' : 'Showing all dates.'}</p>
    {(value.dateFrom || value.dateTo) && <p className="text-xs text-ink-2">
      From {value.dateFrom ? new Date(value.dateFrom).toLocaleString() : 'earliest event'} to {value.dateTo ? new Date(Date.parse(value.dateTo) - 1).toLocaleString() : 'latest event'}
    </p>}
    <div className="flex flex-wrap items-center gap-3">
      <label className="w-full space-y-1 text-xs text-ink-2 sm:w-64">Activity
        <select aria-label="Filter audit log by activity" value={value.activity ?? 'all'}
          onChange={event => onChange({ ...value, activity: event.target.value as PortalAuditInvestigationFilters['activity'] })} className={inputClass}>
          <option value="all">All activity</option><option value="views">Views / data requests</option>
          <option value="actions">Actions / requests</option><option value="navigation">Navigation clicks</option>
          <option value="failed">Failures</option><option value="denied">Denied actions</option>
        </select>
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm text-ink-2">
        <input type="checkbox" checked={value.hideBackground ?? false}
          onChange={event => onChange({ ...value, hideBackground: event.target.checked })} />Hide background checks
      </label>
    </div>
    <p className="text-xs text-ink-3">Background checks include session and awaiting-shipment count checks. Data requests can also happen automatically.</p>
  </div>;
}
