import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Search, Store } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { PortalClient } from '../types/portal';

export type StoreFilterValue = number | 'all';

export function clientIdOf(row: { clientId?: number | string | null; client_id?: number | string | null }) {
  const value = Number(row.clientId ?? row.client_id);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function storeNameForClient(clients: PortalClient[], clientId: number | null | undefined, fallback?: string | null) {
  if (clientId) {
    const match = clients.find((client) => Number(client.id) === clientId);
    if (match?.name) return match.name;
  }
  return fallback || (clientId ? `Client ${clientId}` : 'Unassigned store');
}

export function marketplaceTone(name: string | null | undefined) {
  const normalized = String(name ?? '').toLowerCase();
  if (normalized.includes('walmart')) return 'walmart';
  if (normalized.includes('ebay')) return 'ebay';
  if (normalized.includes('heritage')) return 'heritage';
  if (normalized.includes('shopify')) return 'shopify';
  return 'default';
}

export function marketplaceInitial(name: string | null | undefined) {
  const normalized = String(name ?? '').toLowerCase();
  if (normalized.includes('walmart')) return 'W';
  if (normalized.includes('ebay')) return 'e';
  if (normalized.includes('heritage')) return 'H';
  if (normalized.includes('shopify')) return 'S';
  return (name ?? 'S').slice(0, 1).toUpperCase();
}

function toneClasses(name: string | null | undefined, selected = false) {
  const tone = marketplaceTone(name);
  if (selected) return 'bg-brand text-white';
  if (tone === 'walmart') return 'bg-warn/10 text-warn ring-warn/25';
  if (tone === 'ebay') return 'bg-brand/10 text-brand ring-brand/20';
  if (tone === 'heritage') return 'bg-surface-2 text-ink-2 ring-line';
  if (tone === 'shopify') return 'bg-ok/10 text-ok ring-ok/20';
  return 'bg-surface text-ink-3 ring-line';
}

export function StoreBadge({ name, compact = false }: { name: string | null | undefined; compact?: boolean }) {
  const tone = marketplaceTone(name);
  return (
    <span className={`portal-store-badge portal-store-badge-${tone}${compact ? ' is-compact' : ''}`}>
      <i>{marketplaceInitial(name)}</i>
      <span>{name ?? 'Unassigned store'}</span>
    </span>
  );
}

function useClickOutside(ref: React.RefObject<HTMLElement>, handler: () => void) {
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        handler();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [ref, handler]);
}

export function StoreSelectorDropdown({
  clients,
  value,
  onChange,
  search,
  onSearchChange,
  label = 'Workspace',
}: {
  clients: PortalClient[];
  value: StoreFilterValue;
  onChange: (value: StoreFilterValue) => void;
  search: string;
  onSearchChange: (value: string) => void;
  label?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useClickOutside(dropdownRef, () => setIsOpen(false));

  useEffect(() => {
    if (!isOpen) return undefined;
    function onDocumentKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false);
    }
    document.addEventListener('keydown', onDocumentKeyDown);
    return () => document.removeEventListener('keydown', onDocumentKeyDown);
  }, [isOpen]);

  const activeClient = value !== 'all' ? clients.find((c) => Number(c.id) === value) : null;
  const activeLabel = activeClient ? activeClient.name : clients.length > 1 ? 'All Stores' : 'Assigned scope';
  const activeInitial = activeClient ? marketplaceInitial(activeLabel) : 'All';
  const activeState = activeClient?.active === false ? 'Inactive' : 'Active';

  const filteredClients = clients
    .filter((client) => !search || (client.name && client.name.toLowerCase().includes(search.toLowerCase())))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setIsOpen(true);
    }
    if (event.key === 'Escape') setIsOpen(false);
  }

  return (
    <div className="portal-store-selector relative z-50 flex items-center justify-between" ref={dropdownRef}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          onClick={() => setIsOpen((open) => !open)}
          onKeyDown={onTriggerKeyDown}
          className="group flex min-h-12 min-w-[250px] items-center gap-2 rounded-xl bg-white px-3 py-2 text-left shadow-sm ring-1 ring-inset ring-line transition-all hover:-translate-y-0.5 hover:bg-surface-2 hover:shadow-md hover:ring-line-2 active:translate-y-0 active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none"
        >
          <div className="flex items-center gap-2.5">
            <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[11px] font-black ring-1 ring-inset ${value === 'all' ? 'bg-brand/10 text-brand ring-brand/20' : toneClasses(activeLabel)}`}>
              {activeInitial}
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-widest text-ink-3 leading-none">{label}</div>
              <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px] font-bold text-ink leading-none">
                <span className="truncate">{activeLabel}</span>
                <span className={`h-1.5 w-1.5 rounded-full ${activeState === 'Active' ? 'bg-ok' : 'bg-ink-3'}`} aria-hidden />
                <ChevronDown size={14} className={`shrink-0 text-ink-3 transition-transform group-hover:text-ink ${isOpen ? 'rotate-180' : ''}`} />
              </div>
            </div>
          </div>
        </button>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 350, damping: 25 }}
            className="absolute left-0 top-full mt-2 w-[360px] max-w-[calc(100vw-2rem)] origin-top-left overflow-hidden rounded-xl bg-white/95 shadow-[0_24px_70px_rgba(15,23,42,.16)] ring-1 ring-black/5 backdrop-blur-xl"
            role="listbox"
            onKeyDown={(event) => {
              if (event.key === 'Escape') setIsOpen(false);
            }}
          >
            <div className="sticky top-0 z-10 border-b border-line bg-white/95 p-2 backdrop-blur-xl">
              <div className="relative flex items-center">
                <Search size={14} className="absolute left-3 text-ink-3" />
                <input
                  type="text"
                  placeholder="Search stores..."
                  value={search}
                  onChange={(e) => onSearchChange(e.target.value)}
                  className="w-full bg-transparent py-2 pl-9 pr-3 text-[13px] font-medium text-ink placeholder:text-ink-3 focus:outline-none"
                  autoFocus
                />
              </div>
            </div>
            <div className="max-h-[340px] overflow-y-auto p-1.5">
              <button
                type="button"
                role="option"
                aria-selected={value === 'all'}
                onClick={() => {
                  onChange('all');
                  setIsOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors ${value === 'all' ? 'bg-brand-bg text-brand' : 'text-ink hover:bg-surface-2'}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`grid h-9 w-9 place-items-center rounded-lg bg-brand/10 text-[11px] font-black ${value === 'all' ? 'text-brand' : 'text-ink-3'}`}>
                    <Store size={15} />
                  </div>
                  <div>
                    <span className="block text-[13px] font-bold">All Stores</span>
                    <span className="text-[11px] font-medium text-ink-3">{clients.length} assigned workspace{clients.length === 1 ? '' : 's'}</span>
                  </div>
                </div>
                {value === 'all' && <Check size={16} className="text-brand" />}
              </button>

              {filteredClients.length > 0 && (
                <div className="my-1.5 px-3 text-[10px] font-black uppercase tracking-widest text-ink-3">Available Stores</div>
              )}

              {filteredClients.map((client) => {
                const isSelected = value === Number(client.id);
                const t = marketplaceTone(client.name);
                const initial = marketplaceInitial(client.name);
                const state = client.active === false ? 'Inactive' : 'Active';

                return (
                  <button
                    key={client.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      if (client.id) {
                        onChange(Number(client.id));
                        setIsOpen(false);
                      }
                    }}
                    className={`group flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors ${isSelected ? 'bg-brand-bg text-brand' : 'text-ink hover:bg-surface-2'}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[11px] font-black ring-1 ring-inset transition-colors ${toneClasses(client.name, isSelected)}`}>
                        {initial}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-bold">{client.name}</div>
                        <div className="flex items-center gap-1.5 truncate text-[11px] font-medium text-ink-3 capitalize">
                          <span>{t === 'default' ? 'Custom Store' : t}</span>
                          <span className={`h-1.5 w-1.5 rounded-full ${state === 'Active' ? 'bg-ok' : 'bg-ink-3'}`} aria-hidden />
                          <span>{state}</span>
                        </div>
                      </div>
                    </div>
                    {isSelected && <Check size={16} className="text-brand shrink-0" />}
                  </button>
                );
              })}
              {filteredClients.length === 0 && search && (
                <div className="px-3 py-6 text-center text-[12px] font-medium text-ink-3">
                  No stores found matching "{search}"
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function StoreFilterBar(props: {
  clients: PortalClient[];
  value: StoreFilterValue;
  onChange: (value: StoreFilterValue) => void;
  search: string;
  onSearchChange: (value: string) => void;
  label?: string;
}) {
  return (
    <div className="portal-scope-toolbar">
      <StoreSelectorDropdown {...props} label={props.label ?? 'Store scope'} />
    </div>
  );
}
