import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Plus, Save, Search, X } from 'lucide-react';
import type {
  CarrierAccount,
  StoreConnectionDraft,
  StoreConnectionWizardStep,
  StorePlatform,
} from '../../types/portal';
import { findPlatform, storePlatformCategories, storePlatforms } from './storePlatforms';

function blankDraft(platform: StorePlatform, account?: CarrierAccount): StoreConnectionDraft {
  return {
    id: account?.id,
    platformId: platform.id,
    provider: platform.provider,
    label: account?.label ?? platform.name,
    accountIdentifier: account?.accountIdentifier ?? account?.account_identifier ?? '',
    credentials: Object.fromEntries(platform.credentialFields.map((field) => [field.key, ''])),
  };
}

export function StoreConnectionWizard({
  account,
  accounts,
  busy,
  error,
  onClose,
  onSave,
}: {
  account?: CarrierAccount | null;
  accounts: CarrierAccount[];
  busy: boolean;
  error?: string | null;
  onClose: () => void;
  onSave: (draft: StoreConnectionDraft) => void;
}) {
  const initialPlatform = findPlatform(account?.provider ?? 'walmart');
  const [step, setStep] = useState<StoreConnectionWizardStep>(account ? 'setup' : 'platforms');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<StoreConnectionDraft>(() => blankDraft(initialPlatform, account ?? undefined));
  const selectedPlatform = findPlatform(draft.platformId);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const connectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of accounts) {
      const provider = String(row.provider ?? '');
      counts.set(provider, (counts.get(provider) ?? 0) + 1);
    }
    return counts;
  }, [accounts]);

  const filteredPlatforms = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return storePlatforms;
    return storePlatforms.filter((platform) =>
      [platform.name, platform.description, platform.provider, platform.category]
        .join(' ')
        .toLowerCase()
        .includes(normalized),
    );
  }, [query]);

  function choosePlatform(platform: StorePlatform) {
    setDraft(blankDraft(platform));
    setStep('setup');
  }

  function updateCredentials(key: string, value: string) {
    setDraft((valueBefore) => ({
      ...valueBefore,
      credentials: { ...valueBefore.credentials, [key]: value },
    }));
  }

  function submitSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStep('review');
  }

  function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(draft);
  }

  return (
    <div className="portal-store-wizard-backdrop" role="dialog" aria-modal="true" aria-labelledby="store-wizard-title">
      <div className="portal-store-wizard">
        <button type="button" className="portal-store-wizard-close" aria-label="Close" onClick={onClose}>
          <X size={20} />
        </button>

        {step === 'platforms' ? (
          <>
            <div className="portal-store-wizard-head">
              <div className="portal-wizard-eyebrow">Connect a store</div>
              <h2 id="store-wizard-title">Where do your orders come from?</h2>
              <p>Select a platform and we'll walk you through connecting it in 2-5 minutes.</p>
              <label className="portal-platform-search">
                <Search size={19} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={`Search ${storePlatforms.length} supported platforms...`}
                  autoFocus
                />
              </label>
            </div>
            <div className="portal-platform-scroll">
              {storePlatformCategories.map((category) => {
                const rows = filteredPlatforms.filter((platform) => platform.category === category);
                if (rows.length === 0) return null;
                return (
                  <section className="portal-platform-section" key={category}>
                    <h3>{category}</h3>
                    <div className="portal-platform-grid">
                      {rows.map((platform) => (
                        <PlatformCard
                          key={platform.id}
                          platform={platform}
                          count={connectionCounts.get(platform.provider) ?? 0}
                          onChoose={() => choosePlatform(platform)}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
              {filteredPlatforms.length === 0 ? (
                <div className="portal-platform-empty">No platforms match that search.</div>
              ) : null}
            </div>
            <div className="portal-wizard-scroll-cue" />
          </>
        ) : null}

        {step === 'setup' ? (
          <form className="portal-setup-form" onSubmit={submitSetup}>
            <div className="portal-store-wizard-head compact">
              {!account ? (
                <button type="button" className="portal-wizard-back" onClick={() => setStep('platforms')}>
                  <ArrowLeft size={16} /> Platforms
                </button>
              ) : null}
              <div className="portal-wizard-eyebrow">Connect a store</div>
              <h2 id="store-wizard-title">{account ? `Reconfigure ${selectedPlatform.name}` : selectedPlatform.name}</h2>
              <p>Enter the credentials PrepShip should use for this store connection.</p>
            </div>
            <div className="portal-setup-body">
              <div className="portal-selected-platform">
                <div className={`portal-platform-logo portal-platform-${selectedPlatform.logoClass}`}>
                  <span>{selectedPlatform.logoText}</span>
                </div>
                <div>
                  <strong>{selectedPlatform.name}</strong>
                  <span>{selectedPlatform.description}</span>
                </div>
              </div>
              <label>
                Store name
                <input
                  value={draft.label}
                  onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                  required
                  placeholder={selectedPlatform.name}
                />
              </label>
              <label>
                {selectedPlatform.accountLabel}
                <input
                  value={draft.accountIdentifier}
                  onChange={(event) => setDraft({ ...draft, accountIdentifier: event.target.value })}
                  required
                  placeholder={selectedPlatform.accountPlaceholder}
                />
              </label>
              <div className="portal-form-grid">
                {selectedPlatform.credentialFields.map((field) => (
                  <label key={field.key}>
                    {field.label}
                    <input
                      type={field.type ?? 'text'}
                      value={draft.credentials[field.key] ?? ''}
                      onChange={(event) => updateCredentials(field.key, event.target.value)}
                      required={!account && field.required !== false}
                      placeholder={field.placeholder}
                    />
                  </label>
                ))}
              </div>
              {account ? (
                <div className="portal-wizard-note">
                  Existing connections update their display name through this portal. Credential rotation remains protected by backend permissions.
                </div>
              ) : null}
            </div>
            <div className="portal-wizard-actions">
              <button type="button" className="portal-store-secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="portal-modal-submit">Review connection</button>
            </div>
          </form>
        ) : null}

        {step === 'review' ? (
          <form className="portal-setup-form" onSubmit={submitReview}>
            <div className="portal-store-wizard-head compact">
              <button type="button" className="portal-wizard-back" onClick={() => setStep('setup')}>
                <ArrowLeft size={16} /> Back
              </button>
              <div className="portal-wizard-eyebrow">Review</div>
              <h2 id="store-wizard-title">Save this connection?</h2>
              <p>PrepShip will save this store connection under your permitted client scope.</p>
            </div>
            <div className="portal-review-box">
              <div className={`portal-platform-logo portal-platform-${selectedPlatform.logoClass}`}>
                <span>{selectedPlatform.logoText}</span>
              </div>
              <div>
                <strong>{draft.label}</strong>
                <span>{selectedPlatform.name}</span>
                <em>{draft.accountIdentifier}</em>
              </div>
              <CheckCircle2 size={20} />
            </div>
            {error ? <div className="portal-alert portal-alert-danger">{error}</div> : null}
            <div className="portal-wizard-actions">
              <button type="button" className="portal-store-secondary" onClick={() => setStep('setup')} disabled={busy}>Edit</button>
              <button type="submit" className="portal-modal-submit" disabled={busy}>
                <Save size={16} /> {busy ? 'Saving...' : 'Save connection'}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}

function PlatformCard({
  platform,
  count,
  onChoose,
}: {
  platform: StorePlatform;
  count: number;
  onChoose: () => void;
}) {
  return (
    <button type="button" className="portal-platform-card" onClick={onChoose}>
      <div className={`portal-platform-logo portal-platform-${platform.logoClass}`}>
        <span>{platform.logoText}</span>
      </div>
      <div className="portal-platform-copy">
        <strong>{platform.name}{count > 0 ? <small> - {count} already connected</small> : null}</strong>
        <span>{platform.description}</span>
      </div>
      <span className="portal-platform-add"><Plus size={19} /></span>
    </button>
  );
}
