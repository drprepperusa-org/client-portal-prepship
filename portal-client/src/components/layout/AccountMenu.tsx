import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { KeyRound, ShieldCheck, LogOut, MonitorSmartphone } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '@/components/ui/Display';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { PasswordInput } from '@/components/ui/Inputs';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth';
import { cn } from '@/lib/cn';

const MIN_PASSWORD = 8;

function formatSignIn(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

/**
 * Account menu behind the top-right avatar. Auth is entirely Supabase-managed
 * (see auth.tsx), so every action here is a client-side Supabase call — there is
 * no account/business data on this surface, so the shadow-renderer/SOT law does
 * not apply. Provides: Change password (re-auth gated) and Security (account
 * info + sign out of all devices), plus Sign out of this device.
 */
export function AccountMenu() {
  const nav = useNavigate();
  const toast = useToast();
  const { email, lastSignInAt, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);

  async function handleSignOut() {
    setOpen(false);
    await signOut();
    toast.info('Signed out', 'You have been logged out.');
    nav('/login', { replace: true });
  }

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Account"
          aria-haspopup="menu"
          aria-expanded={open}
          className="focus-ring cursor-pointer rounded-full transition-transform hover:scale-105"
        >
          <Avatar name={email ?? 'User'} size={38} />
        </button>
        <AnimatePresence>
          {open && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
              <motion.div
                role="menu"
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={{ duration: 0.16 }}
                className="glass-strong absolute right-0 z-20 mt-2 w-[min(90vw,264px)] rounded-glass p-1.5 shadow-glass-lg"
              >
                <div className="px-3 py-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">Signed in as</p>
                  <p className="truncate text-sm font-semibold text-ink" title={email ?? undefined}>
                    {email ?? 'User'}
                  </p>
                </div>
                <div className="my-1 h-px bg-white/60" />
                <MenuItem
                  icon={<KeyRound size={16} />}
                  label="Change password"
                  onClick={() => {
                    setOpen(false);
                    setPasswordOpen(true);
                  }}
                />
                <MenuItem
                  icon={<ShieldCheck size={16} />}
                  label="Security"
                  onClick={() => {
                    setOpen(false);
                    setSecurityOpen(true);
                  }}
                />
                <div className="my-1 h-px bg-white/60" />
                <MenuItem icon={<LogOut size={16} />} label="Sign out" danger onClick={handleSignOut} />
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      <ChangePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
      <SecurityModal
        open={securityOpen}
        onClose={() => setSecurityOpen(false)}
        email={email}
        lastSignInAt={lastSignInAt}
      />
    </>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors',
        danger ? 'text-rose-600 hover:bg-rose-50' : 'text-ink-2 hover:bg-slate-100',
      )}
    >
      <span className={cn('shrink-0', danger ? 'text-rose-500' : 'text-ink-3')}>{icon}</span>
      {label}
    </button>
  );
}

function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { changePassword } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Never keep typed passwords around after the modal closes.
  useEffect(() => {
    if (open) return;
    setCurrent('');
    setNext('');
    setConfirm('');
    setError(null);
    setBusy(false);
  }, [open]);

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && next !== confirm;
  const sameAsOld = next.length > 0 && next === current;
  const canSubmit =
    current.length > 0 && next.length >= MIN_PASSWORD && next === confirm && !sameAsOld && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      toast.success('Password updated', 'Use your new password next time you sign in.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change your password.');
      setBusy(false);
    }
  }

  const newError = tooShort
    ? `Use at least ${MIN_PASSWORD} characters.`
    : sameAsOld
      ? 'Choose a password different from your current one.'
      : undefined;

  return (
    <Modal open={open} onClose={onClose} title="Change password" maxWidth={430}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <PasswordInput
          label="Current password"
          required
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <PasswordInput
          label="New password"
          required
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          helper={`At least ${MIN_PASSWORD} characters.`}
          error={newError}
        />
        <PasswordInput
          label="Confirm new password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={mismatch ? 'Passwords do not match.' : undefined}
        />
        {error && <p className="rounded-glass-sm bg-rose-50 px-3 py-2 text-[13px] text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={busy} disabled={!canSubmit}>
            Update password
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function SecurityModal({
  open,
  onClose,
  email,
  lastSignInAt,
}: {
  open: boolean;
  onClose: () => void;
  email: string | null;
  lastSignInAt: string | null;
}) {
  const nav = useNavigate();
  const toast = useToast();
  const { signOutAllDevices } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setBusy(false);
    setError(null);
  }, [open]);

  async function signOutEverywhere() {
    setBusy(true);
    setError(null);
    try {
      await signOutAllDevices();
      toast.info('Signed out everywhere', 'All active sessions have been ended.');
      nav('/login', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign out of all devices.');
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Security" maxWidth={430}>
      <div className="flex flex-col gap-5">
        <div className="rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
          <InfoRow label="Email" value={email ?? '—'} />
          <div className="my-2 h-px bg-slate-200/60" />
          <InfoRow label="Last sign-in" value={formatSignIn(lastSignInAt)} />
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">Sign out of all devices</p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-3">
            Ends every active session across all devices, including this one. You'll be returned to the sign-in
            screen and can sign back in anytime.
          </p>
          {error && (
            <p className="mt-2 rounded-glass-sm bg-rose-50 px-3 py-2 text-[13px] text-rose-600">{error}</p>
          )}
          <div className="mt-3 flex justify-end">
            <Button
              variant="danger"
              size="sm"
              loading={busy}
              leadingIcon={<MonitorSmartphone size={16} />}
              onClick={signOutEverywhere}
            >
              Sign out everywhere
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13px] text-ink-3">{label}</span>
      <span className="truncate text-[13px] font-medium text-ink" title={value}>
        {value}
      </span>
    </div>
  );
}
