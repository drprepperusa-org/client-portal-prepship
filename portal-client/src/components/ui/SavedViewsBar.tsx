import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/auth';
import { usePortalFilters } from '@/lib/portalContext';
import { MAX_SAVED_VIEWS, parseSavedFilters, readSavedViews, type SavedFilters, type SavedView } from '@/lib/saved-views';
import { Button } from './Button';
import { Modal } from './Modal';

type Props = { scopeClientId?: number; current: SavedFilters; onApply: (filters: SavedFilters) => void };

export function SavedViewsBar(props: Props) {
  const { userId } = useAuth();
  const { clientId: globalClientId } = usePortalFilters();
  const clientId = props.scopeClientId ?? globalClientId;
  if (!userId) return null;
  const storageKey = `portal-saved-views:v1:${JSON.stringify([userId, clientId ?? null, props.current.page])}`;
  return <ScopedSavedViews key={storageKey} {...props} storageKey={storageKey} />;
}

function ScopedSavedViews({ current, onApply, storageKey }: Props & { storageKey: string }) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [dialog, setDialog] = useState<'save' | 'manage' | null>(null);
  const [name, setName] = useState('');
  const [draft, setDraft] = useState(current);
  function refresh() {
    try { setViews(readSavedViews(storageKey, current.page)); setError(''); }
    catch { setViews([]); setError('Saved views could not be read. Check browser storage and retry.'); }
  }
  useEffect(() => {
    refresh();
    function changed(event: StorageEvent) {
      if (event.key === storageKey || event.key === null) refresh();
    }
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [storageKey, current.page]);

  function persist(update: (latest: SavedView[]) => SavedView[], success: string) {
    try {
      // Re-read before an explicit write so edits in another tab are preserved.
      const next = update(readSavedViews(storageKey, current.page));
      localStorage.setItem(storageKey, JSON.stringify({ version: 1, views: next }));
      setViews(next); setError(''); setMessage(success);
      return true;
    } catch (cause) {
      setMessage('');
      setError(cause instanceof ViewInputError ? cause.message : 'Changes were not saved. Check browser storage and retry.');
      return false;
    }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    const filters = parseSavedFilters(draft, current.page);
    const trimmed = name.trim();
    if (!filters || !trimmed || trimmed.length > 40) {
      setError('Use a name of 1–40 characters and search text of no more than 120 characters.'); return;
    }
    if (persist((latest) => {
      if (latest.length >= MAX_SAVED_VIEWS) throw new ViewInputError('You can save up to 20 views here. Remove one first.');
      if (latest.some((view) => view.name.toLowerCase() === trimmed.toLowerCase())) {
        throw new ViewInputError('A view with this name already exists. Choose another name.');
      }
      return [...latest, { id: crypto.randomUUID(), name: trimmed, filters }];
    }, `Saved “${trimmed}”.`)) setDialog(null);
  }
  function apply(id: string) {
    try {
      const latest = readSavedViews(storageKey, current.page);
      const selected = latest.find((view) => view.id === id);
      setViews(latest);
      if (!selected) { setError('This saved view was removed. Choose another view.'); return; }
      onApply(selected.filters);
      setError(''); setMessage(`Opened “${selected.name}”.`);
    } catch { setError('This saved view could not be opened. Check browser storage and retry.'); }
  }
  return <div className="space-y-2 border-t border-slate-200/70 pt-3">
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Open saved view" value="" onChange={(event) => apply(event.target.value)} disabled={!views.length}
        className="focus-ring h-11 min-w-0 max-w-full rounded-glass-sm bg-white/70 px-3 text-sm text-ink ring-1 ring-slate-200 sm:h-9 sm:max-w-xs">
        <option value="">{views.length ? 'Open saved view…' : 'No saved views yet'}</option>
        {views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
      </select>
      <Button size="sm" variant="secondary" onClick={() => { setDraft(current); setName(''); setMessage(''); setDialog('save'); }}>Save view</Button>
      {views.length > 0 && <Button size="sm" variant="ghost" onClick={() => setDialog('manage')}>Manage views</Button>}
      <span className="text-xs text-ink-3">Saved in this browser for your account and current client filter.</span>
    </div>
    {message && !dialog && <p role="status" className="text-xs text-ink-2">{message}</p>}
    {error && !dialog && <p role="alert" className="text-sm text-ink-2">{error} <button type="button" onClick={refresh}
      className="focus-ring rounded text-brand-700 underline">Retry saved views</button></p>}
    <Modal open={dialog !== null} onClose={() => setDialog(null)} title={dialog === 'manage' ? 'Manage saved views' : 'Save current view'}>
      {dialog === 'save' && <form onSubmit={save} className="space-y-4">
        <p className="text-sm text-ink-2">Save search, filters, sorting and rows per page. Opening a view starts on page 1.</p>
        {(current.page === 'shipments' || current.page === 'returns') && <p className="text-xs text-ink-3">
          Your current client and any order filter stay unchanged.
        </p>}
        <label className="block text-sm text-ink">View name
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} required
            className="focus-ring mt-1 h-11 w-full rounded-glass-sm bg-white/70 px-3 ring-1 ring-slate-200" />
        </label>
        {error && <p role="alert" className="text-sm text-ink-2">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
          <Button type="submit" disabled={!name.trim()}>Save</Button>
        </div>
      </form>}
      {dialog === 'manage' && <div className="space-y-3">
        {views.length === 0 && <p className="text-sm text-ink-2">No saved views.</p>}
        {views.map((view) => <div key={view.id} className="flex items-center justify-between gap-3">
          <span className="min-w-0 break-words text-sm text-ink">{view.name}</span>
          <Button size="sm" variant="ghost" aria-label={`Delete saved view ${view.name}`}
            onClick={() => persist((latest) => latest.filter((entry) => entry.id !== view.id), `Deleted “${view.name}”.`)}>Delete</Button>
        </div>)}
        {error && <p role="alert" className="text-sm text-ink-2">{error}</p>}
        {message && <p role="status" className="text-xs text-ink-2">{message}</p>}
      </div>}
    </Modal>
  </div>;
}

class ViewInputError extends Error {}
