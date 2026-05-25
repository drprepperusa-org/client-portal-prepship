import { CheckCircle2, RotateCcw, Unplug } from 'lucide-react';
import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { safeDate } from '../../lib/api';
import type { CarrierAccount } from '../../types/portal';
import { StoreLogo } from './StoreLogo';
import { findConnectionPlatform } from './storePlatforms';

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
  const [flipped, setFlipped] = useState(false);
  const name = account.label ?? account.provider ?? 'Store connection';
  const platform = findConnectionPlatform(account.provider, name);
  const identifier = account.accountIdentifier ?? account.account_identifier ?? 'Connected account';
  const source = account.source ?? 'portal';
  const providerLabel = platform.name;

  function toggleCard() {
    setFlipped((value) => !value);
  }

  function stopCardToggle(event: MouseEvent<HTMLElement>) {
    event.stopPropagation();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleCard();
    }
  }

  return (
    <div
      className={`portal-store-card${flipped ? ' is-flipped' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`${name} connection card`}
      onClick={toggleCard}
      onKeyDown={onKeyDown}
    >
      <div className="portal-store-card-inner">
        <div className="portal-store-card-face portal-store-card-front">
          <div className="portal-store-card-top">
            <StoreLogo platform={platform} provider={account.provider} label={name} />
            <span className="portal-status portal-status-connected">
              <CheckCircle2 size={14} /> Connected
            </span>
          </div>
          <h2>{name}</h2>
          <div className="portal-store-sub" title={identifier}>{identifier}</div>

          <div className="portal-store-stats">
            <div>
              <span>Provider</span>
              <strong>{providerLabel}</strong>
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

          <div className="portal-store-actions" onClick={stopCardToggle}>
            <button type="button" className="portal-store-secondary" disabled={busy} onClick={onEdit}>
              Reconfigure
            </button>
            <button type="button" className="portal-store-danger" disabled={busy} onClick={onDisconnect}>
              <Unplug size={16} /> {busy ? 'Working...' : 'Disconnect'}
            </button>
          </div>
        </div>

        <div className="portal-store-card-face portal-store-card-back" aria-hidden={!flipped}>
          <div className="portal-store-card-top">
            <StoreLogo platform={platform} provider={account.provider} label={name} />
            <button
              type="button"
              className="portal-store-back-button"
              onClick={(event) => {
                stopCardToggle(event);
                toggleCard();
              }}
            >
              <RotateCcw size={16} />
            </button>
          </div>
          <h2>Connection details</h2>
          <div className="portal-store-back-grid">
            <div>
              <span>Account identifier</span>
              <strong>{identifier}</strong>
            </div>
            <div>
              <span>Provider</span>
              <strong>{providerLabel}</strong>
            </div>
            <div>
              <span>Source</span>
              <strong>{source}</strong>
            </div>
          </div>
          <div className="portal-store-actions" onClick={stopCardToggle}>
            <button type="button" className="portal-store-secondary" onClick={toggleCard}>
              Back
            </button>
            <button type="button" className="portal-store-danger" disabled={busy} onClick={onDisconnect}>
              <Unplug size={16} /> {busy ? 'Working...' : 'Disconnect'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
