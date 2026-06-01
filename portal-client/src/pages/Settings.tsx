import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Bell, Users, CreditCard, Building2, ReceiptText, Store, Percent, Truck, AlertTriangle, BarChart3, Check, Search, ShieldCheck } from 'lucide-react';
import { GlassPanel, SectionTitle, Divider } from '@/components/ui/Glass';
import { TextInput, EmailInput, TextArea } from '@/components/ui/Inputs';
import { Button } from '@/components/ui/Button';
import { Avatar, Chip, SkeletonRows } from '@/components/ui/Display';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth';
import { useClients, useAccessList } from '@/lib/hooks';
import { BrandMark, resolveLogoKey } from '@/components/store/StoreLogo';
import { MarkupsEditor } from '@/components/MarkupsEditor';
import { ACCENTS, type Accent } from '@/lib/accents';
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

// Compact "last active" label for the access roster (e.g. "3d ago").
function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

type RoleFilter = 'all' | 'admin' | 'client' | 'global';

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
  const clients = useClients().data?.data ?? [];
  const accessList = useAccessList();
  const [tab, setTab] = useState<TabId>('profile');
  const savedProfile = loadJSON(LS_PROFILE, { name: '', bio: '' });
  const [name, setName] = useState(savedProfile.name || (authEmail ? authEmail.split('@')[0] : ''));
  const [email, setEmail] = useState(authEmail ?? '');
  const [bio, setBio] = useState(savedProfile.bio);
  const [notif, setNotif] = useState<NotifPrefs>(() => loadJSON(LS_NOTIF, NOTIF_DEFAULTS));
  const [accessSearch, setAccessSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const accessUsers = accessList.data?.data ?? [];

  // Roster roll-ups, computed once from the full (unfiltered) list.
  const adminCount = accessUsers.filter((u) => u.isAdmin).length;
  const globalCount = accessUsers.filter((u) => u.isGlobal).length;
  const clientCount = accessUsers.length - adminCount;
  const storesCovered = new Set(accessUsers.flatMap((u) => u.clients.map((c) => c.id))).size;

  const accessStats: { label: string; value: number; icon: typeof Users; accent: Accent }[] = [
    { label: 'Total logins', value: accessUsers.length, icon: Users, accent: 'indigo' },
    { label: 'Admins', value: adminCount, icon: ShieldCheck, accent: 'violet' },
    { label: 'Client users', value: clientCount, icon: User, accent: 'sky' },
    { label: 'Stores covered', value: storesCovered, icon: Store, accent: 'emerald' },
  ];
  const roleFilters: { id: RoleFilter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: accessUsers.length },
    { id: 'admin', label: 'Admins', count: adminCount },
    { id: 'client', label: 'Clients', count: clientCount },
    { id: 'global', label: 'Global', count: globalCount },
  ];

  const filteredAccessUsers = accessUsers.filter((user) => {
    if (roleFilter === 'admin' && !user.isAdmin) return false;
    if (roleFilter === 'client' && user.isAdmin) return false;
    if (roleFilter === 'global' && !user.isGlobal) return false;
    const needle = accessSearch.trim().toLowerCase();
    if (!needle) return true;
    return (
      user.email.toLowerCase().includes(needle) ||
      (user.role ?? '').toLowerCase().includes(needle) ||
      user.clients.some((client) => (client.name ?? '').toLowerCase().includes(needle))
    );
  });

  function saveProfile() {
    try {
      localStorage.setItem(LS_PROFILE, JSON.stringify({ name, bio }));
      toast.success('Profile saved', 'Your details are stored on this device.');
    } catch {
      toast.error("Couldn't save", 'Local storage is unavailable in this browser.');
    }
  }
  function saveNotif() {
    try {
      localStorage.setItem(LS_NOTIF, JSON.stringify(notif));
      toast.success('Preferences updated', 'Your notification choices are saved.');
    } catch {
      toast.error("Couldn't save", 'Local storage is unavailable in this browser.');
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

            {/* ACCESS - authoritative Supabase Auth roster mapped to real client rows. */}
            {tab === 'team' && (
              <div className="space-y-5">
                <SectionTitle title="Account access" subtitle="Emails and the client stores each login handles" />

                {/* Roster roll-up tiles */}
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {accessStats.map((s) => {
                    const a = ACCENTS[s.accent];
                    return (
                      <div key={s.label} className="flex items-center gap-3 rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
                        <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', a.bg, a.text)}>
                          <s.icon size={16} />
                        </span>
                        <div className="min-w-0">
                          <p className="text-xl font-semibold leading-none tabular-nums text-ink">{s.value}</p>
                          <p className="mt-1 truncate text-xs text-ink-3">{s.label}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Search + role segmented filter */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="w-full sm:max-w-xs">
                    <TextInput
                      value={accessSearch}
                      onChange={(e) => setAccessSearch(e.target.value)}
                      placeholder="Search email, role, or store"
                      icon={<Search size={16} />}
                      aria-label="Search access roster"
                    />
                  </div>
                  <div className="flex items-center gap-1 self-start overflow-x-auto rounded-glass-sm bg-white/60 p-1 ring-1 ring-slate-200/70 sm:self-auto">
                    {roleFilters.map((f) => {
                      const active = roleFilter === f.id;
                      return (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setRoleFilter(f.id)}
                          aria-pressed={active}
                          className={cn(
                            'focus-ring relative cursor-pointer whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                            active ? 'text-ink' : 'text-ink-3 hover:text-ink',
                          )}
                        >
                          {active && (
                            <motion.span
                              layoutId="access-filter-pill"
                              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                              className="absolute inset-0 rounded-md bg-white shadow-glass ring-1 ring-slate-200/70"
                            />
                          )}
                          <span className="relative z-10">{f.label}</span>
                          <span className={cn('relative z-10 ml-1.5 tabular-nums', active ? 'text-brand-600' : 'text-ink-3')}>{f.count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {accessList.isLoading && (
                  <SkeletonRows rows={4} className="rounded-glass-sm bg-white/60 p-4 ring-1 ring-slate-200/70" />
                )}
                {accessList.isError && (
                  <p className="rounded-glass-sm bg-rose-50 p-4 text-sm font-medium text-rose-700 ring-1 ring-rose-100">
                    Could not load the access roster.
                  </p>
                )}
                {!accessList.isLoading && !accessList.isError && filteredAccessUsers.length === 0 && (
                  <div className="flex flex-col items-center gap-2 rounded-glass-sm bg-white/60 px-6 py-10 text-center ring-1 ring-slate-200/70">
                    <span className="grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-ink-3"><Users size={20} /></span>
                    <p className="text-sm font-semibold text-ink">No matching logins</p>
                    <p className="text-xs text-ink-3">Try a different search term or role filter.</p>
                  </div>
                )}

                <div className="space-y-3">
                  {filteredAccessUsers.map((user) => {
                    const handledClients = user.clients;
                    const lastSeen = relativeTime(user.lastSignInAt);
                    return (
                      <motion.div
                        layout
                        key={user.id}
                        className="overflow-hidden rounded-glass-sm bg-white/65 ring-1 ring-slate-200/70 transition-shadow hover:shadow-glass"
                      >
                        {/* Identity header */}
                        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex min-w-0 items-center gap-3">
                            <Avatar name={user.email} size={42} />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-ink">{user.email}</p>
                              <p className="truncate text-xs text-ink-3">
                                {user.role ?? 'No role'}
                                {lastSeen ? ` · Active ${lastSeen}` : ' · Never signed in'}
                              </p>
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                            <Chip accent={user.isAdmin ? 'violet' : 'amber'} dot={false}>{user.isAdmin ? 'Admin' : 'Client user'}</Chip>
                            {user.isGlobal && <Chip accent="emerald" dot={false}>Global</Chip>}
                          </div>
                        </div>

                        {/* Stores footer */}
                        <div className="border-t border-slate-200/70 bg-slate-50/60 px-4 py-3">
                          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">
                            <Store size={13} /> Stores handled
                            <span className="rounded-full bg-slate-200/70 px-1.5 py-px text-[10px] tabular-nums text-ink-2">{handledClients.length}</span>
                          </p>
                          {handledClients.length === 0 ? (
                            <p className="text-xs text-ink-3">
                              No explicit stores assigned{user.isGlobal ? '; this login has global portal access.' : '.'}
                            </p>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {handledClients.map((client) => {
                                const platform = resolveLogoKey(null, client.name);
                                return (
                                  <div key={client.id} className="flex items-center gap-2.5 rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-slate-200/70">
                                    <BrandMark provider={null} label={client.name} name={client.name} size={26} />
                                    <div className="min-w-0">
                                      <p className="truncate text-xs font-semibold text-ink">{client.name ?? `Client ${client.id}`}</p>
                                      <p className="truncate text-[11px] capitalize text-ink-3">
                                        {platform !== 'custom' ? platform : 'Client'} · ID {client.id}
                                      </p>
                                    </div>
                                    <span className={cn('ml-1 inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold', client.active ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600')}>
                                      <span className={cn('h-1.5 w-1.5 rounded-full', client.active ? 'bg-emerald-500' : 'bg-amber-500')} />
                                      {client.active ? 'Live' : 'Off'}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
                <p className="text-xs text-ink-3">Loaded from Supabase Auth app metadata and real PrepShip client records.</p>
              </div>
            )}
            {/* BILLING - point at the real Invoices/Finance data instead of a
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
