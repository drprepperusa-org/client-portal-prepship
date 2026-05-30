import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Clock } from 'lucide-react';
import { GlassPanel, SectionTitle } from '@/components/ui/Glass';
import { Button } from '@/components/ui/Button';
import { QueryState } from '@/components/ui/QueryState';
import { useToast } from '@/components/ui/Toast';
import { useIntegrations } from '@/lib/hooks';
import type { PortalIntegration } from '@/lib/api';
import { StoreConnectModal, type ConnectDraft } from '@/components/store/StoreConnectModal';
import { StoreLogo } from '@/components/store/StoreLogo';
import { ConnectionCard } from '@/components/store/ConnectionCard';
import type { StorePlatform } from '@/data/storePlatforms';
import { staggerContainer, staggerItem } from '@/lib/motion';

interface PendingStore {
  id: string;
  platform: StorePlatform;
  storeName: string;
}

export default function Connections() {
  const query = useIntegrations();
  const toast = useToast();
  const rows: PortalIntegration[] = query.data?.data ?? [];
  const [modalOpen, setModalOpen] = useState(false);
  // Client-side pending connections. We deliberately do NOT fire a live
  // marketplace connection from the portal — credential provisioning is gated
  // server-side — so a newly submitted store shows as "Pending" until an
  // operator activates it. This keeps the UX real without prod side effects.
  const [pending, setPending] = useState<PendingStore[]>([]);

  function handleConnect(draft: ConnectDraft) {
    setPending((prev) => [
      { id: `${draft.platform.id}-${Date.now()}`, platform: draft.platform, storeName: draft.storeName },
      ...prev,
    ]);
    toast.success('Connection requested', `${draft.storeName} (${draft.platform.name}) is pending activation.`);
  }

  const isEmpty = rows.length === 0 && pending.length === 0;

  return (
    <div className="space-y-4">
      <GlassPanel className="flex flex-wrap items-center justify-between gap-3 p-4">
        <SectionTitle title="Connections" subtitle="Sales channels & carriers linked to your PrepShip account" />
        <Button leadingIcon={<Plus size={16} />} onClick={() => setModalOpen(true)}>
          Add store
        </Button>
      </GlassPanel>

      <GlassPanel className="p-2 sm:p-3">
        <QueryState
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          isEmpty={isEmpty}
          onRetry={() => query.refetch()}
          emptyTitle="No connections yet"
          emptyMessage="Click “Add store” to connect a sales channel or marketplace."
        >
          <motion.div variants={staggerContainer} initial="initial" animate="enter" className="grid grid-cols-1 gap-4 p-2 sm:grid-cols-2 xl:grid-cols-3">
            {/* Pending (client-side) connections — floating, no flip. */}
            {pending.map((p, i) => (
              <motion.div key={p.id} variants={staggerItem} style={{ perspective: 1400 }}>
                <motion.div
                  animate={{ y: [0, -6, 0] }}
                  transition={{ duration: 4 + (i % 5) * 0.5, repeat: Infinity, ease: 'easeInOut' }}
                  className="flex h-60 flex-col"
                >
                  <GlassPanel className="flex h-full flex-col p-5 ring-1 ring-amber-200/70">
                    <div className="flex items-start justify-between">
                      <StoreLogo platform={p.platform} size={48} />
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-600">
                        <Clock size={12} /> Pending
                      </span>
                    </div>
                    <h3 className="mt-4 font-display text-base font-semibold text-ink">{p.storeName}</h3>
                    <p className="text-sm text-ink-3">{p.platform.name}</p>
                    <p className="mt-auto flex items-center gap-1.5 text-xs text-ink-3"><Clock size={13} /> Awaiting activation</p>
                  </GlassPanel>
                </motion.div>
              </motion.div>
            ))}

            {/* Live connections — floating + click-to-flip detail. */}
            {rows.map((c, i) => (
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

      <StoreConnectModal open={modalOpen} onClose={() => setModalOpen(false)} onConnect={handleConnect} />
    </div>
  );
}
