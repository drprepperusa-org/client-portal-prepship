import { CheckCircle2, Unplug } from 'lucide-react';
import { safeDate } from '../../lib/api';
import type { CarrierAccount } from '../../types/portal';
import { findPlatform } from './storePlatforms';

export function StoreConnectionCard({
  account,
  busy,
  onEdit,
  onDisconnect,
}: {
  account: CarrierAccount;
  busy: boolean;
  onEdit: () => void;
  onDisconnect: () => void;
}) {
  const platform = findPlatform(account.provider);
  const name = account.label ?? platform.name;
  const identifier = account.accountIdentifier ?? account.account_identifier ?? 'Connected account';

  return (
    <div className="portal-store-card">
      <div className="portal-store-card-top">
        <div className={`portal-platform-logo portal-platform-${platform.logoClass}`}>
          <span>{platform.logoText}</span>
        </div>
        <span className="portal-status portal-status-connected">
          <CheckCircle2 size={14} /> Connected
        </span>
      </div>
      <h2>{name}</h2>
      <div className="portal-store-sub" title={identifier}>{identifier}</div>

      <div className="portal-store-stats">
        <div>
          <span>Provider</span>
          <strong>{platform.name}</strong>
        </div>
        <div>
          <span>Last Sync</span>
          <strong>Live</strong>
        </div>
        <div>
          <span>Connected</span>
          <strong>{safeDate(account.createdAt)}</strong>
        </div>
      </div>

      <div className="portal-store-actions">
        <button type="button" className="portal-store-secondary" disabled={busy} onClick={onEdit}>
          Reconfigure
        </button>
        <button type="button" className="portal-store-danger" disabled={busy} onClick={onDisconnect}>
          <Unplug size={16} /> {busy ? 'Working...' : 'Disconnect'}
        </button>
      </div>
    </div>
  );
}
