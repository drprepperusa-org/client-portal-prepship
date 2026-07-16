import { useState, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Bell, Menu, ChevronDown, Check, AlertTriangle } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePortalFilters } from '@/lib/portalContext';
import { useClients, useSyncStatus } from '@/lib/hooks';
import { shortDate } from '@/lib/status';
import { cn } from '@/lib/cn';
import { connectionFreshnessMeta } from '@/lib/connection-status';
import { DateRangeFilter } from './DateRangeFilter';
import { AccountMenu } from './AccountMenu';

export function Topbar({ title, onOpenMenu }: { title: string; onOpenMenu: () => void }) {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { clientId, setClientId } = usePortalFilters();
  const clientsQuery = useClients();
  const sync = useSyncStatus();
  const [bellOpen, setBellOpen] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);
  const [q, setQ] = useState('');

  const clients = clientsQuery.data?.data ?? [];
  const showClientSwitcher = clients.length > 1;
  const activeClientName = clientId ? clients.find((c) => c.id === clientId)?.name ?? 'Client' : 'All clients';
  const lastSync = sync.data?.lastSyncAt ?? null;
  const syncMeta = connectionFreshnessMeta(sync.data?.connectionStatus);
  const syncTimeCopy = sync.isError
    ? 'Connection freshness is unavailable.'
    : lastSync
      ? `Last synced ${shortDate(lastSync)}`
      : 'Awaiting first sync…';

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    // tab=all: a global search must span every order status — landing on the
    // default Awaiting tab hid shipped/cancelled matches and read as broken.
    if (q.trim()) nav(`/orders?q=${encodeURIComponent(q.trim())}&tab=all`);
  }

  return (
    <header className="glass-strong sticky top-0 z-30 flex items-center gap-2 rounded-glass px-3 py-2.5 sm:gap-3 sm:px-4">
      <button onClick={onOpenMenu} aria-label="Open menu" className="focus-ring grid h-10 w-10 cursor-pointer place-items-center rounded-glass-sm text-ink-2 transition-colors hover:bg-slate-100 lg:hidden">
        <Menu size={20} />
      </button>

      <h1 className="font-display text-lg font-bold tracking-tight text-ink sm:text-xl">{title}</h1>

      <div className="ml-auto flex items-center gap-2 sm:gap-2.5">
        {/* Search */}
        <form onSubmit={submitSearch} className="group relative hidden items-center md:flex">
          <Search size={16} className="absolute left-3 text-ink-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            type="search"
            placeholder="Search orders…"
            aria-label="Global search"
            className="focus-ring h-10 w-40 rounded-glass-sm border border-white/80 bg-white/60 pl-9 pr-3 text-sm text-ink ring-1 ring-slate-200/70 transition-all duration-300 placeholder:text-slate-400 focus:w-56 focus:bg-white/90"
          />
        </form>

        {/* Client switcher */}
        {clientsQuery.isError && (
          <button
            type="button"
            onClick={() => clientsQuery.refetch()}
            title="Client list unavailable — retry"
            aria-label="Client list unavailable. Retry."
            className="focus-ring grid h-10 w-10 place-items-center rounded-glass-sm bg-amber-50 text-amber-700 ring-1 ring-amber-200"
          >
            <AlertTriangle size={17} />
          </button>
        )}
        {showClientSwitcher && (
          <Dropdown
            open={clientOpen}
            setOpen={setClientOpen}
            label={activeClientName}
            items={[{ id: undefined as number | undefined, name: 'All clients' }, ...clients]}
            activeId={clientId}
            onPick={(id) => setClientId(id)}
          />
        )}

        {/* Date range */}
        {pathname !== '/inbound' && <DateRangeFilter />}

        {/* Notifications */}
        <div className="relative">
          <button onClick={() => setBellOpen((o) => !o)} aria-label="Notifications" className="focus-ring relative grid h-10 w-10 cursor-pointer place-items-center rounded-glass-sm text-ink-2 transition-colors hover:bg-slate-100">
            <Bell size={19} />
            <span className={cn('absolute right-2.5 top-2.5 h-2 w-2 rounded-full ring-2 ring-white', syncMeta.dotClassName)} />
          </button>
          <AnimatePresence>
            {bellOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setBellOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.98 }}
                  transition={{ duration: 0.16 }}
                  className="glass-strong absolute right-0 z-20 mt-2 w-[min(90vw,320px)] rounded-glass p-3 shadow-glass-lg"
                >
                  <p className="text-sm font-semibold text-ink">Sync status</p>
                  <p className="mt-1 text-[13px] text-ink-3">{syncTimeCopy}</p>
                  <p className="mt-2 text-[13px] text-ink-3">{syncMeta.label}</p>
                  {sync.isError && (
                    <button
                      type="button"
                      onClick={() => sync.refetch()}
                      className="focus-ring mt-3 rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-brand-700 ring-1 ring-slate-200"
                    >
                      Retry
                    </button>
                  )}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        {/* Account */}
        <AccountMenu />
      </div>
    </header>
  );
}

function Dropdown({
  open,
  setOpen,
  label,
  items,
  activeId,
  onPick,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  label: string;
  items: Array<{ id: number | undefined; name: string | null }>;
  activeId?: number;
  onPick: (id?: number) => void;
}) {
  return (
    <div className="relative hidden sm:block">
      <button
        onClick={() => setOpen(!open)}
        className="focus-ring flex h-10 max-w-[160px] cursor-pointer items-center gap-1.5 rounded-glass-sm border border-white/80 bg-white/60 px-3 text-sm text-ink-2 ring-1 ring-slate-200/70 transition-colors hover:bg-white/90"
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={15} className={cn('shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.14 }}
              className="glass-strong absolute right-0 z-20 mt-2 max-h-72 w-56 overflow-auto rounded-glass-sm p-1.5 shadow-glass-lg"
            >
              {items.map((c) => (
                <button
                  key={c.id ?? 'all'}
                  onClick={() => {
                    onPick(c.id);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                    c.id === activeId ? 'bg-brand-50 text-brand-700' : 'text-ink-2 hover:bg-slate-100',
                  )}
                >
                  <span className="truncate">{c.name ?? `Client #${c.id}`}</span>
                  {c.id === activeId && <Check size={15} className="shrink-0 text-brand-600" />}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
