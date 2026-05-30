import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Bell, Users, CreditCard, Building2, ReceiptText, Store } from 'lucide-react';
import { GlassPanel, SectionTitle, Divider } from '@/components/ui/Glass';
import { TextInput, EmailInput, TextArea } from '@/components/ui/Inputs';
import { Checkbox } from '@/components/ui/Selection';
import { Button } from '@/components/ui/Button';
import { Avatar, Chip } from '@/components/ui/Display';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth';
import { useMe, useClients } from '@/lib/hooks';
import { BrandMark, resolveLogoKey } from '@/components/store/StoreLogo';
import { cn } from '@/lib/cn';

const TABS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'team', label: 'Access', icon: Users },
  { id: 'billing', label: 'Billing', icon: CreditCard },
] as const;
type TabId = (typeof TABS)[number]['id'];

export default function Settings() {
  const toast = useToast();
  const { email: authEmail } = useAuth();
  const me = useMe();
  const clients = useClients().data?.data ?? [];
  const [tab, setTab] = useState<TabId>('profile');
  const [name, setName] = useState(authEmail ? authEmail.split('@')[0] : '');
  const [email, setEmail] = useState(authEmail ?? '');
  const [bio, setBio] = useState('');
  const [notif, setNotif] = useState({ ship: true, lowStock: true, invoice: true, weekly: false });

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
      {/* Tab rail */}
      <GlassPanel className="h-max p-2">
        <div className="flex gap-1 overflow-x-auto lg:flex-col">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} className={cn('focus-ring relative flex items-center gap-2.5 rounded-glass-sm px-3 py-2.5 text-sm font-medium transition-colors', active ? 'text-ink' : 'text-ink-2 hover:text-ink')}>
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
            {tab === 'profile' && (
              <div className="space-y-5">
                <SectionTitle title="Profile" subtitle="Update your personal details" />
                <div className="flex items-center gap-4">
                  <Avatar name={name || email || 'User'} size={64} />
                  <div className="flex flex-col gap-1.5">
                    <Button variant="secondary" size="sm">Change avatar</Button>
                    {me.data && (
                      <div className="flex flex-wrap gap-1.5">
                        {me.data.role && <Chip accent="indigo" dot={false}>{me.data.role}</Chip>}
                        <Chip accent={me.data.isGlobal ? 'emerald' : 'amber'} dot={false}>
                          {me.data.isGlobal ? 'Global access' : me.data.isRestricted ? 'Client-scoped' : 'Standard'}
                        </Chip>
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <TextInput label="Full name" value={name} onChange={(e) => setName(e.target.value)} />
                  <EmailInput label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <TextArea label="Bio" value={bio} onChange={(e) => setBio(e.target.value)} />
                <div className="flex justify-end"><Button onClick={() => toast.success('Profile saved')}>Save changes</Button></div>
              </div>
            )}

            {tab === 'notifications' && (
              <div className="space-y-5">
                <SectionTitle title="Notifications" subtitle="Choose what you want to hear about" />
                <div className="space-y-4">
                  <Checkbox label="Shipment status updates" checked={notif.ship} onChange={(v) => setNotif((n) => ({ ...n, ship: v }))} />
                  <Checkbox label="Low-stock alerts" checked={notif.lowStock} onChange={(v) => setNotif((n) => ({ ...n, lowStock: v }))} />
                  <Checkbox label="New invoice issued" checked={notif.invoice} onChange={(v) => setNotif((n) => ({ ...n, invoice: v }))} />
                  <Checkbox label="Weekly performance digest" checked={notif.weekly} onChange={(v) => setNotif((n) => ({ ...n, weekly: v }))} />
                </div>
                <Divider />
                <div className="flex justify-end"><Button onClick={() => toast.success('Preferences updated')}>Save preferences</Button></div>
              </div>
            )}

            {/* ACCESS — real signed-in user + real client accounts in scope.
                There is no portal-side user-invite endpoint (membership is
                operator-managed), so we show authoritative access data, not a
                fabricated team list. */}
            {tab === 'team' && (
              <div className="space-y-5">
                <SectionTitle title="Account access" subtitle="Who is signed in and which client accounts this login can see" />
                <div className="space-y-2">
                  <div className="flex items-center gap-3 rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
                    <Avatar name={authEmail ?? 'You'} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{authEmail ?? '—'}</p>
                      <p className="truncate text-xs text-ink-3">Signed in{me.data?.role ? ` · ${me.data.role}` : ''}</p>
                    </div>
                    <Chip accent={me.data?.isAdmin ? 'indigo' : 'amber'} dot={false}>{me.data?.isAdmin ? 'Admin' : 'Member'}</Chip>
                  </div>
                </div>

                <Divider />
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3"><Store size={13} /> Stores under this account ({clients.length})</p>
                <div className="space-y-2">
                  {clients.length === 0 && <p className="text-sm text-ink-3">No stores in scope.</p>}
                  {clients.map((c) => {
                    const platform = resolveLogoKey(null, c.name);
                    return (
                      <div key={c.id} className="flex items-center gap-3 rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
                        <BrandMark provider={null} label={c.name} name={c.name} size={40} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ink">{c.name ?? `Store ${c.id}`}</p>
                          <p className="truncate text-xs capitalize text-ink-3">{platform !== 'custom' ? platform : 'Store'}{c.email ? ` · ${c.email}` : ''}</p>
                        </div>
                        <Chip accent={c.active ? 'emerald' : 'amber'} dot={false}>{c.active ? 'Active' : 'Inactive'}</Chip>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-ink-3">Stores &amp; user access are managed by your PrepShip operator.</p>
              </div>
            )}

            {/* BILLING — point at the real Invoices/Finance data instead of a
                fabricated card + plan. Payment methods are operator-managed. */}
            {tab === 'billing' && (
              <div className="space-y-5">
                <SectionTitle title="Billing" subtitle="Your invoices and billed client accounts" />
                <div className="space-y-2">
                  {clients.length === 0 && <p className="text-sm text-ink-3">No billed accounts in scope.</p>}
                  {clients.map((c) => (
                    <div key={c.id} className="flex items-center gap-3 rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
                      <span className="grid h-10 w-10 place-items-center rounded-md bg-brand-50 text-brand-600"><Building2 size={18} /></span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink">{c.name ?? `Client ${c.id}`}</p>
                        <p className="truncate text-xs text-ink-3">Billed account</p>
                      </div>
                      <Chip accent={c.active ? 'emerald' : 'amber'} dot={false}>{c.active ? 'Active' : 'Inactive'}</Chip>
                    </div>
                  ))}
                </div>
                <Divider />
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-glass-sm bg-white/60 p-4 ring-1 ring-slate-200/70">
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-md bg-brand-50 text-brand-600"><ReceiptText size={18} /></span>
                    <div>
                      <p className="text-sm font-semibold text-ink">Invoices & charges</p>
                      <p className="text-xs text-ink-3">View your real billing detail and statements.</p>
                    </div>
                  </div>
                  <Link to="/invoices"><Button variant="secondary" size="sm">Open Invoices</Button></Link>
                </div>
                <p className="text-xs text-ink-3">Payment methods and plan terms are managed by your PrepShip operator.</p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </GlassPanel>
    </div>
  );
}
