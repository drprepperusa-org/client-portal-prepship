import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SectionTitle } from '@/components/ui/Glass';
import { TextInput } from '@/components/ui/Inputs';
import { Button } from '@/components/ui/Button';
import { QueryState } from '@/components/ui/QueryState';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth';
import { useAccessList, useMe } from '@/lib/hooks';
import { portalApi, type PortalAccessUser } from '@/lib/api';
import { RATE_SHEET_WRITE_PERMISSION } from '@client-portal-contracts/rate-sheet';
import { cn } from '@/lib/cn';

/** Display the canonical access roster; all grants go through the existing audited admin API. */
export function RateSheetTab() {
  const { accessToken } = useAuth();
  const canManageAdmins = useMe().data?.canManageAdmins ?? false;
  const accessList = useAccessList();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const needle = search.trim().toLowerCase();
  const users = (accessList.data?.data ?? []).filter((user) => !user.isAdmin && (
    !needle || user.email.toLowerCase().includes(needle)
    || (user.name ?? '').toLowerCase().includes(needle)
    || user.clients.some((client) => (client.name ?? '').toLowerCase().includes(needle))
  ));

  async function setPermission(user: PortalAccessUser, allowed: boolean) {
    if (!accessToken || !canManageAdmins || savingId) return;
    setSavingId(user.id);
    try {
      // Send only the grant intent: never replay stale roles or store assignments.
      await portalApi.updateAccessUser(accessToken, user.id, { canEditRateSheet: allowed });
      await accessList.refetch({ throwOnError: true });
      toast.success(allowed ? 'Rate sheet editing enabled' : 'Rate sheet editing disabled', user.email);
    } catch (error) {
      toast.error('Could not confirm permission', error instanceof Error ? error.message : 'Refresh the list and try again.');
    } finally {
      setSavingId(null);
    }
  }

  if (!canManageAdmins) return null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle title="Rate sheet permissions" subtitle="Choose which client accounts can add boxes and edit rates." />
        <Link to="/rates" className="focus-ring rounded-glass-sm px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50">View rate sheet</Link>
      </div>
      <p className="max-w-3xl text-sm text-ink-2">
        On allows editing service rates and box prices for the account’s assigned clients only. Off keeps the rate sheet view-only.
        Saved prices are shared by PrepShip and the Client Portal.
      </p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-full sm:max-w-sm">
          <TextInput label="Find a client account" placeholder="Search email, name or client" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <Button variant="secondary" size="sm" disabled={savingId !== null || accessList.isFetching} onClick={() => void accessList.refetch()}>Refresh permissions</Button>
      </div>
      <QueryState isLoading={accessList.isLoading} isError={accessList.isError} isUpdating={accessList.isFetching}
        isEmpty={users.length === 0} onRetry={() => void accessList.refetch()} emptyTitle="No client accounts found"
        emptyMessage="Try another email or client name." skeletonRows={4}>
        <ul aria-label="Client rate sheet permissions" className="divide-y divide-slate-200 overflow-hidden rounded-glass-sm border border-slate-200">
          {users.map((user) => {
            const enabled = user.permissions.includes(RATE_SHEET_WRITE_PERMISSION);
            const saving = savingId === user.id;
            return (
              <li key={user.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="break-all text-sm font-semibold text-ink">{user.email}</p>
                  <p className="mt-1 text-xs text-ink-2">{user.clients.map((client) => client.name ?? `Client ${client.id}`).join(', ') || 'No clients assigned'}</p>
                  {!user.active && <p className="mt-1 text-xs text-ink-3">Account inactive</p>}
                </div>
                <div className="flex items-center gap-3">
                  <span aria-live="polite" className="text-sm text-ink-2">{saving ? 'Saving…' : enabled ? 'On' : 'Off'}</span>
                  <button type="button" role="switch" aria-checked={enabled} aria-label={`Allow rate sheet editing for ${user.email}`}
                    disabled={savingId !== null || accessList.isFetching} onClick={() => void setPermission(user, !enabled)}
                    className={cn('focus-ring flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors disabled:cursor-wait disabled:opacity-50', enabled ? 'bg-brand-600' : 'bg-slate-300')}>
                    <span aria-hidden="true" className={cn('h-5 w-5 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none', enabled ? 'translate-x-5' : 'translate-x-0')} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </QueryState>
      <p className="text-xs text-ink-3">Changes save immediately. Admins already have editing access. This does not change existing invoice charges.</p>
    </div>
  );
}
