import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { GlassPanel, SectionTitle } from '@/components/ui/Glass';
import { Button } from '@/components/ui/Button';
import { useTokenQuery } from '@/lib/hooks';
import { usePortalFilters } from '@/lib/portalContext';
import { PORTAL_SEARCH_GROUPS, searchListLink, type SearchGroup } from '@/lib/portal-search';

export default function PortalSearch() {
  const [params, setParams] = useSearchParams();
  const search = (params.get('q') ?? '').trim();
  const { clientId } = usePortalFilters();
  // URL is submitted intent; typing does not fan out five new requests.
  const [draft, setDraft] = useState({ applied: search, value: search });
  if (draft.applied !== search) setDraft({ applied: search, value: search });
  const valid = search.length >= 2 && search.length <= 120;
  function submit(event: FormEvent) {
    event.preventDefault();
    setParams(draft.value.trim() ? { q: draft.value.trim() } : {});
  }
  return <div className="space-y-4">
    <GlassPanel className="space-y-4 p-4 sm:p-5">
      <SectionTitle title="Search portal" subtitle="Orders, shipments, inventory, returns and replacements. All statuses and dates; your current client selection applies." />
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 text-sm text-ink-2">Search term
          <input type="search" aria-label="Search across portal" value={draft.value} maxLength={120}
            onChange={event => setDraft({ applied: search, value: event.target.value })}
            placeholder="Order, SKU, tracking or reference…"
            className="focus-ring mt-1 h-11 w-full rounded-glass-sm bg-white/70 px-3 text-ink ring-1 ring-slate-200" />
        </label>
        <Button type="submit" disabled={draft.value.trim().length < 2 || draft.value.trim().length > 120}>Search</Button>
      </form>
      {!valid && <p role="status" className="text-sm text-ink-3">Enter 2–120 characters to search.</p>}
      {valid && <p className="break-words text-sm text-ink-3">Results for “{search}”. Each section previews its first five matches.</p>}
    </GlassPanel>
    {valid && <div className="grid items-start gap-4 xl:grid-cols-2">
      {PORTAL_SEARCH_GROUPS.map(group => <ResultGroup key={`${clientId ?? 'scope'}/${group.key}/${search}`}
        group={group} search={search} clientId={clientId} />)}
    </div>}
  </div>;
}

function ResultGroup({ group, search, clientId }: { group: SearchGroup; search: string; clientId?: number }) {
  const query = useTokenQuery(['portal-search', group.key, clientId ?? 'scope', search],
    token => group.load(token, { search, clientId, page: 1, pageSize: 5 }), true, { alwaysRefetch: true });
  const result = query.data;
  return <GlassPanel className="min-w-0 space-y-3 p-4 sm:p-5">
    <section aria-label={`${group.title} search results`} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display font-bold text-ink">{group.title}</h2>
        {result && !query.isError && <span className="text-xs text-ink-3">{result.pagination.total.toLocaleString()} matching records</span>}
      </div>
      <p className="text-xs text-ink-3">{group.hint}</p>
      {query.isLoading ? <p role="status" className="text-sm text-ink-3">Searching {group.title.toLowerCase()}…</p>
        : query.isError ? <div role="alert" className="space-y-2">
          <p className="text-sm text-ink-2">{group.title} search unavailable. Other sections can still show results.</p>
          <Button variant="secondary" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>Retry {group.title.toLowerCase()}</Button>
        </div> : result && <>
          {query.isFetching && <p role="status" className="text-xs text-ink-3">Refreshing results…</p>}
          {result.data.length ? <ul className="divide-y divide-slate-200/70">
            {result.data.map(row => <li key={row.id} className="min-w-0 space-y-1 py-3">
              <p className="break-words font-semibold text-ink">{row.title}</p>
              <p className="break-words text-sm text-ink-2">{row.detail}</p>
              <p className="break-words text-xs text-ink-3">{row.clientName ?? 'Client not recorded'}{row.status ? ` · ${row.status}` : ''}</p>
            </li>)}
          </ul> : <p className="text-sm text-ink-3">No matching {group.title.toLowerCase()}.</p>}
          <Link to={searchListLink(group, search)} className="focus-ring inline-block rounded text-sm font-semibold text-brand-700 underline">
            View all matching {group.title.toLowerCase()}
          </Link>
        </>}
    </section>
  </GlassPanel>;
}
