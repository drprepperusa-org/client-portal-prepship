import type { PortalIntegrationListOptions } from '@client-portal-contracts/connections';
import { PORTAL_CONNECTION_STATUSES } from '@client-portal-contracts/connections';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Inputs';
import { inputClasses } from '@/components/ui/Field';
import { STORE_PLATFORMS } from '@/data/storePlatforms';
import { connectionStatusMeta } from '@/lib/connection-status';

export type ConnectionFilterValues = Omit<PortalIntegrationListOptions, 'clientId'>;

export function ConnectionFilters({ values, onChange, count, busy }: {
  values: ConnectionFilterValues;
  onChange: (value: ConnectionFilterValues) => void;
  count?: number;
  busy: boolean;
}) {
  return (
    <div className="space-y-3 p-3">
      <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_200px_220px_auto]">
        <TextInput label="Search stores" placeholder="Store name" maxLength={120}
          value={values.search ?? ''} onChange={(e) => onChange({ ...values, search: e.target.value })} />
        <label className="space-y-1 text-sm text-ink-2">
          <span>Platform</span>
          <select aria-label="Platform" className={inputClasses(false)} value={values.provider ?? ''}
            onChange={(e) => onChange({ ...values, provider: e.target.value || undefined })}>
            <option value="">All platforms</option>
            {STORE_PLATFORMS.map((platform) => <option key={platform.id} value={platform.id}>{platform.name}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm text-ink-2">
          <span>Connection status</span>
          <select aria-label="Connection status" className={inputClasses(false)} value={values.status ?? ''}
            onChange={(e) => onChange({ ...values, status: e.target.value as ConnectionFilterValues['status'] || undefined })}>
            <option value="">All statuses</option>
            <option value="attention">Needs attention</option>
            {PORTAL_CONNECTION_STATUSES.map((status) => <option key={status} value={status}>{connectionStatusMeta(status).label}</option>)}
          </select>
        </label>
        {Boolean(values.search || values.provider || values.status) && (
          <Button variant="secondary" onClick={() => onChange({})}>Clear filters</Button>
        )}
      </div>
      <p role="status" className="text-sm text-ink-3">
        {busy ? 'Loading connections…' : count == null ? 'Connections unavailable' : `${count} ${count === 1 ? 'connection' : 'connections'}`}
        {values.status === 'attention' ? ' · Pending approval, reconnect needed, or sync delayed.' : ''}
      </p>
    </div>
  );
}
