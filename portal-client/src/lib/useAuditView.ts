import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigationType, useSearchParams } from 'react-router-dom';
import type { PortalAuditInvestigationFilters } from '@client-portal-contracts/access';

interface AuditView {
  search: string;
  storeId: number | null;
  clientId: number | null;
  actorEmail: string;
  page: number;
  filters: PortalAuditInvestigationFilters;
}

// URL values describe view intent only. The audit API still owns access and filtering.
function readView(params: URLSearchParams): { view: AuditView; invalid: boolean } {
  let invalid = false;
  function positiveInt(key: string, max: number, fallback: number | null) {
    const raw = params.get(key);
    if (!raw) return fallback;
    const value = Number(raw);
    if (/^\d+$/.test(raw) && Number.isSafeInteger(value) && value > 0 && value <= max) return value;
    invalid = true;
    return fallback;
  }
  function instant(key: string) {
    const raw = params.get(key);
    if (!raw) return undefined;
    const date = new Date(raw);
    if (/^\d{4}-\d{2}-\d{2}T/.test(raw) && Number.isFinite(date.getTime()) && date.toISOString() === raw) return raw;
    invalid = true;
    return undefined;
  }
  let dateFrom = instant('dateFrom');
  let dateTo = instant('dateTo');
  if (dateFrom && dateTo && dateFrom >= dateTo) {
    dateFrom = dateTo = undefined;
    invalid = true;
  }
  const activity = params.get('activity') || 'all';
  const validActivity = ['all', 'views', 'actions', 'navigation', 'failed', 'denied'].includes(activity);
  const hideBackground = params.get('hideBackground');
  if (!validActivity || (hideBackground && !['true', 'false'].includes(hideBackground))) invalid = true;
  const view: AuditView = {
    search: (params.get('search') ?? '').trim().slice(0, 120),
    clientId: positiveInt('clientId', 2_147_483_647, null),
    storeId: positiveInt('storeId', 2_147_483_647, null),
    actorEmail: (params.get('actorEmail') ?? '').trim(),
    page: positiveInt('page', 1_000_000, 1)!,
    filters: {
      dateFrom, dateTo,
      activity: validActivity ? activity as PortalAuditInvestigationFilters['activity'] : 'all',
      hideBackground: hideBackground === 'true',
    },
  };
  return { view, invalid };
}

function viewParams(view: AuditView) {
  const params = new URLSearchParams();
  if (view.search) params.set('search', view.search);
  if (view.clientId) params.set('clientId', String(view.clientId));
  if (view.storeId) params.set('storeId', String(view.storeId));
  if (view.actorEmail) params.set('actorEmail', view.actorEmail);
  if (view.page > 1) params.set('page', String(view.page));
  const { dateFrom, dateTo, activity, hideBackground } = view.filters;
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  if (activity && activity !== 'all') params.set('activity', activity);
  if (hideBackground) params.set('hideBackground', 'true');
  return params;
}

export function useAuditView() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const [params, setParams] = useSearchParams();
  const { view, invalid } = useMemo(() => readView(params), [params]);
  const [draft, setDraft] = useState({ key: location.key, search: view.search });
  const [dateHistoryKey, setDateHistoryKey] = useState(location.key);
  // Back/Forward discards unapplied date drafts, even when an intermediate
  // navigation was interrupted before React committed its date inputs.
  const dateDraftKey = navigationType === 'POP' ? location.key : dateHistoryKey;
  if (dateHistoryKey !== dateDraftKey) setDateHistoryKey(dateDraftKey);
  // A history navigation restores search immediately, before any request can run.
  if (draft.key !== location.key) setDraft({ key: location.key, search: view.search });
  const search = draft.key === location.key ? draft.search : view.search;
  const appliedSearch = search.trim().slice(0, 120);
  useEffect(() => {
    if (appliedSearch === view.search) return;
    const timer = window.setTimeout(() => {
      setParams(viewParams({ ...view, search: appliedSearch, page: 1 }));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [appliedSearch, view, location.key, setParams]);

  function update(patch: Partial<AuditView>) {
    const next = { ...view, search: appliedSearch, page: 1, ...patch };
    if (viewParams(next).toString() !== viewParams(view).toString()) setParams(viewParams(next));
    return next;
  }
  return {
    search, debouncedSearch: view.search, clientFilter: view.clientId, storeFilter: view.storeId, userFilter: view.actorEmail,
    page: view.page, filters: view.filters, invalid, dateDraftKey,
    setSearch: (value: string) => setDraft({ key: location.key, search: value }),
    setClientFilter: (clientId: number | null) => update({ clientId }),
    setStoreFilter: (storeId: number | null) => update({ storeId }),
    setUserFilter: (actorEmail: string) => update({ actorEmail }),
    setFilters: (filters: PortalAuditInvestigationFilters) => update({ filters }),
    setPage: (page: number) => update({ page: appliedSearch === view.search ? page : 1 }),
    searchPending: appliedSearch !== view.search,
    copyUrl: () => {
      const url = new URL('/audit-log', window.location.origin);
      // Allowlist view fields; never copy arbitrary query parameters or auth fragments.
      url.search = viewParams(view).toString();
      return url.href;
    },
  };
}
