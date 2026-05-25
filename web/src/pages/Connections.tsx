import { useState } from 'react';
import { Plus } from 'lucide-react';
import { CardGridSkeleton, ErrorPanel, RefreshingNotice } from '../components/PortalPrimitives';
import { StoreConnectionCard } from '../components/store-connections/StoreConnectionCard';
import { StoreConnectionWizard } from '../components/store-connections/StoreConnectionWizard';
import { useAuth } from '../lib/auth';
import {
  useCarrierAccountsQuery,
  useDeleteCarrierAccountMutation,
  useSaveCarrierAccountMutation,
} from '../lib/portalQueries';
import type { CarrierAccount, StoreConnectionDraft } from '../types/portal';

export default function Connections() {
  const auth = useAuth();
  const accounts = useCarrierAccountsQuery(auth.accessToken);
  const saveAccount = useSaveCarrierAccountMutation(auth.accessToken);
  const deleteAccount = useDeleteCarrierAccountMutation(auth.accessToken);
  const [wizardAccount, setWizardAccount] = useState<CarrierAccount | null | undefined>(undefined);
  const [message, setMessage] = useState<string | null>(null);

  const visibleAccounts = (accounts.data?.data ?? []).filter((account) => account.active !== false);
  const isFirstLoad = accounts.isLoading && !accounts.data;

  function openAddWizard() {
    saveAccount.reset();
    setMessage(null);
    setWizardAccount(null);
  }

  function openEditWizard(account: CarrierAccount) {
    saveAccount.reset();
    setMessage(null);
    setWizardAccount(account);
  }

  async function saveDraft(draft: StoreConnectionDraft) {
    const credentials = Object.fromEntries(
      Object.entries(draft.credentials).filter(([, value]) => value.trim().length > 0),
    );
    await saveAccount.mutateAsync({
      id: draft.id,
      body: draft.id
        ? { label: draft.label.trim(), source: 'portal' }
        : {
            provider: draft.provider,
            label: draft.label.trim(),
            accountIdentifier: draft.accountIdentifier.trim(),
            source: 'portal',
            credentials,
          },
    });
    setWizardAccount(undefined);
    setMessage(draft.id ? 'Store connection updated.' : 'Store connection added.');
  }

  async function disconnect(account: CarrierAccount) {
    if (!account.id) return;
    const ok = window.confirm(`Disconnect ${account.label ?? account.provider ?? 'this store'}?`);
    if (!ok) return;
    setMessage(null);
    await deleteAccount.mutateAsync(account.id);
    setMessage('Store connection disconnected.');
  }

  return (
    <div className="portal-connections-page">
      <div className="portal-page-head">
        <div>
          <h1>Store Connections</h1>
          <p>Paste your store's API credentials and we'll handle the rest: orders and webhooks sync automatically.</p>
        </div>
        <button type="button" className="portal-add-store" onClick={openAddWizard}>
          <Plus size={20} /> Add store
        </button>
      </div>

      {accounts.error ? (
        <ErrorPanel
          message={accounts.error instanceof Error ? accounts.error.message : String(accounts.error)}
          loading={accounts.isFetching}
          onRetry={() => void accounts.refetch()}
        />
      ) : null}
      {deleteAccount.error ? (
        <ErrorPanel
          message={deleteAccount.error instanceof Error ? deleteAccount.error.message : String(deleteAccount.error)}
        />
      ) : null}
      {message ? <div className="portal-alert portal-alert-ok">{message}</div> : null}

      <section className="portal-connected-panel">
        <div className="portal-connected-head">
          <span>Connected ({visibleAccounts.length})</span>
          <RefreshingNotice show={accounts.isFetching && Boolean(accounts.data)} />
        </div>
        {isFirstLoad ? (
          <CardGridSkeleton count={4} />
        ) : (
          <div className="portal-store-grid">
            {visibleAccounts.map((account) => (
              <StoreConnectionCard
                key={account.id ?? `${account.provider}-${account.accountIdentifier}`}
                account={account}
                busy={deleteAccount.isPending && deleteAccount.variables === account.id}
                onEdit={() => openEditWizard(account)}
                onDisconnect={() => void disconnect(account)}
              />
            ))}
            {visibleAccounts.length === 0 ? (
              <div className="portal-empty-card">No connected stores yet. Use Add store to save a marketplace connection.</div>
            ) : null}
          </div>
        )}
      </section>

      {wizardAccount !== undefined ? (
        <StoreConnectionWizard
          account={wizardAccount}
          accounts={visibleAccounts}
          busy={saveAccount.isPending}
          error={saveAccount.error instanceof Error ? saveAccount.error.message : null}
          onClose={() => setWizardAccount(undefined)}
          onSave={(draft) => void saveDraft(draft)}
        />
      ) : null}
    </div>
  );
}
