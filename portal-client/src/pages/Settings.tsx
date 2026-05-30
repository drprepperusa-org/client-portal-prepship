import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Bell, Users, CreditCard, Building2, ReceiptText, Store, Percent, Truck, AlertTriangle, BarChart3, Check } from 'lucide-react';
import { GlassPanel, SectionTitle, Divider } from '@/components/ui/Glass';
import { TextInput, EmailInput, TextArea } from '@/components/ui/Inputs';
import { Button } from '@/components/ui/Button';
import { Avatar, Chip } from '@/components/ui/Display';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth';
import { useMe, useClients } from '@/lib/hooks';
import { BrandMark, resolveLogoKey } from '@/components/store/StoreLogo';
import { MarkupsEditor } from '@/components/MarkupsEditor';
import { cn } from '@/lib/cn';

const TABS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'team', label: 'Access', icon: Users },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'markups', label: 'Markups', icon: Percent },
] as const;
type TabId = (typeof TABS)[number]['id'];

// Settings are user preferences with no operator-side endpoint, so we persist
// them to localStorage (per-browser, survives reloads).
const LS_PROFILE = 'prepship.settings.profile';
const LS_NOTIF = 'prepship.settings.notifications';
function loadJSON<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<T>) } : fallback;
  } catch {
    return fallback;
  }
}

type NotifPrefs = { ship: boolean; lowStock: boolean; invoice: boolean; weekly: boolean };
const NOTIF_DEFAULTS: NotifPrefs = { ship: true, lowStock: true, invoice: true, weekly: false };
const NOTIF_OPTS: { key: keyof NotifPrefs; icon: typeof Bell; title: string; desc: string }[] = [
  { key: 'ship', icon: Truck, title: 'Shipment status updates', desc: 'When a shipment is created, picked up, in transit, or delivered.' },
  { key: 'lowStock', icon: AlertTriangle, title: 'Low-stock alerts', desc: 'When an SKU drops below its reorder threshold.' },
  { key: 'invoice', icon: ReceiptText, title: 'New invoice issued', desc: 'When a new invoice or statement becomes available.' },
  { key: 'weekly', icon: BarChart3, title: 'Weekly performance digest', desc: 'A summary of orders, spend, and trends every Monday.' },
];

export default function Settings() {
  const toast = useToast();
  const { email: authEmail } = useAuth();
  const me = useMe();
  const clients = useClients().data?.data ?? [];
  const [tab, setTab] = useState<TabId>('profile');
  const savedProfile = loadJSON(LS_PROFILE, { name: '', bio: '' });
  const [name, setName] = useState(savedProfile.name || (authEmail ? authEmail.split('@')[0] : ''));
  const [email, setEmail] = useState(authEmail ?? '');
  const [bio, setBio] = useState(savedProfile.bio);
  const [notif, setNotif] = useState<NotifPrefs>(() => loadJSON(LS_NOTIF, NOTIF_DEFAULTS));

  function saveProfile() {
    try {
      localStorage.setItem(LS_PROFILE, JSON.stringify({ name, bio }));
      toast.success('Profile saved', 'Your details are stored on this device.');
    } catch {
      toast.error('Couldn’t save', 'Local storage is unavailable in this browser.');
    }
  }
  function saveNotif() {
    try {
      localStorage.setItem(LS_NOTIF, JSON.stringify(notif));
      toast.success('Preferences updated', 'Your notification choices are saved.');
    } catch {
      toast.error('Couldn’t save', 'Local storage is unavailable in this browser.');
    }
  }

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

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <TextInput label="Full name" value={name} onChange={(e) => setName(e.target.value)} />
                  <EmailInput label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <TextArea label="Bio" value={bio} onChange={(e) => setBio(e.target.value)} />
                <div className="flex justify-end"><Button onClick={saveProfile}>Save changes</Button></div>
              </div>
            )}

            {tab === 'notifications' && (
              <div className="space-y-5">
                <SectionTitle title="Notifications" subtitle="Choose what you want to hear about" />
                <div className="space-y-2.5">
                  {NOTIF_OPTS.map((o) => {
                    const on = notif[o.key];
                    return (
                      <button
                        key={o.key}
                        type="button"
                        role="switch"
                        aria-checked={on}
                        onClick={() => setNotif((n) => ({ ...n, [o.key]: !n[o.key] }))}
                        className={cn(
                          'focus-ring flex w-full items-center gap-3.5 rounded-glass-sm border p-3.5 text-left transition-colors',
                          on ? 'border-brand-200 bg-brand-50/50' : 'border-slate-200/70 bg-white/60 hover:bg-white',
                        )}
                      >
                        <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-lg transition-colors', on ? 'bg-brand-100 text-brand-600' : 'bg-slate-100 text-ink-3')}>
                          <o.icon size={18} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-ink">{o.title}</p>
                          <p className="text-xs text-ink-3">{o.desc}</p>
                        </div>
                        <span className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors', on ? 'bg-brand-500' : 'bg-slate-300')}>
                          <motion.span
                            initial={false}
                            animate={{ left: on ? 22 : 2 }}
                            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                            className="absolute top-0.5 grid h-5 w-5 place-items-center rounded-full bg-white shadow"
                          >
                            {on && <Check size={12} strokeWidth={3.5} className="text-brand-500" />}
                          </motion.span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <Divider />
                <div className="flex justify-end"><Button onClick={saveNotif}>Save preferences</Button></div>
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
