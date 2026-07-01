import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Bell, Users, CreditCard, Percent } from 'lucide-react';
import { GlassPanel, SectionTitle } from '@/components/ui/Glass';
import { MarkupsEditor } from '@/components/MarkupsEditor';
import { ProfileTab } from '@/components/settings/ProfileTab';
import { NotificationsTab } from '@/components/settings/NotificationsTab';
import { AccessTab } from '@/components/settings/AccessTab';
import { BillingTab } from '@/components/settings/BillingTab';
import { cn } from '@/lib/cn';

const TABS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'team', label: 'Access', icon: Users },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'markups', label: 'Markups', icon: Percent },
] as const;
type TabId = (typeof TABS)[number]['id'];

export default function Settings() {
  const [tab, setTab] = useState<TabId>('profile');

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
      {/* Tab rail */}
      <GlassPanel className="h-max p-2">
        <div className="flex gap-1 overflow-x-auto lg:flex-col">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'focus-ring relative flex items-center gap-2.5 rounded-glass-sm px-3 py-2.5 text-sm font-medium transition-colors',
                  active ? 'text-ink' : 'text-ink-2 hover:text-ink',
                )}
              >
                {active && <motion.span layoutId="settings-pill" transition={{ type: 'spring', stiffness: 380, damping: 32 }} className="absolute inset-0 rounded-glass-sm bg-white/80 shadow-glass ring-1 ring-white/70" />}
                <t.icon size={17} className={cn('relative z-10', active ? 'text-brand-600' : 'text-ink-3')} />
                <span className="relative z-10 whitespace-nowrap">{t.label}</span>
              </button>
            );
          })}
        </div>
      </GlassPanel>

      {/* Panel */}
      <GlassPanel className="p-5 sm:p-6">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            {tab === 'profile' && <ProfileTab />}
            {tab === 'notifications' && <NotificationsTab />}
            {tab === 'team' && <AccessTab />}
            {tab === 'billing' && <BillingTab />}
            {tab === 'markups' && (
              <div className="space-y-5">
                <SectionTitle title="Carrier markups" subtitle="Per-carrier % or flat markup added to live rates (your profit layer)" />
                <MarkupsEditor />
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </GlassPanel>
    </div>
  );
}
