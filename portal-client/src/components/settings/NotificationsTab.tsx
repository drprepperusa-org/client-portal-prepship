import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth';
import { SectionTitle } from '@/components/ui/Glass';
import { Button } from '@/components/ui/Button';
import { QueryState } from '@/components/ui/QueryState';
import { useToast } from '@/components/ui/Toast';
import { useNotificationPreferences } from '@/lib/hooks';
import { portalApi } from '@/lib/api';
import { portalQueryKey } from '@/lib/query-keys';
import { cn } from '@/lib/cn';
import type { PortalNotificationPreferences } from '@client-portal-contracts/notification-preferences';

const options: { key: keyof PortalNotificationPreferences; title: string; description: string }[] = [
  { key: 'connectionIssues', title: 'Connection issues', description: 'Pending approval, reconnect needed, and sync delays.' },
  { key: 'lowStock', title: 'Low-stock alerts', description: 'Products at or below their reorder level, including out-of-stock products.' },
];

export function NotificationsTab() {
  const { userId } = useAuth();
  return <PreferencesForm key={userId ?? 'signed-out'} />;
}

function PreferencesForm() {
  const query = useNotificationPreferences();
  const { userId, accessToken } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<PortalNotificationPreferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const values = draft ?? query.data;
  const changed = values && query.data
    && (values.connectionIssues !== query.data.connectionIssues || values.lowStock !== query.data.lowStock);

  async function save() {
    if (!values || !accessToken || !userId || saving) return;
    setSaving(true); setSaveError(false);
    try {
      const saved = await portalApi.saveNotificationPreferences(accessToken, values);
      if (!mounted.current) return;
      await qc.cancelQueries({ queryKey: portalQueryKey(userId, ['notification-preferences']) });
      await qc.cancelQueries({ queryKey: ['attention'] });
      qc.setQueryData(portalQueryKey(userId, ['notification-preferences']), saved);
      setDraft(null);
      await qc.resetQueries({ queryKey: ['attention'] });
      if (mounted.current) toast.success('Preferences saved', 'Your notification choices are saved to your account.');
    } catch { if (mounted.current) setSaveError(true); }
    finally { if (mounted.current) setSaving(false); }
  }

  return <div className="space-y-5">
    <SectionTitle title="Notification settings" subtitle="Choose which alerts appear in your notification bell." />
    <p className="text-sm text-ink-3">Saved to your account across devices. These choices apply to all clients you can access.</p>
    <QueryState isLoading={query.isPending} isError={query.isError} onRetry={() => void query.refetch()} skeletonRows={2}>
      {values && <div className="space-y-4">
        {options.map(({ key, title, description }) => <button key={key} type="button" role="switch"
          aria-label={title} aria-checked={values[key]} disabled={saving}
          onClick={() => { setDraft({ ...values, [key]: !values[key] }); setSaveError(false); }}
          className={cn('focus-ring flex w-full items-center justify-between gap-4 rounded-glass-sm border p-4 text-left disabled:opacity-60',
            values[key] ? 'border-brand-200 bg-brand-50/50' : 'border-slate-200 bg-white/60')}>
          <span><span className="block text-sm font-semibold text-ink">{title}</span>
            <span className="block text-xs text-ink-3">{description}</span></span>
          <span className={cn('shrink-0 rounded-full px-3 py-1 text-xs font-semibold',
            values[key] ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-ink-3')}>{values[key] ? 'On' : 'Off'}</span>
        </button>)}
        {saveError && <p role="alert" className="text-sm text-rose-700">Could not save your preferences. Your changes are still here; please retry.</p>}
        <div className="flex justify-end"><Button onClick={() => void save()} disabled={!changed || saving}>
          {saving ? 'Saving…' : 'Save preferences'}
        </Button></div>
      </div>}
    </QueryState>
  </div>;
}
