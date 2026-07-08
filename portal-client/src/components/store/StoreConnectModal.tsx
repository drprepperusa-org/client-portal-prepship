import { useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowLeft, Plus, ShieldCheck, Eye, EyeOff, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { StoreLogo } from './StoreLogo';
import {
  STORE_PLATFORMS,
  STORE_PLATFORM_CATEGORIES,
  platformsByCategory,
  type StorePlatform,
  type StorePlatformCategory,
} from '@/data/storePlatforms';
import { cn } from '@/lib/cn';

export interface ConnectDraft {
  platform: StorePlatform;
  storeName: string;
  values: Record<string, string>;
}

type Filter = StorePlatformCategory | 'all';
type Stage = 'list' | 'creds' | 'review';

/** Two-stage store connector: discovery → credentials → review. */
export function StoreConnectModal({
  open,
  onClose,
  onConnect,
  onValidate,
}: {
  open: boolean;
  onClose: () => void;
  onConnect: (draft: ConnectDraft) => void;
  onValidate?: (draft: ConnectDraft) => Promise<{ ok: boolean; shopName?: string; myshopifyDomain?: string }>;
}) {
  const [stage, setStage] = useState<Stage>('list');
  const [filter, setFilter] = useState<Filter>('all');
  const [platform, setPlatform] = useState<StorePlatform | null>(null);
  const [storeName, setStoreName] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<{ ok: boolean; message: string } | null>(null);

  function reset() {
    setStage('list');
    setFilter('all');
    setPlatform(null);
    setStoreName('');
    setValues({});
    setErrors({});
    setShown({});
    setValidating(false);
    setValidation(null);
  }
  function close() {
    onClose();
    // Defer reset so the exit animation isn't disrupted.
    window.setTimeout(reset, 200);
  }

  function choose(p: StorePlatform) {
    setPlatform(p);
    setStoreName(p.name);
    setValues({});
    setErrors({});
    setValidation(null);
    setStage('creds');
  }

  function validate(): boolean {
    if (!platform) return false;
    const next: Record<string, string> = {};
    if (!storeName.trim()) next.__storeName = 'Store name is required';
    for (const f of platform.credentialFields) {
      if (f.required && !values[f.key]?.trim()) next[f.key] = `${f.label} is required`;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  /** Creds-stage form submit. For Shopify (with a live validator wired in)
   *  this checks the credentials against the real store before advancing to
   *  review, so a bad token/domain is caught immediately instead of after
   *  the operator reviews a submission that was never going to sync. Every
   *  other platform keeps the original synchronous validate-then-advance
   *  behavior unchanged. */
  async function submitCreds(e: FormEvent) {
    e.preventDefault();
    if (!validate() || !platform) return;
    if (platform.id === 'shopify' && onValidate) {
      setValidating(true);
      setValidation(null);
      try {
        const result = await onValidate({ platform, storeName, values });
        if (!result.ok) {
          setValidation({ ok: false, message: "Couldn't connect — check your shop domain and Admin API access token." });
          return;
        }
        setValidation({ ok: true, message: `Connected to ${result.myshopifyDomain ?? 'your store'} — pending PrepShip approval after submit.` });
        setStage('review');
      } finally {
        setValidating(false);
      }
      return;
    }
    setStage('review');
  }

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: STORE_PLATFORMS.length };
    for (const c of STORE_PLATFORM_CATEGORIES) map[c] = platformsByCategory(c).length;
    return map;
  }, []);

  const visible = platformsByCategory(filter);

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} className="fixed inset-0 z-[70] bg-ink/40 backdrop-blur-sm" />
          <div className="fixed inset-0 z-[71] grid place-items-center p-4" onClick={close}>
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 240, damping: 26 }}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'glass-strong relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-glass-lg',
                'shadow-glass-lg',
                stage === 'list' ? 'max-w-4xl' : 'max-w-lg',
              )}
              role="dialog"
              aria-modal="true"
              aria-label="Connect a store"
            >
              <button
                onClick={close}
                aria-label="Close"
                className={cn(
                  'focus-ring absolute right-4 top-4 z-10 grid h-9 w-9 cursor-pointer place-items-center',
                  'rounded-lg bg-white/80 text-ink-3 shadow-glass ring-1 ring-slate-200',
                  'transition-colors hover:text-ink',
                )}
              >
                <X size={18} />
              </button>

              {stage === 'list' ? (
                <ListStage filter={filter} setFilter={setFilter} counts={counts} visible={visible} onChoose={choose} />
              ) : stage === 'creds' && platform ? (
                <CredsStage
                  platform={platform}
                  storeName={storeName}
                  setStoreName={setStoreName}
                  values={values}
                  setValues={setValues}
                  errors={errors}
                  shown={shown}
                  setShown={setShown}
                  validating={validating}
                  validation={validation}
                  onBack={() => setStage('list')}
                  onCancel={close}
                  onReview={submitCreds}
                />
              ) : stage === 'review' && platform ? (
                <ReviewStage
                  platform={platform}
                  storeName={storeName}
                  values={values}
                  onBack={() => setStage('creds')}
                  onConfirm={() => {
                    onConnect({ platform, storeName: storeName.trim(), values });
                    close();
                  }}
                />
              ) : null}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ----------------------- Stage 1: discovery ----------------------- */
function ListStage({
  filter,
  setFilter,
  counts,
  visible,
  onChoose,
}: {
  filter: Filter;
  setFilter: (f: Filter) => void;
  counts: Record<string, number>;
  visible: StorePlatform[];
  onChoose: (p: StorePlatform) => void;
}) {
  const rail: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    ...STORE_PLATFORM_CATEGORIES.map((c) => ({ key: c as Filter, label: c })),
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
      {/* Category rail */}
      <aside className="shrink-0 border-b border-white/60 p-3 sm:w-52 sm:border-b-0 sm:border-r">
        <div className="flex gap-1.5 overflow-x-auto sm:flex-col">
          {rail.map((r) => (
            <button
              key={r.key}
              onClick={() => setFilter(r.key)}
              className={cn(
                'focus-ring flex cursor-pointer items-center justify-between gap-2 whitespace-nowrap rounded-glass-sm px-3 py-2 text-sm font-semibold transition-colors',
                filter === r.key ? 'bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-glass' : 'text-ink-2 hover:bg-slate-100',
              )}
            >
              {r.label}
              <span className={cn('rounded-full px-1.5 text-xs', filter === r.key ? 'bg-white/25' : 'bg-slate-200/70 text-ink-3')}>{counts[r.key]}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* Cards */}
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-3">Supported Platforms</p>
          <span className="text-xs text-ink-3">{visible.length}</span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {visible.map((p) => (
            <div key={p.id} className="glass flex flex-col rounded-glass-sm p-4 ring-1 ring-white/60 transition-shadow hover:shadow-glass">
              <div className="flex items-start gap-3">
                <StoreLogo platform={p} />
                <div className="min-w-0 flex-1">
                  <h3 className="font-display text-[15px] font-bold text-ink">{p.name}</h3>
                  <p className="mt-0.5 text-[13px] leading-snug text-ink-3">{p.description}</p>
                  <p className="mt-1 text-xs text-ink-3/80">
                    {p.credentialFields.length} required field{p.credentialFields.length === 1 ? '' : 's'}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-ink-3">{p.category}</span>
                <Button size="sm" variant="secondary" leadingIcon={<Plus size={15} />} onClick={() => onChoose(p)}>
                  Connect
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ----------------------- Stage 2: credentials ----------------------- */
function CredsStage({
  platform,
  storeName,
  setStoreName,
  values,
  setValues,
  errors,
  shown,
  setShown,
  validating,
  validation,
  onBack,
  onCancel,
  onReview,
}: {
  platform: StorePlatform;
  storeName: string;
  setStoreName: (v: string) => void;
  values: Record<string, string>;
  setValues: (v: Record<string, string>) => void;
  errors: Record<string, string>;
  shown: Record<string, boolean>;
  setShown: (v: Record<string, boolean>) => void;
  validating: boolean;
  validation: { ok: boolean; message: string } | null;
  onBack: () => void;
  onCancel: () => void;
  onReview: (e: FormEvent) => void;
}) {
  function toggleShown(key: string, reveal: boolean) {
    setShown({ ...shown, [key]: !reveal });
  }

  return (
    <form onSubmit={onReview} className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-white/60 p-5">
        <button type="button" onClick={onBack} className="focus-ring -ml-1 inline-flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 text-sm font-medium text-ink-3 transition-colors hover:text-brand-600">
          <ArrowLeft size={15} /> Platforms
        </button>
        <p className="mt-2 text-xs font-bold uppercase tracking-wider text-brand-600">Connect a store</p>
        <h2 className="font-display text-2xl font-bold tracking-tight text-ink">{platform.name}</h2>
        <p className="mt-0.5 text-sm text-ink-3">Enter the credentials PrepShip should use for this store connection.</p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        <div className="flex items-center gap-3 rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
          <StoreLogo platform={platform} />
          <div>
            <p className="text-sm font-bold text-ink">{platform.name}</p>
            <p className="text-xs text-ink-3">{platform.description}</p>
          </div>
        </div>

        <Field label="Store name" error={errors.__storeName}>
          <input value={storeName} onChange={(e) => setStoreName(e.target.value)} className={inputCls(Boolean(errors.__storeName))} placeholder={platform.name} />
        </Field>

        {platform.id === 'shopify' && (
          <div className="rounded-glass-sm bg-brand-50/70 p-3 text-xs leading-relaxed text-ink-3">
            <p className="font-semibold text-ink">How to get your app credentials</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4">
              <li>Go to <span className="font-medium text-ink-2">dev.shopify.com</span> and sign in with your store's account</li>
              <li>Create an app (name it e.g. "PrepShip"), give it the <code className="rounded bg-white/70 px-1">read_orders</code> scope, and <span className="font-medium text-ink-2">install it on your store</span></li>
              <li>Open the app's <span className="font-medium text-ink-2">Settings</span> page and copy the <span className="font-medium text-ink-2">Client ID</span> and <span className="font-medium text-ink-2">Client secret</span></li>
              <li>Paste them below with your <span className="font-medium text-ink-2">.myshopify.com</span> domain</li>
            </ol>
            <p className="mt-1.5 flex items-center gap-1 text-ink-3">
              <ShieldCheck size={13} className="shrink-0 text-brand-600" /> PrepShip only asks for read-only order access.
            </p>
          </div>
        )}

        {platform.credentialFields.map((f) => {
          const isPw = f.type === 'password';
          const reveal = shown[f.key];
          return (
            <Field key={f.key} label={f.label} error={errors[f.key]}>
              <div className="relative">
                <input
                  type={isPw && !reveal ? 'password' : f.type === 'url' ? 'url' : 'text'}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                  className={cn(inputCls(Boolean(errors[f.key])), isPw && 'pr-10')}
                  autoComplete="off"
                />
                {isPw && (
                  <button
                    type="button"
                    onClick={() => toggleShown(f.key, Boolean(reveal))}
                    aria-label={reveal ? 'Hide' : 'Show'}
                    className="focus-ring absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer rounded-md p-1.5 text-ink-3 hover:text-brand-600"
                  >
                    {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                )}
              </div>
            </Field>
          );
        })}

        {validation && (
          <p
            className={cn(
              'flex items-start gap-1.5 rounded-glass-sm px-3 py-2 text-xs font-medium',
              validation.ok ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600',
            )}
          >
            {validation.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <XCircle size={14} className="mt-0.5 shrink-0" />}
            {validation.message}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-white/60 p-4">
        <Button type="button" variant="ghost" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1" disabled={validating}>
          {validating ? 'Validating…' : 'Review connection'}
        </Button>
      </div>
    </form>
  );
}

/* ----------------------- Stage 3: review ----------------------- */
function ReviewStage({
  platform,
  storeName,
  values,
  onBack,
  onConfirm,
}: {
  platform: StorePlatform;
  storeName: string;
  values: Record<string, string>;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-white/60 p-5">
        <button type="button" onClick={onBack} className="focus-ring -ml-1 inline-flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 text-sm font-medium text-ink-3 transition-colors hover:text-brand-600">
          <ArrowLeft size={15} /> Edit credentials
        </button>
        <p className="mt-2 text-xs font-bold uppercase tracking-wider text-brand-600">Review connection</p>
        <h2 className="font-display text-2xl font-bold tracking-tight text-ink">{storeName}</h2>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
        <div className="flex items-center gap-3 rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
          <StoreLogo platform={platform} />
          <div>
            <p className="text-sm font-bold text-ink">{platform.name}</p>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-ink-3">{platform.category}</span>
          </div>
        </div>
        <dl className="divide-y divide-slate-100 rounded-glass-sm bg-white/60 px-4 ring-1 ring-slate-200/70">
          <Row label="Store name" value={storeName} />
          {platform.credentialFields.map((f) => (
            <Row key={f.key} label={f.label} value={f.type === 'password' ? '•'.repeat(Math.min(12, (values[f.key] ?? '').length || 8)) : values[f.key] ?? '—'} />
          ))}
        </dl>
        <p className="flex items-start gap-2 rounded-glass-sm bg-brand-50/70 p-3 text-xs text-ink-3">
          <ShieldCheck size={15} className="mt-0.5 shrink-0 text-brand-600" />
          Credentials are submitted securely for operator review and are only used to sync this store's orders, inventory, and fulfillment once activated.
        </p>
      </div>

      <div className="flex items-center gap-3 border-t border-white/60 p-4">
        <Button type="button" variant="ghost" className="flex-1" onClick={onBack}>
          Back
        </Button>
        <Button type="button" className="flex-1" onClick={onConfirm} leadingIcon={<Plus size={16} />}>
          Connect store
        </Button>
      </div>
    </div>
  );
}

/* ----------------------- helpers ----------------------- */
function inputCls(invalid: boolean) {
  return cn(
    'h-11 w-full rounded-glass-sm border bg-white/70 px-3.5 text-[15px] text-ink ring-1 backdrop-blur-sm transition-colors placeholder:text-slate-400 focus:bg-white/90 focus:outline-none',
    invalid ? 'border-rose-300 ring-rose-200 focus:shadow-[0_0_0_3px_rgba(244,63,94,0.18)]' : 'border-white/80 ring-slate-200/70 focus:border-brand-400 focus:shadow-[0_0_0_3px_rgba(3, 169, 244,0.18)]',
  );
}
function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-semibold text-ink-2">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-rose-600">{error}</span>}
    </label>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <span className="text-ink-3">{label}</span>
      <span className="max-w-[60%] truncate font-medium text-ink">{value || '—'}</span>
    </div>
  );
}
