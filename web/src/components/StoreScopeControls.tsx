import { Search, Store } from 'lucide-react';
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
  return 'default';
}

export function marketplaceInitial(name: string | null | undefined) {
  const normalized = String(name ?? '').toLowerCase();
  if (normalized.includes('walmart')) return 'W';
  if (normalized.includes('ebay')) return 'e';
  if (normalized.includes('heritage')) return 'H';
  return (name ?? 'S').slice(0, 1).toUpperCase();
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

export function StoreFilterBar({
  clients,
  value,
  onChange,
  search,
  onSearchChange,
  label = 'Store scope',
}: {
  clients: PortalClient[];
  value: StoreFilterValue;
  onChange: (value: StoreFilterValue) => void;
  search: string;
  onSearchChange: (value: string) => void;
  label?: string;
}) {
  return (
    <div className="portal-scope-toolbar">
      <div className="portal-scope-label">
        <Store size={15} />
        <span>{label}</span>
      </div>
      <div className="portal-scope-chips" role="group" aria-label="Store filter">
        <button type="button" className={value === 'all' ? 'active' : ''} onClick={() => onChange('all')}>
          All assigned
        </button>
        {clients.map((client) => (
          <button
            key={client.id ?? client.name}
            type="button"
            className={value === Number(client.id) ? 'active' : ''}
            onClick={() => client.id && onChange(Number(client.id))}
          >
            <StoreBadge name={client.name} compact />
          </button>
        ))}
      </div>
      <label className="portal-scope-search">
        <Search size={14} />
        <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search store, SKU, order..." />
      </label>
    </div>
  );
}
