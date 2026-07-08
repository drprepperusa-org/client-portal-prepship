import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Lock, Mail, PackageCheck } from 'lucide-react';
import { motion } from 'framer-motion';
import { PasswordInput } from '@/components/ui/Inputs';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth';
import { supabase } from '@/lib/supabase';
import { portalApi } from '@/lib/api';

export default function ActivateAccount() {
  const nav = useNavigate();
  const toast = useToast();
  const { loading, isAuthed, accessToken, activationPending, email } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast.error('Password too short', 'Use at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      toast.error('Passwords do not match', 'Check the confirmation field.');
      return;
    }
    if (!accessToken || !activationPending) {
      toast.error('Activation link required', 'Open the latest activation email.');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      await portalApi.completeAccessActivation(accessToken);
      await supabase.auth.refreshSession();
      toast.success('Account activated', 'Your password is ready.');
      nav('/', { replace: true });
    } catch (err) {
      toast.error('Activation failed', err instanceof Error ? err.message : 'Please try the invitation link again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-white">
        <span className="h-10 w-10 animate-spin rounded-full border-[3px] border-brand-200 border-t-brand-600" />
      </div>
    );
  }

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-slate-50 via-white to-brand-50/50 px-5 py-10">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 26 }}
        className="w-full max-w-sm"
      >
        <div className="mb-8 flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-glass-sm bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-glass">
            <PackageCheck size={20} />
          </span>
          <div className="leading-tight">
            <p className="font-display text-base font-bold tracking-tight text-ink">PrepShip Client Portal</p>
            <p className="text-[11px] font-medium text-ink-3">by DR PREPPER USA</p>
          </div>
        </div>

        <div className="rounded-glass bg-white/80 p-6 shadow-glass ring-1 ring-slate-200/70 backdrop-blur">
          {isAuthed && activationPending ? (
            <>
              <span className="mb-5 grid h-11 w-11 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
                <CheckCircle2 size={22} />
              </span>
              <h1 className="font-display text-[24px] font-bold tracking-tight text-ink">Activate account</h1>
              <p className="mt-1.5 flex items-center gap-1.5 text-sm text-ink-3">
                <Mail size={14} /> {email ?? 'Invited user'}
              </p>

              <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
                <PasswordInput
                  label="Password"
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  icon={<Lock size={16} />}
                  placeholder="At least 8 characters"
                />
                <PasswordInput
                  label="Confirm password"
                  required
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  icon={<Lock size={16} />}
                  placeholder="Repeat password"
                />
                <Button type="submit" size="lg" loading={saving} className="mt-1 w-full" trailingIcon={<ArrowRight size={18} />}>
                  Set Password
                </Button>
              </form>
            </>
          ) : isAuthed ? (
            <div className="space-y-5">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
                <CheckCircle2 size={22} />
              </span>
              <div>
                <h1 className="font-display text-[24px] font-bold tracking-tight text-ink">Account active</h1>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-3">
                  Your portal login is ready.
                </p>
              </div>
              <Button className="w-full" onClick={() => nav('/', { replace: true })}>
                Open Portal
              </Button>
            </div>
          ) : (
            <div className="space-y-5">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-amber-50 text-amber-600">
                <Mail size={22} />
              </span>
              <div>
                <h1 className="font-display text-[24px] font-bold tracking-tight text-ink">Invitation needed</h1>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-3">
                  Open the latest activation email, or ask an admin to send a new invite.
                </p>
              </div>
              <Button variant="secondary" className="w-full" onClick={() => nav('/login', { replace: true })}>
                Back to Sign In
              </Button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
