import { useState } from 'react';
import { motion } from 'framer-motion';
import { Users, User, Store, Search, ShieldCheck, Trash2, UserX, UserCheck, UserPlus } from 'lucide-react';
import { SectionTitle } from '@/components/ui/Glass';
import { TextInput } from '@/components/ui/Inputs';
import { Button } from '@/components/ui/Button';
import { SkeletonRows } from '@/components/ui/Display';
import { QueryState } from '@/components/ui/QueryState';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth';
import { useClients, useAccessList, useMe } from '@/lib/hooks';
import { portalApi, type PortalAccessUser, type PortalClientRow } from '@/lib/api';
import { ACCENTS, type Accent } from '@/lib/accents';
import { cn } from '@/lib/cn';
import { AccessUserCard, type ConfirmKind } from './AccessUserCard';
import { AccessEditModal } from './AccessEditModal';
import { AccessInviteModal } from './AccessInviteModal';

type RoleFilter = 'all' | 'admin' | 'client' | 'global';

/* ACCESS - authoritative Supabase Auth roster mapped to real client rows. */
export function AccessTab() {
  const toast = useToast();
  const { accessToken, userId } = useAuth();
  const clientsQuery = useClients();
  const clients = clientsQuery.data?.data ?? [];
  const accessList = useAccessList();
  const canManageAdmins = useMe().data?.canManageAdmins ?? false;
  const [accessSearch, setAccessSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const accessUsers = accessList.data?.data ?? [];

  // Roster roll-ups, computed once from the full (unfiltered) list.
  const adminCount = accessUsers.filter((u) => u.isAdmin).length;
  const globalCount = accessUsers.filter((u) => u.isGlobal).length;
  const clientCount = accessUsers.length - adminCount;
  const storesCovered = new Set(accessUsers.flatMap((u) => u.clients.map((c) => c.id))).size;

  // Every client store known to the roster, deduped. A global admin's entry
  // carries the full list, so this is the complete set of stores — used as the
  // option source for the Edit-access picker so it always offers all clients,
  // not just whatever the viewer's own token scope returns from /clients.
  const allClientsById = new Map<number, PortalClientRow>();
  for (const u of accessUsers) for (const c of u.clients) if (!allClientsById.has(c.id)) allClientsById.set(c.id, c);
  const allClients = [...allClientsById.values()].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

  const accessStats: { label: string; value: number; icon: typeof Users; accent: Accent }[] = [
    { label: 'Total logins', value: accessUsers.length, icon: Users, accent: 'indigo' },
    ...(canManageAdmins ? [{ label: 'Admins', value: adminCount, icon: ShieldCheck, accent: 'violet' as const }] : []),
    { label: 'Client users', value: clientCount, icon: User, accent: 'sky' },
    { label: 'Stores covered', value: storesCovered, icon: Store, accent: 'emerald' },
  ];
  const roleFilters: { id: RoleFilter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: accessUsers.length },
    { id: 'client', label: 'Clients', count: clientCount },
    ...(canManageAdmins
      ? [
          { id: 'admin' as const, label: 'Admins', count: adminCount },
          { id: 'global' as const, label: 'Global', count: globalCount },
        ]
      : []),
  ];

  const filteredAccessUsers = accessUsers.filter((user) => {
    if (roleFilter === 'admin' && !user.isAdmin) return false;
    if (roleFilter === 'client' && user.isAdmin) return false;
    if (roleFilter === 'global' && !user.isGlobal) return false;
    const needle = accessSearch.trim().toLowerCase();
    if (!needle) return true;
    return (
      user.email.toLowerCase().includes(needle) ||
      (user.role ?? '').toLowerCase().includes(needle) ||
      user.clients.some((client) => (client.name ?? '').toLowerCase().includes(needle))
    );
  });

  // Admin actions on a login: a confirmation modal for deactivate/activate/delete,
  // and a richer edit modal for role/stores/name.
  const [confirm, setConfirm] = useState<{ kind: ConfirmKind; user: PortalAccessUser } | null>(null);
  const [editTarget, setEditTarget] = useState<PortalAccessUser | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function runConfirm() {
    if (!confirm || !accessToken) return;
    setBusy(true);
    try {
      if (confirm.kind === 'delete') {
        await portalApi.deleteAccessUser(accessToken, confirm.user.id);
        toast.success('Login deleted', `${confirm.user.email} no longer has portal access.`);
      } else {
        const active = confirm.kind === 'activate';
        await portalApi.updateAccessUser(accessToken, confirm.user.id, { active });
        toast.success(active ? 'Login activated' : 'Login deactivated', confirm.user.email);
      }
      await accessList.refetch();
      setConfirm(null);
    } catch (e) {
      toast.error('Action failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (accessList.isError || clientsQuery.isError) {
    return (
      <div className="space-y-5">
        <SectionTitle title="Account access" subtitle="Emails and the client stores each login handles" />
        <QueryState
          isLoading={false}
          isError
          onRetry={() => Promise.all([accessList.refetch(), clientsQuery.refetch()])}
        >
          <></>
        </QueryState>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Account access"
        subtitle="Emails and the client stores each login handles"
        right={
          <Button size="sm" leadingIcon={<UserPlus size={16} />} onClick={() => setInviteOpen(true)}>
            Invite User
          </Button>
        }
      />

      {/* Roster roll-up tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {accessStats.map((s) => {
          const a = ACCENTS[s.accent];
          return (
            <div key={s.label} className="flex items-center gap-3 rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
              <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', a.bg, a.text)}>
                <s.icon size={16} />
              </span>
              <div className="min-w-0">
                <p className="text-xl font-semibold leading-none tabular-nums text-ink">{s.value}</p>
                <p className="mt-1 truncate text-xs text-ink-3">{s.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Search + role segmented filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <TextInput
            value={accessSearch}
            onChange={(e) => setAccessSearch(e.target.value)}
            placeholder="Search email, role, or store"
            icon={<Search size={16} />}
            aria-label="Search access roster"
          />
        </div>
        <div className="flex items-center gap-1 self-start overflow-x-auto rounded-glass-sm bg-white/60 p-1 ring-1 ring-slate-200/70 sm:self-auto">
          {roleFilters.map((f) => {
            const active = roleFilter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setRoleFilter(f.id)}
                aria-pressed={active}
                className={cn(
                  'focus-ring relative cursor-pointer whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                  active ? 'text-ink' : 'text-ink-3 hover:text-ink',
                )}
              >
                {active && (
                  <motion.span
                    layoutId="access-filter-pill"
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    className="absolute inset-0 rounded-md bg-white shadow-glass ring-1 ring-slate-200/70"
                  />
                )}
                <span className="relative z-10">{f.label}</span>
                <span className={cn('relative z-10 ml-1.5 tabular-nums', active ? 'text-brand-600' : 'text-ink-3')}>{f.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {accessList.isLoading && (
        <SkeletonRows rows={4} className="rounded-glass-sm bg-white/60 p-4 ring-1 ring-slate-200/70" />
      )}
      {!accessList.isLoading && filteredAccessUsers.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-glass-sm bg-white/60 px-6 py-10 text-center ring-1 ring-slate-200/70">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-ink-3"><Users size={20} /></span>
          <p className="text-sm font-semibold text-ink">No matching logins</p>
          <p className="text-xs text-ink-3">Try a different search term or role filter.</p>
        </div>
      )}

      <div className="space-y-3">
        {filteredAccessUsers.map((user) => (
          <AccessUserCard
            key={user.id}
            user={user}
            isSelf={user.id === userId}
            canManageAdmins={canManageAdmins}
            onEdit={() => setEditTarget(user)}
            onConfirm={(kind) => setConfirm({ kind, user })}
          />
        ))}
      </div>
      <p className="text-xs text-ink-3">Loaded from Supabase Auth app metadata and real PrepShip client records.</p>

      {/* Confirm deactivate / activate / delete */}
      <Modal
        open={Boolean(confirm)}
        onClose={() => !busy && setConfirm(null)}
        title={confirm?.kind === 'delete' ? 'Delete login' : confirm?.kind === 'activate' ? 'Activate login' : 'Deactivate login'}
        maxWidth={460}
      >
        {confirm && (
          <div className="space-y-5">
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  'grid h-11 w-11 shrink-0 place-items-center rounded-xl',
                  confirm.kind === 'delete' ? 'bg-rose-50 text-rose-600' : confirm.kind === 'activate' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600',
                )}
              >
                {confirm.kind === 'delete' ? <Trash2 size={20} /> : confirm.kind === 'activate' ? <UserCheck size={20} /> : <UserX size={20} />}
              </span>
              <div className="min-w-0 space-y-1">
                <p className="truncate text-sm font-semibold text-ink">{confirm.user.email}</p>
                <p className="text-sm text-ink-3">
                  {confirm.kind === 'delete'
                    ? 'This permanently removes the login from the portal. This action cannot be undone.'
                    : confirm.kind === 'activate'
                      ? 'This login will be able to sign in to the portal again.'
                      : 'This login will be signed out and blocked from signing in until you reactivate it.'}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setConfirm(null)} disabled={busy}>
                Cancel
              </Button>
              <Button variant={confirm.kind === 'activate' ? 'primary' : 'danger'} size="sm" loading={busy} onClick={runConfirm}>
                {confirm.kind === 'delete' ? 'Delete login' : confirm.kind === 'activate' ? 'Activate' : 'Deactivate'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit role / assigned stores / display name */}
      {editTarget && (
        <AccessEditModal
          user={editTarget}
          clients={allClients.length ? allClients : clients}
          token={accessToken}
          canManageAdmins={canManageAdmins}
          onClose={() => setEditTarget(null)}
          onSaved={async () => {
            await accessList.refetch();
            setEditTarget(null);
          }}
        />
      )}
      {inviteOpen && (
        <AccessInviteModal
          clients={allClients.length ? allClients : clients}
          token={accessToken}
          canManageAdmins={canManageAdmins}
          onClose={() => setInviteOpen(false)}
          onInvited={async () => {
            await accessList.refetch();
          }}
        />
      )}
    </div>
  );
}
