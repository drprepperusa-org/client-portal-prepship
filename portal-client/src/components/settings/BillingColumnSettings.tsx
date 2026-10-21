import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BILLING_COLUMN_SECTIONS, type BillingColumnSettings as Settings, type BillingColumnUpdate } from '@client-portal-contracts/billing-columns';
import { useAuth } from '@/auth';
import { useBillingColumns } from '@/lib/hooks';
import { portalApi } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

function ColumnEditor({ saved, onSaved }: { saved: Settings; onSaved: () => Promise<void> }) {
  const { accessToken } = useAuth();
  const toast = useToast();
  const [draft, setDraft] = useState<BillingColumnUpdate>(() => ({
    summary: saved.summary, lineItems: saved.lineItems, revision: saved.revision,
  }));
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify([draft.summary, draft.lineItems]) !== JSON.stringify([saved.summary, saved.lineItems]);
  const conflict = draft.revision !== saved.revision;

  async function save() {
    if (!accessToken || saving) return;
    setSaving(true);
    try {
      const result = await portalApi.saveBillingColumns(accessToken, draft);
      setDraft({ summary: result.summary, lineItems: result.lineItems, revision: result.revision });
      await onSaved();
      toast.success('Billing columns saved', 'Client billing pages will use these columns.');
    } catch (error) {
      toast.error('Could not save billing columns', error instanceof Error ? error.message : 'Please try again.');
    } finally { setSaving(false); }
  }

  return (
    <section aria-label="Client-visible billing columns" className="space-y-4 rounded-glass-sm border border-slate-200 bg-white/60 p-4">
      <div>
        <h3 className="text-base font-bold text-ink">Client-visible billing columns</h3>
        <p className="mt-1 text-sm text-ink-3">Applies to all client accounts. Checked columns appear on client billing pages after saving. Billing amounts and downloaded invoices stay unchanged.</p>
      </div>
      {conflict && <p role="alert" className="text-sm text-amber-700">Another admin changed these settings. Use Reload saved settings before editing again.</p>}
      <div className="grid gap-5 lg:grid-cols-2">
        {(['summary', 'lineItems'] as const).map((section) => (
          <fieldset key={section} disabled={saving || conflict} className="min-w-0 space-y-1">
            <legend className="mb-2 text-sm font-semibold text-ink">{section === 'summary' ? 'Billing summary' : 'Billing line items'}</legend>
            {BILLING_COLUMN_SECTIONS[section].map((definition) => {
              const [key, label] = definition;
              const required = definition[2] === true;
              const checked = draft[section].includes(key);
              const active = saved[section].includes(key);
              return (
                <label key={key} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-slate-100">
                  <input type="checkbox" checked={checked} disabled={required} className="h-4 w-4 accent-brand-600"
                    onChange={(event) => setDraft((current) => ({ ...current,
                      [section]: event.target.checked ? [...current[section], key] : current[section].filter((id) => id !== key),
                    }))} />
                  <span className="flex-1 text-sm text-ink">{label}{required ? ' (required)' : ''}</span>
                  <span className={`text-xs font-medium ${active ? 'text-emerald-700' : 'text-ink-3'}`}>{active ? 'Visible to clients' : 'Hidden from clients'}</span>
                </label>
              );
            })}
          </fieldset>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
        <Button loading={saving} disabled={!dirty || conflict || !accessToken} onClick={save}>Save client-visible columns</Button>
        <Button variant="secondary" disabled={saving} onClick={() => setDraft({ summary: saved.summary, lineItems: saved.lineItems, revision: saved.revision })}>Reload saved settings</Button>
        <Button variant="secondary" disabled={saving || conflict} onClick={() => setDraft((current) => ({ ...current,
          summary: BILLING_COLUMN_SECTIONS.summary.map(([key]) => key),
          lineItems: BILLING_COLUMN_SECTIONS.lineItems.map(([key]) => key),
        }))}>Show all</Button>
        {dirty && <span role="status" className="text-xs text-amber-700">Unsaved changes</span>}
      </div>
    </section>
  );
}

export function BillingColumnSettings() {
  const query = useBillingColumns();
  const qc = useQueryClient();
  if (query.isPending) return <p role="status" className="text-sm text-ink-3">Loading client-visible billing columns…</p>;
  if (query.isError || !query.data) return <div role="alert"><p>Could not load billing column settings.</p><Button variant="secondary" onClick={() => query.refetch()}>Retry column settings</Button></div>;
  if (!query.data.canManage) return null;
  return <ColumnEditor saved={query.data} onSaved={async () => { await qc.invalidateQueries({ queryKey: ['billing-columns'] }); await query.refetch(); }} />;
}
