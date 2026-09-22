import { useState, type FormEvent } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Search, Menu, ChevronDown, Check, AlertTriangle } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePortalFilters } from '@/lib/portalContext';
import { useClients } from '@/lib/hooks';
import { cn } from '@/lib/cn';
import { DateRangeFilter } from './DateRangeFilter';
import { AccountMenu } from './AccountMenu';
import { AttentionBell } from './AttentionBell';

export function Topbar({ title, onOpenMenu }: { title: string; onOpenMenu: () => void }) {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { clientId, setClientId } = usePortalFilters();
  const clientsQuery = useClients();
  const [clientOpen, setClientOpen] = useState(false);
  const [q, setQ] = useState('');

  const clients = clientsQuery.data?.data ?? [];
  const showClientSwitcher = clients.length > 1;
  const activeClientName = clientId ? clients.find((c) => c.id === clientId)?.name ?? 'Client' : 'All clients';

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim().slice(0, 120))}`);
  }

  return (
    <header className="glass-strong sticky top-0 z-30 flex flex-wrap items-center gap-2 rounded-glass px-3 py-2.5 sm:flex-nowrap sm:gap-3 sm:px-4">
      <button onClick={onOpenMenu} aria-label="Open menu" className="focus-ring grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-glass-sm text-ink-2 transition-colors hover:bg-slate-100 lg:hidden">
        <Menu size={20} />
      </button>

      <h1 className="min-w-0 flex-1 truncate font-display text-lg font-bold tracking-tight text-ink sm:flex-none sm:text-xl">{title}</h1>

      <div className="contents sm:ml-auto sm:flex sm:min-w-0 sm:items-center sm:gap-2.5">
        {/* Search */}
        <form onSubmit={submitSearch} className="group relative hidden items-center md:flex">
          <Search size={16} className="absolute left-3 text-ink-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            type="search"
            placeholder="Search portal…"
            maxLength={120}
            aria-label="Global search"
            className="focus-ring h-10 w-40 rounded-glass-sm border border-white/80 bg-white/60 pl-9 pr-3 text-sm text-ink ring-1 ring-slate-200/70 transition-all duration-300 placeholder:text-slate-400 focus:w-56 focus:bg-white/90"
          />
        </form>

        <button type="button" aria-label="Search portal" onClick={() => nav('/search')}
          className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-glass-sm text-ink-2 hover:bg-slate-100 md:hidden">
          <Search size={20} />
        </button>

        {(clientsQuery.isLoading || clientsQuery.isError || showClientSwitcher ||
          !['/inbound', '/audit-log', '/search'].includes(pathname)) && (
          <div role="group" aria-label="Portal filters" className="order-last flex w-full min-w-0 items-center gap-2 sm:order-none sm:w-auto">
            {/* Client switcher */}
            {clientsQuery.isLoading && <span role="status" className="text-xs text-ink-3">Loading clients…</span>}
            {clientsQuery.isError && (
              <button
                type="button"
                onClick={() => clientsQuery.refetch()}
                title="Client list unavailable — retry"
                aria-label="Client list unavailable. Retry."
                className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-glass-sm bg-amber-50 text-amber-700 ring-1 ring-amber-200"
              >
                <AlertTriangle size={17} />
              </button>
            )}
            {showClientSwitcher && !clientsQuery.isError && !clientsQuery.isLoading && (
              <ClientPicker
                open={clientOpen}
                setOpen={setClientOpen}
                label={activeClientName}
                items={[{ id: undefined as number | undefined, name: 'All clients' }, ...clients]}
                activeId={clientId}
                onPick={(id) => setClientId(id)}
              />
            )}

            {/* Date range */}
            {pathname !== '/inbound' && pathname !== '/audit-log' && pathname !== '/search' && <DateRangeFilter />}

          </div>)}

        <AttentionBell />

        {/* Account */}
        <AccountMenu />
      </div>
    </header>
  );
}

function ClientPicker({
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
    <div className="min-w-0 flex-1 sm:flex-none">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn('focus-ring flex h-11 w-full cursor-pointer items-center gap-1.5 rounded-glass-sm border border-white/80 bg-white/60 px-3',
          'text-sm text-ink-2 ring-1 ring-slate-200/70 transition-colors hover:bg-white/90 sm:h-10 sm:max-w-[160px]')}
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={15} className={cn('shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Select client" maxWidth={440}>
        <div className="space-y-1">
          {items.map((client) => (
            <button key={client.id ?? 'all'} type="button" aria-pressed={client.id === activeId}
              onClick={() => { onPick(client.id); setOpen(false); }}
              className={cn('focus-ring flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm',
                client.id === activeId ? 'bg-brand-50 text-brand-700' : 'text-ink-2 hover:bg-slate-100')}>
              <span className="min-w-0 break-words">{client.name ?? `Client #${client.id}`}</span>
              {client.id === activeId && <Check size={15} className="shrink-0 text-brand-600" />}
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
