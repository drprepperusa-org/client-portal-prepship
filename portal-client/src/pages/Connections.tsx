import { useState } from 'react';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Clock, Store } from 'lucide-react';
import { GlassPanel, SectionTitle } from '@/components/ui/Glass';
import { Button } from '@/components/ui/Button';
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

/** A store submitted from the portal awaiting operator promotion
 *  (source='portal'); everything else renders as a live connection. */
const isPending = (r: PortalIntegration) => r.type === 'store' && r.source === 'portal';

export default function Connections() {
  const query = useIntegrations();
  const toast = useToast();
  const qc = useQueryClient();
  const { accessToken } = useAuth();
  const isAdmin = useMe().data?.isAdmin ?? false;
  const rows: PortalIntegration[] = query.data?.data ?? [];
  const [modalOpen, setModalOpen] = useState(false);

  // Server-persisted pending connections: POST /integrations stores the request
  // (source='portal', inactive — no sync path uses it) and it stays visible
  // across reloads until an operator activates or removes it.
  const pending = rows.filter(isPending);
  const live = rows.filter((r) => !isPending(r));

  async function handleConnect(draft: ConnectDraft) {
    if (!accessToken) return;
    try {
      await portalApi.createIntegration(accessToken, {
        provider: draft.platform.id,
        label: draft.storeName,
        credentials: draft.values,
      });
      await qc.invalidateQueries({ queryKey: ['integrations'] });
      toast.success('Connection requested', `${draft.storeName} (${draft.platform.name}) is pending operator activation.`);
    } catch (err) {
      toast.error('Could not submit', err instanceof Error ? err.message : 'Please try again.');
    }
  }

  return (
    <div className="space-y-4">
      <GlassPanel className="flex flex-wrap items-center justify-between gap-3 p-4">
        <SectionTitle title="Connections" subtitle="Sales channels & carriers linked to your PrepShip account" />
        {isAdmin && (
          <Button leadingIcon={<Plus size={16} />} onClick={() => setModalOpen(true)}>
            Add store
          </Button>
        )}
      </GlassPanel>

      <GlassPanel className="p-2 sm:p-3">
        <QueryState
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          isEmpty={rows.length === 0}
          onRetry={() => query.refetch()}
          emptyTitle="No connections yet"
          emptyMessage={isAdmin ? 'Click “Add store” to connect a sales channel or marketplace.' : 'Your operator manages store and carrier connections.'}
        >
          <motion.div variants={staggerContainer} initial="initial" animate="enter" className="grid grid-cols-1 gap-4 p-2 sm:grid-cols-2 xl:grid-cols-3">
            {/* Pending (operator-gated) connections — floating, no flip. */}
            {pending.map((p, i) => {
              const platform = STORE_PLATFORMS.find((sp) => sp.id === p.provider);
              return (
                <motion.div key={p.id ?? `pending-${i}`} variants={staggerItem} style={{ perspective: 1400 }}>
                  <motion.div
                    animate={{ y: [0, -6, 0] }}
                    transition={{ duration: 4 + (i % 5) * 0.5, repeat: Infinity, ease: 'easeInOut' }}
                    className="flex h-60 flex-col"
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
                      <p className="mt-auto flex items-center gap-1.5 text-xs text-ink-3"><Clock size={13} /> Awaiting operator activation</p>
                    </GlassPanel>
                  </motion.div>
                </motion.div>
              );
            })}

            {/* Live connections — floating + click-to-flip detail. */}
            {live.map((c, i) => (
              <ConnectionCard
                key={c.id ?? `${c.type}-${i}`}
                integration={c}
                index={i + pending.length}
                onReconfigure={() => toast.info('Reconfigure', `Open the connector to update ${c.label ?? c.provider}.`)}
                onDisconnect={() => toast.warning('Disconnect gated', 'Disconnecting a live store requires operator approval.')}
              />
            ))}
          </motion.div>
        </QueryState>
      </GlassPanel>

      {isAdmin && <StoreConnectModal open={modalOpen} onClose={() => setModalOpen(false)} onConnect={handleConnect} />}
    </div>
  );
}
