import { motion } from 'framer-motion';
import { Globe2, Pencil, Store, Trash2, UserCheck, UserX } from 'lucide-react';
import { Avatar, Chip } from '@/components/ui/Display';
import { Button } from '@/components/ui/Button';
import { BrandMark, resolveLogoKey } from '@/components/store/StoreLogo';
import type { PortalAccessUser } from '@/lib/api';
import { cn } from '@/lib/cn';

export type ConfirmKind = 'deactivate' | 'activate' | 'delete';

function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function AccessUserListItem({
  user,
  selected,
  onSelect,
}: {
  user: PortalAccessUser;
  selected: boolean;
  onSelect: () => void;
}) {
  const lastSeen = relativeTime(user.lastSignInAt);
  const storeNames = user.clients.map((client) => client.name?.trim() || `Client ${client.id}`);
  const storeLabel = user.isGlobal
    ? 'All stores'
    : storeNames.length === 0
      ? 'No stores assigned'
      : `${storeNames.slice(0, 2).join(', ')}${storeNames.length > 2 ? ` +${storeNames.length - 2} more` : ''}`;

  return (
    <motion.button
      layout
      type="button"
      aria-pressed={selected}
      aria-label={`View access for ${user.email}`}
      onClick={onSelect}
      className={cn(
        'focus-ring group relative flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors',
        selected ? 'bg-white shadow-glass ring-1 ring-slate-200/80' : 'hover:bg-white/65',
      )}
    >
      {selected && <span className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-brand-500" />}
      <Avatar name={user.email} size={38} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-ink">{user.email}</span>
          <span
            className={cn(
              'h-2 w-2 shrink-0 rounded-full',
              user.active === false ? 'bg-rose-400' : 'bg-emerald-500',
            )}
            aria-label={user.active === false ? 'Deactivated' : 'Active'}
          />
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-3">
          <span>{user.isAdmin ? 'Admin' : 'Client user'}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{lastSeen ? `Active ${lastSeen}` : 'Never signed in'}</span>
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs">
          <Store size={12} className="shrink-0 text-brand-600" />
          <span
            className={cn(
              'truncate font-medium',
              storeNames.length === 0 && !user.isGlobal ? 'text-amber-700' : 'text-ink-2',
            )}
            title={user.isGlobal ? 'All stores · global access' : storeNames.join(', ')}
          >
            {storeLabel}
          </span>
          {user.isGlobal && (
            <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-emerald-600">
              Global
            </span>
          )}
        </span>
      </span>
    </motion.button>
  );
}

export function AccessUserDetails({
  user,
  isSelf,
  canManageAdmins,
  onEdit,
  onConfirm,
}: {
  user: PortalAccessUser;
  isSelf: boolean;
  canManageAdmins: boolean;
  onEdit: () => void;
  onConfirm: (kind: ConfirmKind) => void;
}) {
  const handledClients = user.clients;
  const lastSeen = relativeTime(user.lastSignInAt);
  const adminLockReason = user.isAdmin && !canManageAdmins ? 'Global admin access required' : null;
  const destructiveLockReason = adminLockReason ?? (user.isProtected
    ? 'Protected operator account'
    : isSelf
      ? 'This is your own login'
      : null);

  return (
    <motion.div
      key={user.id}
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18 }}
      className="space-y-5"
    >
      <div className="flex flex-col gap-4 border-b border-slate-200/70 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={user.email} size={46} />
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-ink">{user.email}</p>
            <p className="truncate text-xs text-ink-3">{user.name?.trim() || 'Portal login'}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Chip accent={user.isAdmin ? 'violet' : 'amber'} dot={false}>
                {user.isAdmin ? 'Admin' : 'Client user'}
              </Chip>
              {user.isGlobal && <Chip accent="emerald" dot={false}>Global access</Chip>}
              {user.active === false && <Chip accent="rose" dot>Deactivated</Chip>}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<Pencil size={15} />}
            disabled={Boolean(adminLockReason)}
            title={adminLockReason ?? 'Edit role and store access'}
            onClick={onEdit}
          >
            Edit
          </Button>
          {user.active !== false ? (
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<UserX size={15} />}
              disabled={Boolean(destructiveLockReason)}
              title={destructiveLockReason ?? 'Deactivate this login'}
              className="text-amber-700 hover:bg-amber-50 hover:text-amber-800"
              onClick={() => onConfirm('deactivate')}
            >
              Deactivate
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<UserCheck size={15} />}
              disabled={Boolean(adminLockReason)}
              title={adminLockReason ?? 'Activate this login'}
              className="text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
              onClick={() => onConfirm('activate')}
            >
              Activate
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<Trash2 size={15} />}
            disabled={Boolean(destructiveLockReason)}
            title={destructiveLockReason ?? 'Delete this login'}
            className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            onClick={() => onConfirm('delete')}
          >
            Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <DetailFact
          label="Status"
          value={user.active === false ? 'Deactivated' : 'Active'}
          valueClassName={user.active === false ? 'text-rose-600' : 'text-emerald-700'}
        />
        <DetailFact label="Last activity" value={lastSeen ? `Active ${lastSeen}` : 'Never signed in'} />
        <DetailFact
          label="Access scope"
          value={user.isGlobal
            ? 'All stores'
            : `${handledClients.length} assigned ${handledClients.length === 1 ? 'store' : 'stores'}`}
        />
      </div>

      {user.isGlobal && (
        <div className="flex items-start gap-3 rounded-xl bg-emerald-50/70 p-3 text-emerald-800 ring-1 ring-emerald-200/80">
          <Globe2 size={17} className="mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-semibold">Global portal access</p>
            <p className="mt-0.5 text-xs text-emerald-700">This login can open every client store.</p>
          </div>
        </div>
      )}

      <section aria-labelledby={`stores-heading-${user.id}`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 id={`stores-heading-${user.id}`} className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Store size={15} className="text-brand-600" />
              Store access
            </h3>
            <p className="mt-0.5 text-xs text-ink-3">
              {user.isGlobal ? 'All client stores are included.' : 'Stores explicitly assigned to this login.'}
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold tabular-nums text-ink-2">
            {handledClients.length}
          </span>
        </div>

        {handledClients.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white/40 px-4 py-8 text-center">
            <p className="text-sm font-medium text-ink-2">No stores assigned</p>
            <p className="mt-1 text-xs text-ink-3">
              {user.isGlobal ? 'Explicit assignments are not required for global access.' : 'Use Edit to add store access.'}
            </p>
          </div>
        ) : (
          <div className="max-h-[360px] overflow-y-auto rounded-xl bg-slate-50/60 p-2 ring-1 ring-slate-200/70">
            <div className="grid gap-2 sm:grid-cols-2">
              {handledClients.map((client) => {
                const platform = resolveLogoKey(null, client.name);
                return (
                  <div key={client.id} className="flex min-w-0 items-center gap-2.5 rounded-lg bg-white px-3 py-2.5 ring-1 ring-slate-200/70">
                    <BrandMark provider={null} label={client.name} name={client.name} size={30} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-ink">{client.name ?? `Client ${client.id}`}</p>
                      <p className="truncate text-[11px] capitalize text-ink-3">
                        {platform !== 'custom' ? platform : 'Client'} · ID {client.id}
                      </p>
                    </div>
                    <span className={cn(
                      'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                      client.active ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700',
                    )}>
                      <span className={cn('h-1.5 w-1.5 rounded-full', client.active ? 'bg-emerald-500' : 'bg-amber-500')} />
                      {client.active ? 'Live' : 'Off'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </motion.div>
  );
}

function DetailFact({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-xl bg-white/55 px-3 py-2.5 ring-1 ring-slate-200/70">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">{label}</p>
      <p className={cn('mt-1 truncate text-xs font-semibold text-ink', valueClassName)}>{value}</p>
    </div>
  );
}
