import { type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Store, Pencil, Trash2, UserX, UserCheck } from 'lucide-react';
import { Avatar, Chip } from '@/components/ui/Display';
import { BrandMark, resolveLogoKey } from '@/components/store/StoreLogo';
import type { PortalAccessUser } from '@/lib/api';
import { cn } from '@/lib/cn';

export type ConfirmKind = 'deactivate' | 'activate' | 'delete';

// Compact "last active" label for the access roster (e.g. "3d ago").
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

/* Color-coded icon-only action button used in the access roster. */
type IconTone = 'brand' | 'amber' | 'emerald' | 'rose';
const ICON_TONES: Record<IconTone, string> = {
  brand: 'text-brand-600 hover:bg-brand-50',
  amber: 'text-amber-600 hover:bg-amber-50',
  emerald: 'text-emerald-600 hover:bg-emerald-50',
  rose: 'text-rose-600 hover:bg-rose-50',
};
function IconBtn({ tone, label, onClick, disabled, children }: { tone: IconTone; label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'focus-ring grid h-8 w-8 cursor-pointer place-items-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:text-ink-3 disabled:opacity-40 disabled:hover:bg-transparent',
        ICON_TONES[tone],
      )}
    >
      {children}
    </button>
  );
}

/* One roster login: identity header + admin actions + handled-stores footer. */
export function AccessUserCard({
  user,
  isSelf,
  onEdit,
  onConfirm,
}: {
  user: PortalAccessUser;
  isSelf: boolean;
  onEdit: () => void;
  onConfirm: (kind: ConfirmKind) => void;
}) {
  const handledClients = user.clients;
  const lastSeen = relativeTime(user.lastSignInAt);
  // Why an action is blocked, surfaced as a tooltip + disabled state.
  const lockReason = user.isProtected ? 'Protected operator account' : isSelf ? 'This is your own login' : null;

  return (
    <motion.div layout className="rounded-glass-sm bg-white/65 ring-1 ring-slate-200/70 transition-shadow hover:shadow-glass">
      {/* Identity header */}
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={user.email} size={42} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{user.email}</p>
            <p className="truncate text-xs text-ink-3">
              {user.role ?? 'No role'}
              {lastSeen ? ` · Active ${lastSeen}` : ' · Never signed in'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          {user.active === false && <Chip accent="rose" dot>Deactivated</Chip>}
          <Chip accent={user.isAdmin ? 'violet' : 'amber'} dot={false}>{user.isAdmin ? 'Admin' : 'Client user'}</Chip>
          {user.isGlobal && <Chip accent="emerald" dot={false}>Global</Chip>}
          <div className="ml-1 flex items-center gap-0.5 border-l border-slate-200/70 pl-1.5">
            <IconBtn tone="brand" label="Edit access" onClick={onEdit}>
              <Pencil size={15} />
            </IconBtn>
            {user.active !== false ? (
              <IconBtn
                tone="amber"
                label={lockReason ? `Can't deactivate · ${lockReason}` : 'Deactivate login'}
                disabled={Boolean(lockReason)}
                onClick={() => onConfirm('deactivate')}
              >
                <UserX size={15} />
              </IconBtn>
            ) : (
              <IconBtn tone="emerald" label="Activate login" onClick={() => onConfirm('activate')}>
                <UserCheck size={15} />
              </IconBtn>
            )}
            <IconBtn
              tone="rose"
              label={lockReason ? `Can't delete · ${lockReason}` : 'Delete login'}
              disabled={Boolean(lockReason)}
              onClick={() => onConfirm('delete')}
            >
              <Trash2 size={15} />
            </IconBtn>
          </div>
        </div>
      </div>

      {/* Stores footer */}
      <div className="rounded-b-glass-sm border-t border-slate-200/70 bg-slate-50/60 px-4 py-3">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">
          <Store size={13} /> {user.isGlobal ? 'All stores · global access' : 'Stores handled'}
          <span className="rounded-full bg-slate-200/70 px-1.5 py-px text-[10px] tabular-nums text-ink-2">{handledClients.length}</span>
        </p>
        {handledClients.length === 0 ? (
          <p className="text-xs text-ink-3">
            No explicit stores assigned{user.isGlobal ? '; this login has global portal access.' : '.'}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {handledClients.map((client) => {
              const platform = resolveLogoKey(null, client.name);
              return (
                <div key={client.id} className="flex items-center gap-2.5 rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-slate-200/70">
                  <BrandMark provider={null} label={client.name} name={client.name} size={26} />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-ink">{client.name ?? `Client ${client.id}`}</p>
                    <p className="truncate text-[11px] capitalize text-ink-3">
                      {platform !== 'custom' ? platform : 'Client'} · ID {client.id}
                    </p>
                  </div>
                  <span className={cn('ml-1 inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold', client.active ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600')}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', client.active ? 'bg-emerald-500' : 'bg-amber-500')} />
                    {client.active ? 'Live' : 'Off'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
  );
}
