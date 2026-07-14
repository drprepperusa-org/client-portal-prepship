import { useState } from 'react';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Plus, Clock, Store, Trash2 } from 'lucide-react';
import { GlassPanel, SectionTitle } from '@/components/ui/Glass';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { QueryState } from '@/components/ui/QueryState';
import { useToast } from '@/components/ui/Toast';
import { useIntegrations, useMe } from '@/lib/hooks';
import { useAuth } from '@/auth';
import { portalApi, type PortalIntegration } from '@/lib/api';
import { StoreConnectModal, type ConnectDraft } from '@/components/store/StoreConnectModal';
import { StoreLogo } from '@/components/store/StoreLogo';
import { ConnectionCard } from '@/components/store/ConnectionCard';
import { STORE_PLATFORMS } from '@/data/storePlatforms';
import { staggerContainer, staggerItem } from '@/lib/motion';
import { cn } from '@/lib/cn';
import { connectionStatusMeta, reconnectReasonCopy } from '@/lib/connection-status';

/** Backend owns pending/active/reconnect/degraded/inactive policy. */
const isPending = (row: PortalIntegration) => row.connectionStatus === 'pending';

export default function Connections() {
  const query = useIntegrations();
  const toast = useToast();
  const qc = useQueryClient();
  const { accessToken } = useAuth();
  const isAdmin = useMe().data?.isAdmin ?? false;
  const rows: PortalIntegration[] = query.data?.data ?? [];
  const [modalOpen, setModalOpen] = useState(false);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<number | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<PortalIntegration | null>(null);

  // Server-persisted pending connections: POST /integrations stores the request
  // (source='portal', inactive — no sync path uses it) and it stays visible
  // across reloads until an operator activates or removes it.
  const pending = rows.filter(isPending);
  const live = rows.filter((r) => !isPending(r) && r.type !== 'carrier');
  const visibleRows = [...pending, ...live];

  async function handleConnect(draft: ConnectDraft) {
    if (!accessToken) return;
    try {
      await portalApi.createIntegration(accessToken, {
        provider: draft.platform.id,
        label: draft.storeName,
        credentials: draft.values,
      });
      await qc.invalidateQueries({ queryKey: ['integrations'] });
      toast.success('Connection requested', `${draft.storeName} is connected and pending PrepShip approval.`);
    } catch (err) {
      toast.error('Could not submit', err instanceof Error ? err.message : 'Please try again.');
    }
  }

  /** Replace Shopify credentials/scopes for the same canonical shop. The
   *  backend re-verifies against the stored shop domain before clearing sync
   *  errors. */
  async function handleReconnect(id: number, credentials: Record<string, string>) {
    if (!accessToken) return;
    try {
      await portalApi.reconnectIntegration(accessToken, id, credentials);
      await qc.invalidateQueries({ queryKey: ['integrations'] });
      toast.success('Reconnected', 'Order sync will resume within a few minutes.');
    } catch (err) {
      toast.error('Could not reconnect', err instanceof Error ? err.message : 'Check the credentials and try again.');
    }
  }

  async function handleApprove(integration: PortalIntegration) {
    if (!accessToken || integration.id == null || approvingId != null) return;
    setApprovingId(integration.id);
    try {
      await portalApi.approveIntegration(accessToken, integration.id);
      await qc.invalidateQueries({ queryKey: ['integrations'] });
      toast.success('Connection approved', `${integration.label ?? integration.provider ?? 'Store'} is active and ready to sync.`);
    } catch (err) {
      toast.error('Approval failed', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setApprovingId(null);
    }
  }

  async function handleDisconnect() {
    const integration = disconnectTarget;
    if (!accessToken || !integration || integration.id == null || disconnectingId != null) return;
    setDisconnectingId(integration.id);
    try {
      await portalApi.disconnectIntegration(accessToken, integration.id);
      await qc.invalidateQueries({ queryKey: ['integrations'] });
      toast.success('Deleted', `${integration.label ?? integration.provider ?? 'Store'} has been deleted.`);
      setDisconnectTarget(null);
    } catch (err) {
      toast.error('Delete failed', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setDisconnectingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <GlassPanel className="flex flex-wrap items-center justify-between gap-3 p-4">
        <SectionTitle title="Connections" subtitle="Sales channels linked to your PrepShip account" />
        <Button leadingIcon={<Plus size={16} />} onClick={() => setModalOpen(true)}>
          Add store
        </Button>
      </GlassPanel>

      <GlassPanel className="p-2 sm:p-3">
        <QueryState
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          isEmpty={visibleRows.length === 0}
          onRetry={() => query.refetch()}
          emptyTitle="No connections yet"
          emptyMessage={isAdmin ? 'Click “Add store” to connect a sales channel or marketplace.' : 'Your operator manages sales channel connections.'}
        >
          <motion.div variants={staggerContainer} initial="initial" animate="enter" className="grid grid-cols-1 gap-4 p-2 sm:grid-cols-2 xl:grid-cols-3">
            {/* Pending (operator-gated) connections — floating, no flip. */}
            {pending.map((p, i) => {
              const platform = STORE_PLATFORMS.find((sp) => sp.id === p.provider);
              return (
                <motion.div key={p.id ?? `pending-${i}`} variants={staggerItem} style={{ perspective: 1400 }}>
                  <motion.div
                    animate={isAdmin ? undefined : { y: [0, -6, 0] }}
                    transition={isAdmin ? undefined : { duration: 4 + (i % 5) * 0.5, repeat: Infinity, ease: 'easeInOut' }}
                    className="flex h-64 flex-col"
                  >
                    <GlassPanel className="flex h-full flex-col p-5 ring-1 ring-amber-200/70">
                      <div className="flex items-start justify-between">
                        {platform ? (
                          <StoreLogo platform={platform} size={48} />
                        ) : (
                          <span className="grid h-12 w-12 place-items-center rounded-xl bg-amber-50 text-amber-600">
                            <Store size={22} />
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-600">
                          <Clock size={12} /> Pending
                        </span>
                      </div>
                      <h3 className="mt-4 font-display text-base font-semibold text-ink">{p.label ?? p.provider}</h3>
                      <p className="text-sm text-ink-3">{platform?.name ?? p.provider}</p>
                      {isAdmin && p.clientName ? <p className="text-xs text-ink-3">Client: {p.clientName}</p> : null}
                      <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
                        <p className="flex items-center gap-1.5 text-xs text-ink-3"><Clock size={13} /> Awaiting operator activation</p>
                        {isAdmin ? (
                          <Button
                            size="sm"
                            loading={approvingId === p.id}
                            disabled={approvingId != null || p.id == null}
                            leadingIcon={<CheckCircle2 size={14} />}
                            onClick={() => void handleApprove(p)}
                          >
                            Approve
                          </Button>
                        ) : null}
                      </div>
                    </GlassPanel>
                  </motion.div>
                </motion.div>
              );
            })}

            {/* Live connections — floating + click-to-flip detail. The status
                badge + reconnect form render alongside ConnectionCard, not
                inside it: the card is a self-contained absolute-positioned
                flip tile with no content slot to extend without editing that
                component (out of this task's file scope). */}
            {live.map((c, i) => {
              const badge = connectionStatusMeta(c.connectionStatus);
              const reconnectCopy = reconnectReasonCopy(c.reconnectReasonCode);
              return (
                <div key={c.id ?? `${c.type}-${i}`} className="flex flex-col gap-2">
                  <ConnectionCard
                    integration={c}
                    index={i + pending.length}
                    disconnecting={disconnectingId === c.id}
                    onReconfigure={() => toast.info('Reconfigure', `Open the connector to update ${c.label ?? c.provider}.`)}
                    onDisconnect={setDisconnectTarget}
                  />
                  {c.type === 'store' && (
                    <div className="px-1">
                      <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', badge.className)}>
                        {badge.label}
                      </span>
                      {reconnectCopy ? <p className="mt-1 text-xs text-ink-3">{reconnectCopy}</p> : null}
                      {c.connectionStatus === 'reconnect' && (
                        <ReconnectForm onSubmit={(credentials) => handleReconnect(c.id!, credentials)} />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </motion.div>
        </QueryState>
      </GlassPanel>

      <StoreConnectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onConnect={handleConnect}
        onValidate={async (draft) => {
          if (!accessToken) return { ok: false };
          try {
            const res = await portalApi.validateIntegration(accessToken, {
              provider: draft.platform.id,
              credentials: draft.values,
            });
            return res.data;
          } catch (err) {
            // fail() (portal-client/src/lib/api.ts) throws an Error whose
            // message is the backend's `error` string verbatim, so 429 and
            // missing-scope messages can surface directly in the modal.
            const rateLimited = err instanceof Error && err.message.includes('too many validation attempts');
            return { ok: false, rateLimited, message: err instanceof Error ? err.message : undefined };
          }
        }}
      />

      <Modal
        open={Boolean(disconnectTarget)}
        onClose={() => disconnectingId == null && setDisconnectTarget(null)}
        title="Delete connection"
        maxWidth={460}
      >
        {disconnectTarget && (
          <div className="space-y-5">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-600">
                <Trash2 size={20} />
              </span>
              <div className="min-w-0 space-y-1">
                <p className="truncate text-sm font-semibold text-ink">
                  {disconnectTarget.label ?? disconnectTarget.provider ?? 'Store connection'}
                </p>
                <p className="text-sm text-ink-3">
                  This deletes the store connection and stops future sync for this sales channel. Existing orders,
                  billing records, and audit history stay in PrepShip.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" disabled={disconnectingId != null} onClick={() => setDisconnectTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                loading={disconnectingId === disconnectTarget.id}
                leadingIcon={<Trash2 size={14} />}
                onClick={handleDisconnect}
              >
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Inline reconnect strip for a `reconnect`-status store card. Dev Dashboard
 *  apps reconnect with Client ID + Client secret; a legacy admin-created app
 *  reconnects by leaving Client ID blank and pasting its long-lived access
 *  token in the secret field. Rendered only when
 *  the backend returns `connectionStatus === 'reconnect'`. */
function ReconnectForm({ onSubmit }: { onSubmit: (credentials: Record<string, string>) => Promise<void> }) {
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const inputCls =
    'w-full rounded-glass-sm border border-white/80 bg-white/70 px-2.5 py-1.5 text-xs text-ink ring-1 ring-slate-200/70 backdrop-blur-sm placeholder:text-slate-400 focus:border-brand-400 focus:bg-white/90 focus:outline-none';
  return (
    <form
      className="mt-2 flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!secret.trim() || busy) return;
        setBusy(true);
        try {
          const id = clientId.trim();
          await onSubmit(
            id ? { clientId: id, clientSecret: secret.trim() } : { accessToken: secret.trim() },
          );
          setClientId('');
          setSecret('');
        } finally {
          setBusy(false);
        }
      }}
    >
      <input
        type="text"
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        placeholder="Client ID (blank if using a legacy access token)"
        aria-label="Client ID"
        className={inputCls}
      />
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="Client secret (or legacy access token)"
          aria-label="Client secret or legacy access token"
          className={inputCls}
        />
        <Button type="submit" size="sm" disabled={busy || !secret.trim()}>
          {busy ? 'Updating…' : 'Update'}
        </Button>
      </div>
    </form>
  );
}
