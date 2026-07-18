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
import { AccessUserDetails, AccessUserListItem, type ConfirmKind } from './AccessUserCard';
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
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
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
  const selectedUser = filteredAccessUsers.find((user) => user.id === selectedUserId)
    ?? filteredAccessUsers[0]
    ?? null;

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
        subtitle="Manage who can sign in and which stores they can access"
        right={
          <Button size="sm" leadingIcon={<UserPlus size={16} />} onClick={() => setInviteOpen(true)}>
            Invite User
          </Button>
        }
      />

      <div className="grid grid-cols-2 overflow-hidden rounded-glass-sm bg-white/50 ring-1 ring-slate-200/70 md:grid-cols-4">
        {accessStats.map((s) => {
          const a = ACCENTS[s.accent];
          return (
            <div key={s.label} className="flex items-center gap-3 border-b border-r border-slate-200/70 p-3 last:border-r-0 md:border-b-0">
              <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', a.bg, a.text)}>
                <s.icon size={16} />
              </span>
              <div className="min-w-0">
                <p className="text-lg font-semibold leading-none tabular-nums text-ink">{s.value}</p>
                <p className="mt-1 truncate text-[11px] text-ink-3">{s.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid overflow-hidden rounded-glass-sm bg-white/45 ring-1 ring-slate-200/70 xl:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]">
        <section
          aria-label="Login accounts"
          className="border-b border-slate-200/70 bg-slate-50/45 xl:border-b-0 xl:border-r"
        >
          <div className="space-y-3 border-b border-slate-200/70 p-3">
            <TextInput
              value={accessSearch}
              onChange={(e) => setAccessSearch(e.target.value)}
              placeholder="Search logins or stores"
              icon={<Search size={16} />}
              aria-label="Search access roster"
            />
            <div className="flex items-center gap-1 overflow-x-auto">
              {roleFilters.map((f) => {
                const active = roleFilter === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setRoleFilter(f.id)}
                    aria-pressed={active}
                    className={cn(
                      'focus-ring relative cursor-pointer whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
                      active ? 'text-ink' : 'text-ink-3 hover:bg-white/70 hover:text-ink',
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="access-filter-pill"
                        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                        className="absolute inset-0 rounded-lg bg-white shadow-glass ring-1 ring-slate-200/70"
                      />
                    )}
                    <span className="relative z-10">{f.label}</span>
                    <span className={cn('relative z-10 ml-1.5 tabular-nums', active ? 'text-brand-600' : 'text-ink-3')}>
                      {f.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="max-h-[600px] space-y-1 overflow-y-auto p-2">
            {accessList.isLoading && <SkeletonRows rows={6} className="p-2" />}
            {!accessList.isLoading && filteredAccessUsers.length === 0 && (
              <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-ink-3">
                  <Users size={18} />
                </span>
                <p className="text-sm font-semibold text-ink">No matching logins</p>
                <p className="text-xs text-ink-3">Try a different search term or role filter.</p>
              </div>
            )}
            {!accessList.isLoading && filteredAccessUsers.map((user) => (
              <AccessUserListItem
                key={user.id}
                user={user}
                selected={selectedUser?.id === user.id}
                onSelect={() => setSelectedUserId(user.id)}
              />
            ))}
          </div>
        </section>

        <section aria-label="Selected login details" className="min-w-0 p-4 sm:p-5">
          {selectedUser ? (
            <AccessUserDetails
              user={selectedUser}
              isSelf={selectedUser.id === userId}
              canManageAdmins={canManageAdmins}
              onEdit={() => setEditTarget(selectedUser)}
              onConfirm={(kind) => setConfirm({ kind, user: selectedUser })}
            />
          ) : (
            <div className="grid min-h-60 place-items-center text-center">
              <div>
                <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-ink-3">
                  <User size={20} />
                </span>
                <p className="mt-3 text-sm font-semibold text-ink">Select a login</p>
                <p className="mt-1 text-xs text-ink-3">Choose a login to review its role and store access.</p>
              </div>
            </div>
          )}
        </section>
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
