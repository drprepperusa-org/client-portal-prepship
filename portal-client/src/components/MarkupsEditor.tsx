import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Loader2, Check, Trash2 } from 'lucide-react';
import { CarrierBadge } from '@/components/store/CarrierBadge';
import { Skeleton } from '@/components/ui/Display';
import { useToast } from '@/components/ui/Toast';
import { useMarkups } from '@/lib/hooks';
import { useAuth } from '@/auth';
import { portalApi, type MarkupGroup } from '@/lib/api';
import { cn } from '@/lib/cn';

type Edit = { type: 'pct' | 'flat'; value: string };
type Status = 'saving' | 'saved' | 'error';

/** Per-carrier rate-markup editor (Settings → Markups), grouped by ShipStation
 *  account/client + direct accounts like v4. Auto-saves on blur / type change. */
export function MarkupsEditor() {
  const toast = useToast();
  const qc = useQueryClient();
  const { accessToken } = useAuth();
  const q = useMarkups();
  const groups = q.data?.groups ?? [];
  const markups = q.data?.markups ?? {};

  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [status, setStatus] = useState<Record<number, Status>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const rowVal = (id: number): Edit => {
    if (edits[id]) return edits[id];
    const m = markups[id];
    return m ? { type: m.type, value: String(m.value) } : { type: 'pct', value: '' };
  };
  const setRow = (id: number, patch: Partial<Edit>) => setEdits((e) => ({ ...e, [id]: { ...rowVal(id), ...patch } }));
  const clearEdit = (id: number) => setEdits((e) => { const n = { ...e }; delete n[id]; return n; });
  const flash = (id: number, s: Status) => {
    setStatus((st) => ({ ...st, [id]: s }));
    if (s === 'saved') window.setTimeout(() => setStatus((st) => { const n = { ...st }; delete n[id]; return n; }), 1500);
  };

  async function commit(id: number) {
    if (!accessToken || !edits[id]) return; // only when changed
    const v = rowVal(id);
    const num = Number(v.value) || 0;
    const wasActive = !!markups[id];
    flash(id, 'saving');
    try {
      if (num <= 0) {
        if (wasActive) await portalApi.setMarkup(accessToken, id, { value: null }); // clear
      } else {
        await portalApi.setMarkup(accessToken, id, { type: v.type, value: num });
      }
      await qc.invalidateQueries({ queryKey: ['markups'] });
      clearEdit(id);
      flash(id, 'saved');
    } catch (err) {
      flash(id, 'error');
      toast.error('Markup save failed', err instanceof Error ? err.message : 'Please try again.');
    }
  }

  async function remove(id: number) {
    if (!accessToken) return;
    flash(id, 'saving');
    try {
      await portalApi.setMarkup(accessToken, id, { value: null });
      await qc.invalidateQueries({ queryKey: ['markups'] });
      clearEdit(id);
      flash(id, 'saved');
    } catch (err) {
      flash(id, 'error');
      toast.error('Remove failed', err instanceof Error ? err.message : 'Please try again.');
    }
  }

  if (q.isLoading) return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-glass-sm" />)}</div>;
  if (q.isError) return <p className="text-sm text-ink-3">Couldn’t load markups. {q.error instanceof Error ? q.error.message : ''}</p>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-3">
        A markup is added to the carrier’s live rate to set your sell price.
        <span className="font-semibold"> %</span> = percent of the rate;
        <span className="font-semibold"> $</span> = flat amount.
        Applied to new quotes only — auto-saved on change.
      </p>

      {groups.map((g: MarkupGroup) => {
        const open = !collapsed[g.key];
        const carriers = g.carriers;
        return (
          <div key={g.key} className="overflow-hidden rounded-glass-sm ring-1 ring-slate-200/70">
            <button
              onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}
              className="focus-ring flex w-full items-center justify-between gap-3 bg-white/70 px-4 py-2.5 text-left transition-colors hover:bg-white"
            >
              <span className="flex items-center gap-2 text-sm font-bold text-ink">
                {open ? <ChevronDown size={15} className="text-ink-3" /> : <ChevronRight size={15} className="text-ink-3" />}
                {g.label}
              </span>
              <span className="text-xs text-ink-3">{carriers.length} carrier{carriers.length === 1 ? '' : 's'}</span>
            </button>

            {open && (
              <div className="divide-y divide-slate-100">
                {carriers.map((c) => {
                  const v = rowVal(c.id);
                  const n = Number(v.value) || 0;
                  const active = !!markups[c.id];
                  const st = status[c.id];
                  const effect = v.type === 'pct' ? `+${n}%` : `+$${n.toFixed(2)}`;
                  return (
                    <div key={c.id} className="flex items-center gap-4 bg-white/40 px-4 py-2.5">
                      <span className="grid w-[72px] shrink-0 place-items-center"><CarrierBadge code={c.carrierCode} /></span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{c.nickname}</p>
                      </div>

                      <select
                        value={v.type}
                        onChange={(e) => { setRow(c.id, { type: e.target.value as Edit['type'] }); }}
                        onBlur={() => commit(c.id)}
                        className="focus-ring h-9 w-16 cursor-pointer rounded-glass-sm border border-white/80 bg-white px-2 text-sm text-ink ring-1 ring-slate-200/70"
                      >
                        <option value="flat">$</option>
                        <option value="pct">%</option>
                      </select>

                      <input
                        type="number"
                        min={0}
                        step={v.type === 'pct' ? 1 : 0.01}
                        value={v.value}
                        onChange={(e) => setRow(c.id, { value: e.target.value })}
                        onBlur={() => commit(c.id)}
                        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                        placeholder="0"
                        className="focus-ring h-9 w-20 rounded-glass-sm border border-white/80 bg-white px-2 text-right text-sm text-ink ring-1 ring-slate-200/70 focus:bg-white"
                      />

                      <span className={cn('w-16 text-right text-sm font-semibold tnum', active || n > 0 ? 'text-emerald-600' : 'text-ink-3')}>{effect}</span>

                      <span className="grid w-5 shrink-0 place-items-center">
                        {st === 'saving' ? <Loader2 size={14} className="animate-spin text-brand-500" /> : st === 'saved' ? <Check size={14} className="text-emerald-600" /> : null}
                      </span>

                      {active ? (
                        <button onClick={() => remove(c.id)} aria-label="Remove markup" className="focus-ring grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-rose-50 hover:text-rose-500">
                          <Trash2 size={14} />
                        </button>
                      ) : (
                        <span className="w-7 shrink-0" />
                      )}
                    </div>
                  );
                })}
                {carriers.length === 0 && <p className="px-4 py-3 text-sm text-ink-3">No carriers in this account.</p>}
              </div>
            )}
          </div>
        );
      })}
      {groups.length === 0 && <p className="text-sm text-ink-3">No carrier accounts available.</p>}
    </div>
  );
}
